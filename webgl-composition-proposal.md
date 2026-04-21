# WebGL Composition Proposal

## Motivation

The current Canvas 2D rendering backend has a fundamental performance ceiling: every `drawImage(videoElement)` call triggers a GPU→CPU pixel readback. With 16 tiles sharing one video element (e.g. `cropStack(4,4)`), that's 16 separate readbacks per frame (~3ms each), plus a `ProduceCanvasResource` stall (~110ms) as the finished canvas is re-uploaded to the compositor. Profiling shows this causes ~5fps where 60fps should be achievable.

WebGL keeps video frames as GPU textures. `gl.texImage2D(..., videoElement)` is a GPU→GPU copy — no CPU involvement. Each tile is a textured quad with UV coordinates encoding the crop window. The compositor receives a WebGL canvas directly without a texture roundtrip.

---

## What stays the same

Everything above the rendering layer is unchanged:
- All Strudel pattern logic, `createMixParam`, and pattern resolution
- The video pool and pool manager — they still manage `<video>` elements
- Crop math (cropx, cropy, cropw, croph) — maps to UV offset/scale in the shader
- All controls: `.alpha()`, `.blend()`, `.speed()`, `.objectfit()`, etc. — these just become uniforms instead of canvas state
- `drawFit`'s fit-mode logic (cover/contain/fill/none) — same math, expressed as UV + destination rect computation

---

## Steps

### 0. Extract the rendering subsystem from `main.ts`

Before any WebGL work, pull the rendering concern out of `main.ts` behind a clean interface. This is done while keeping Canvas 2D working — it's a pure refactor with no behaviour change.

**What moves out:**

`main.ts` currently holds six distinct concerns. Only the rendering one moves in this step:

| Concern | Current location | Destination |
|---|---|---|
| Clock (`setCps`, `accumulatedCycle`, cycle timing) | `main.ts` | stays for now |
| Pattern state (`pPatterns`, `collectScreens`, `hush`) | `main.ts` | stays for now |
| Eval bridge (`uzuEval`, snapshot/restore) | `main.ts` | stays for now |
| Image pool (`getImageEl`, `clearImages`) | `main.ts` | stays for now |
| Metrics (`uzuMetrics`) | `main.ts` | stays for now |
| **Render loop** (`collectFrameEvents`, `assignVideoElements`, `drawFrameEvents`, `prewarmVideos`, `frame()`) | `main.ts` | → `src/renderer.ts` |

**The `Renderer` interface** (`src/renderer-interface.ts`):

```ts
export interface TileParams {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  destX: number; destY: number; destW: number; destH: number;  // 0..1 normalised canvas coords
  uvX: number; uvY: number; uvW: number; uvH: number;          // 0..1 source crop
  alpha: number;
  flipX: boolean; flipY: boolean;
  blendMode: GlobalCompositeOperation;
  fit: FitMode;
  // transform
  rotateZ: number;   // turns
  scaleX: number; scaleY: number;
}

export interface Renderer {
  resize(widthPx: number, heightPx: number): void;
  beginFrame(): void;
  drawTile(params: TileParams): void;
  endFrame(): void;
  dispose(): void;
}
```

**`src/canvas2d-renderer.ts`** — the current drawing logic, wrapped behind `Renderer`. `drawFrameEvents` in main.ts becomes `drawTile` calls issued by the frame loop. `drawFit` is unchanged; `ctx.save/restore`, `globalAlpha`, `globalCompositeOperation` all stay as-is. This is the live implementation while WebGL is built.

**`src/renderer.ts`** — owns `collectFrameEvents`, `assignVideoElements`, `drawFrameEvents` (now calls `renderer.drawTile`), `prewarmVideos`, and `frame()`. Receives a `Renderer` instance at construction. `main.ts` creates the renderer, passes it in, calls `requestAnimationFrame(frame)`.

**After this step**, `main.ts` is wiring only: canvas setup, editor, sidebar, URL state, pool construction, and starting the loop. The rendering subsystem is fully contained in `renderer.ts` + `canvas2d-renderer.ts`. No behaviour change — the stress test and full test suite should pass unchanged.

This step also defines the exact `TileParams` interface that the WebGL renderer must implement, so the subsequent steps are working to a known target rather than designing it speculatively.

---

### 1. Create a WebGL renderer module (`src/webgl-renderer.ts`)

Set up a WebGL2 context on the existing canvas. Write two shaders:

**Vertex shader** — takes a unit quad, transforms it to destination rect in clip space, passes UV coords through:
```glsl
in vec2 a_position;   // 0..1 quad
in vec2 a_uv;         // 0..1 texture coords

uniform vec2 u_destOffset;  // destination rect top-left in canvas coords (0..1)
uniform vec2 u_destSize;    // destination rect size (0..1)
uniform vec2 u_uvOffset;    // source crop top-left in texture coords
uniform vec2 u_uvSize;      // source crop size in texture coords
uniform vec2 u_flip;        // vec2(flipX, flipY) — 0 or 1

out vec2 v_uv;

void main() {
  vec2 uv = a_uv;
  uv = u_uvOffset + uv * u_uvSize;
  uv.x = mix(uv.x, u_uvOffset.x + u_uvSize.x - (uv.x - u_uvOffset.x), u_flip.x);
  uv.y = mix(uv.y, u_uvOffset.y + u_uvSize.y - (uv.y - u_uvOffset.y), u_flip.y);
  v_uv = uv;
  vec2 pos = u_destOffset + a_position * u_destSize;
  // convert 0..1 canvas coords to clip space (-1..1, Y flipped)
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y *= -1.0;
}
```

**Fragment shader** — samples texture, applies alpha and tint:
```glsl
uniform sampler2D u_texture;
uniform float u_alpha;
uniform vec4 u_color;      // for solid-color tiles; w=1 uses color, w=0 uses texture
uniform vec2 u_texelSize;  // 1/textureSize, for the tiling path

in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 uv = fract(v_uv);     // GL_REPEAT equivalent — handles out-of-bounds tiling
  vec4 col = mix(texture(u_texture, uv), u_color, u_color.a > 0.0 ? 0.0 : 0.0);
  col = mix(texture(u_texture, uv), u_color, u_color.a);
  fragColor = col * u_alpha;
}
```

(Exact shader design will be refined; the point is that tiling, flipping, alpha, and solid-color fills are all handled in-shader with no branching in JS.)

Expose a `drawTile(params)` function:
```ts
interface TileParams {
  texture: WebGLTexture;     // or null for solid color
  color?: [r, g, b, a];      // for color() fills
  destX: number; destY: number; destW: number; destH: number;  // 0..1
  uvX: number; uvY: number; uvW: number; uvH: number;          // 0..1
  alpha: number;
  flipX: boolean; flipY: boolean;
  blendMode: string;
}
```

### 2. Texture cache (`src/texture-cache.ts`)

Map from `HTMLVideoElement | HTMLImageElement | HTMLCanvasElement` → `WebGLTexture`. Each frame:
- For each unique source that will be drawn, call `gl.texImage2D` once (GPU→GPU upload, no readback)
- Textures persist across frames (update in place with `texSubImage2D` when the source changes)
- Evict textures for sources that haven't been drawn in N frames

This is where the core perf win lives: N tiles sharing one video element = 1 texture upload + N quad draws.

### 3. Rewrite `drawFit` as UV math

The current `drawFit` computes a destination rect and source rect for `drawImage`. In WebGL, this becomes:
- `destX/Y/W/H` — the destination quad position on the canvas (normalised 0..1)
- `uvOffset/uvSize` — the portion of the texture to sample (the crop window)

Fit modes (cover/contain/fill/none) are computed the same way as now — they determine `destX/Y/W/H`. The crop params (cropx/cropy/cropw/croph) determine `uvOffset/uvSize`. Both are then passed as uniforms.

The tiling case (crop out of bounds) is handled by `fract(v_uv)` in the fragment shader — no need for `createPattern`.

### 4. Swap `canvas2d-renderer.ts` for `webgl-renderer.ts`

After step 0, `main.ts` constructs a `Renderer` and passes it to `renderer.ts`. Swapping backends is a one-line change at the construction site. The frame loop in `renderer.ts` is unchanged — it still calls `renderer.drawTile(params)` for each event; it just gets a different implementation.

During this step:
- `renderVideoFrame` still runs (playback/seek logic is unchanged)
- Instead of drawing immediately, the WebGL renderer accumulates `TileParams` into a per-frame draw list
- At `endFrame()`, sort by blend mode (to minimise GL state changes) and issue all draw calls

Keep the Canvas 2D renderer available behind a `?renderer=canvas2d` URL flag during development for bisecting visual regressions.

### 5. Unified texture sources

Every tile source — video, image, colour, camera, screen capture — is a `WebGLTexture`. The shader has one code path: sample the texture at the computed UV. No branching on source type.

**Source → texture mapping:**

| Source | Canvas element | Upload cadence |
|---|---|---|
| `video()` | `HTMLVideoElement` | Every frame (frame changes) |
| `image()` | `HTMLImageElement` | Once (static after load) |
| `color()` | 1×1 `HTMLCanvasElement`, filled with CSS color | Once (static after creation) |
| `screen()` / camera | `HTMLVideoElement` | Every frame |
| Future canvas sources | `HTMLCanvasElement` | Per-frame if animated |

`color()` fills become a trivial special case of canvas-as-source. A 1×1 canvas is created per unique colour (keyed by normalised hex string from `parseColor`), filled with `fillRect`, uploaded once via `gl.texImage2D`, and reused permanently. No special shader uniform needed.

The texture cache tracks whether each source is "dirty" this frame. Videos and live camera feeds are always dirty; colours and images are dirty only on first upload. This avoids redundant `texImage2D` calls for static sources.

This also naturally enables a future `canvasSource()` API — any canvas that renders to itself (e.g. a pattern that composites to an offscreen canvas) can be fed as a texture source to another pattern, giving a compositing graph rather than a flat stack.

### 6. Blend modes

Canvas 2D's `globalCompositeOperation` maps to WebGL blend functions. Most common modes:

| Canvas mode      | `gl.blendFunc`                                |
|------------------|-----------------------------------------------|
| `source-over`    | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`              |
| `lighter`        | `SRC_ALPHA, ONE`                              |
| `multiply`       | `DST_COLOR, ONE_MINUS_SRC_ALPHA`              |
| `screen`         | `ONE, ONE_MINUS_SRC_COLOR`                    |

Blend mode changes require `gl.enable/disable(gl.BLEND)` + `gl.blendFunc` calls, which are cheap. Sort draw calls by blend mode to minimise these.

Some Canvas 2D modes (e.g. `hard-light`, `color-dodge`) have no direct WebGL equivalent — they require explicit shader implementation or an intermediate framebuffer. Audit which modes are actually used; defer exotic ones.

### 7. Testing

- Existing unit tests are unaffected (they test pattern resolution, not rendering)
- Add a visual regression test: render a known pattern for N frames, capture canvas pixels, compare against a reference PNG (to catch shader bugs that produce wrong crops/fits)
- Update stress test: the cropStack(4,4) case should now pass at 60fps
- Run the perf tracer after migration; verify `ReadbackImagePixels` is gone from the trace

---

## Risks

**Shader correctness** — The crop/fit math currently in `drawFit.ts` is tested and trusted. Porting it to GLSL UV transforms introduces risk of off-by-one errors, coordinate system confusion (WebGL Y-axis is flipped relative to canvas), and edge cases in the tiling path. Mitigation: keep `drawFit.ts` as a reference, write a visual regression test that compares output pixel-for-pixel against the Canvas 2D version before removing the old code.

**Blend mode gaps** — Not all Canvas 2D composite operations have direct WebGL blend function equivalents. Some modes currently used by live-coders (we don't know which) may require intermediate framebuffers or shader implementations. Mitigation: audit current usage, implement missing modes as framebuffer compositing passes, document which modes have full GPU support vs. fallback.

**Context loss** — WebGL contexts can be lost (GPU driver crash, device sleep, tab backgrounded). Canvas 2D silently survives these; WebGL requires explicit `webglcontextlost`/`webglcontextrestored` handling. Without it, the canvas goes blank permanently until reload. Mitigation: implement the event handlers — on restore, re-upload all textures and recompile shaders.

**Browser compatibility** — WebGL2 is required (for `texImage2D` with `HTMLVideoElement` in the external images extension, instanced drawing, etc.). Safari added WebGL2 in 2021; all modern browsers support it. However, some video formats or colour spaces may behave differently as GPU textures vs. CPU-decoded frames. Mitigation: test with the actual video files used in production.

**Debugging difficulty** — Canvas 2D rendering bugs are trivially inspectable (the canvas is just pixels). WebGL shader bugs require GPU debuggers (Spector.js, Chrome's GPU internals). The development loop gets slower. Mitigation: keep the Canvas 2D path available behind a flag during development so bugs can be bisected.

**Performance on lower-end hardware** — The GPU readback path is slow everywhere, but WebGL's texture upload path assumes reasonable GPU bandwidth. On integrated graphics with shared memory, the benefit may be smaller. Not a regression risk, but worth measuring.

---

## New opportunities

**Per-tile GPU effects** — Once tiles are shader-rendered, per-tile effects become additional uniforms or shader variants: brightness, contrast, saturation, hue rotation, blur (with a ping-pong framebuffer), chromatic aberration, pixelation. These can be exposed as new pattern controls with zero CPU cost.

**HDR and wide-gamut video** — WebGL can work with float textures. `drawImage` on a 2D canvas clamps to sRGB. With WebGL, HDR video frames (if the browser exposes them) can be composited in linear light, then tone-mapped to the display in the fragment shader.

**Per-tile transform matrix** — Currently position/scale is computed as a rect. With WebGL, the vertex shader can take a full 3×3 transform matrix per tile, enabling rotation and perspective transforms as pattern controls (`.rotate()`, `.skew()`) with no architecture change.

**GPU-side feedback effects** — With an intermediate framebuffer, the previous frame's output can be fed back as a texture. This enables trail/echo effects (`$: s("clip.mp4").feedback(0.9)`) where the frame accumulates over time — impossible with Canvas 2D without CPU readback.

**Offscreen rendering and multi-output** — WebGL makes it natural to render to an offscreen framebuffer and then use that framebuffer as a texture source in another pass. This could enable a `screen()` source that captures another named pattern's output and pipes it as input — a compositing graph rather than a flat stack.

**Lower memory pressure** — Currently `drawImage` from video may cause the browser to maintain multiple copies of the decoded frame (one in the decoder, one in the canvas backing store). With WebGL, the texture is uploaded once and lives only on the GPU; the canvas backing store is just the final composited output. With many video sources, this could noticeably reduce GPU memory usage.
