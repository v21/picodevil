# Native App / Better Video Decode Research Plan

## Context

uzuvid's reverse/extreme-speed playback is janky because HTML5 `<video>` provides no native reverse support. The current approach in `src/video-playback.ts` pauses the element and sets `el.currentTime = expected` every frame. Browser decoders must then hunt backward through the GOP to find the nearest keyframe and decode forward to the target — this takes 50–500ms per seek, which is catastrophically slow at 60fps.

The question: is a native app the right path to fix this, and if so, what's the best approach?

---

## Root Cause: Inter-Frame Video Compression

The real enemy is **H.264's inter-frame compression (GOP structure)**, not the browser. In H.264:
- IDR frames (keyframes) are self-contained; any frame can be reached from them instantly
- P-frames and B-frames depend on nearby frames for decoding
- A typical 30fps clip has 1 keyframe every 30 frames (1-second GOP)
- Seeking to a P-frame requires: find nearest preceding IDR → decode forward N frames

This is slow everywhere: browser, native, everywhere. Every VJ tool (Resolume, VDMX, Millumin, TouchDesigner) has the same conclusion in their documentation: **H.264 is unsuitable for reverse/scrub; use I-frame-only codecs**.

---

## Four Approaches, Increasing Complexity

### Approach 1: Server-side I-frame-only transcoding
**Effort: days. No frontend changes. ✅ Implemented.**

Add a post-download transcode step in `server/server.js` (which already bundles `ffmpeg-static`):

```
ffmpeg -i input.mp4 -vcodec libx264 -x264opts keyint=1:min-keyint=1:scenecut=0 -g 1 -preset ultrafast output.mp4
```

Every frame becomes an IDR. Browser's `el.currentTime` now resolves in 1–5ms instead of 50–500ms because there is no forward-decode penalty. The existing architecture is entirely unchanged. File sizes are 5–15× larger but manageable for a performance tool.

**Critical files:** `server/server.js` only.

**Middle-ground: short GOP instead of I-frame-only.** `ffmpeg -i input.mp4 -c:v libx264 -g 5 -keyint_min 5 -crf 23 output.mp4` produces 5-frame GOPs. Seeking worst-case = 5 frames of forward decode instead of 30 = 6× improvement. File size increase is modest (~10–30% larger than standard H.264 vs the 5–15× hit for I-frame-only). This may be a good default: meaningful seeking improvement at low storage cost. The trade-off is that browser seeking is still asynchronous regardless of keyframe density — the async pipeline overhead doesn't go away, only the forward-decode penalty shrinks.

**Risk:** May not fully resolve jank — browser's asynchronous seeking pipeline adds overhead even for keyframe seeks. Need to empirically test before investing in anything larger.

---

### Approach 2: WebCodecs + MP4Box.js (in-browser, low-level)
**Effort: 1–2 weeks. No native binary.**

Replace the `HTMLVideoElement` pool with a `VideoDecoder` pool. The [WebCodecs API](https://developer.chrome.com/articles/webcodecs/) gives per-frame decode control using the platform hardware decoder (VideoToolbox on macOS). `MP4Box.js` handles MP4 demuxing: given a target time, look up the byte range of the nearest keyframe, fetch it (from blob URL = memory read), decode one frame in ~1ms.

The integration point is clean: `computeExpectedTime()` in `src/video-playback.ts` already produces a pure target time in seconds. A new `video-decoder.ts` would consume that time and return a `VideoFrame` (which is a valid `CanvasImageSource` — `draw-fit.ts` works with zero changes).

```
computeExpectedTime(t) → targetSecs
  → MP4Box.js: targetSecs → byteRange (O(1) index lookup via STSS/stco boxes)
  → fetch(blobUrl, {headers: {Range: ...}}) → encodedChunk
  → VideoDecoder.decode(chunk) → VideoFrame (~1ms on M2 VideoToolbox)
  → ctx.drawImage(videoFrame, ...) ← draw-fit.ts unchanged
```

**With I-frame-only transcoded video (combined with Approach 1):** every seek is 1 keyframe, no forward decode, ~1ms total. Reverse playback is identical to forward.

**Without I-frame transcoding (standard H.264):** WebCodecs still doesn't overcome the GOP limitation per seek. But it enables **GOP frame caching**: decode a full 30-frame GOP into a `VideoFrame[]` array once, then play backward from the cache. Memory cost: ~250MB per stream (30 frames × 8.3MB at 1080p RGBA); 4 streams = ~1GB — feasible with disciplined `VideoFrame.close()` management. MP4Box.js exposes the `RAP` flag and byte offset per sample via `getTrackSamplesInfo()`, so finding GOP boundaries is straightforward. This approach improves reverse playback on unmodified H.264 but adds significant implementation complexity.

**In-browser transcoding** (HAP or I-frame re-encode): impractical — CPU-intensive encoding in the browser is 10–50× slower than native. Not viable for real content.

**Critical files:**
- `src/video-playback.ts` — `updateVideoPlayback()` call site
- `src/main.ts` — `videoPool`, `getVideoEl()`, `assignVideoElements()`, `drawFrameEvents()`
- `src/draw-fit.ts` — no changes needed (`VideoFrame` is a valid `CanvasImageSource`)
- `src/playback-rate.ts` — `isNativeRate()` distinction becomes irrelevant; all rates = seek

**Key risk:** WebCodecs requires Chrome 94+ (no Safari). Fine for Electron; fine for dev use. `MP4Box.js` parses the MP4 box structure; container parsing of unusual files could be fragile.

---

### Approach 3: HAP codec — WebGL compositor in browser
**Effort: 1–2 weeks. No native binary. Stays in browser.**

HAP (by Vidvox) stores each frame as a GPU-native DXT1/DXT5 texture — the same format GPUs use for compressed texture sampling. During rendering, the raw bytes go straight from disk → GPU. **There is no CPU decode step** — the GPU decompresses as part of the texture sample operation. This is the fundamental difference from I-frame H.264, which still requires hardware decode (~1ms/frame via VideoToolbox) even though every frame is independent.

The tradeoff: HAP requires WebGL, not Canvas2D. The current compositor uses `ctx.drawImage()`. To support HAP, Canvas2D alone is insufficient.

**Coexisting with non-HAP (OffscreenCanvas bridging):**
Each HAP stream renders into an `OffscreenCanvas` with a WebGL context via `hapjs`. That `OffscreenCanvas` is then passed to `drawFit(ctx, hapCanvas, ...)` — `OffscreenCanvas` is a valid `CanvasImageSource`, so the main Canvas2D compositor is unchanged. HAP and standard video/color elements coexist with no compositor rewrite.

```
computeExpectedTime(t) → targetSecs
  → frameIndex = Math.floor(targetSecs * fps)
  → fetch(hapBlobUrl, {Range: hapFrameByteRange[frameIndex]})
  → hapjs.upload(gl, frame) → WebGL texture → render to OffscreenCanvas
  → ctx.drawImage(offscreenCanvas, ...) ← draw-fit.ts unchanged
```

**Server side:** transcode to HAP after download (in addition to or instead of I-frame H.264):
```
ffmpeg -i input.mp4 -c:v hap -format hap_q output.mov
```
HAP is mainline ffmpeg (no plugin needed). Files are roughly 2–5× larger than I-frame H.264 at equivalent quality — meaningfully larger, but random access is faster because there is zero decode latency.

**When HAP wins over I-frame H.264:** high stream counts where CPU decode time adds up (4+ simultaneous streams), or when the 1ms/frame decode cost of hardware VideoToolbox is still too high at extreme framerates.

**Format detection:** files with `.hap.mov` extension (or a server-set `Content-Type`) use the HAP WebGL path; `.mp4` files use the existing `<video>` element path or WebCodecs path. No change to the user-facing `video()` / `s()` API needed — format selection is transparent.

**Critical files:**
- `src/main.ts` — add `hapPool` (Map of `OffscreenCanvas` + WebGL context) alongside `videoPool`; detect HAP files at pool assignment time
- `src/draw-fit.ts` — no changes needed
- `server/server.js` — add optional HAP transcode step alongside the existing I-frame H.264 step
- New dep: `hapjs` (npm, ~12KB)

**Key risk:** `hapjs` requires `WEBGL_compressed_texture_s3tc` WebGL extension. Available on essentially all desktop GPU drivers (Chrome/Firefox/Electron) but worth verifying. `OffscreenCanvas` WebGL context creation per stream adds ~1–2ms of setup on first frame. Container format for HAP is `.mov` (QuickTime) — `hapjs` has its own parser, but it needs validation for all files ffmpeg produces.

---

### Approach 4: Cross-platform native — GStreamer + wgpu + WebView shell
**Effort: 2–6 weeks. New Rust codebase layer.**

This is what VDMX5, Millumin, and Resolume use architecturally, generalized to cross-platform.

**macOS path (best performance):** `AVAssetReader` with backward `CMTimeRange` delivers frames in reverse order using VideoToolbox. Zero-copy: `CVPixelBuffer` → `MTLTexture` → `CAMetalLayer`. `AVAssetReader` is first-party Apple and the cleanest possible path on Mac.

**Cross-platform path:** Rust + `gstreamer-rs` (video decode) + `wgpu` (GPU compositing). GStreamer supports reverse playback via negative-rate seeks with `SeekFlags::TRICKMODE`. `wgpu` supports Metal/Vulkan/D3D12/WebGPU with a single API — production-ready as of 2025.

Architecture:
```
Rust process (native app shell)
  ├─ wgpu MTKView/Vulkan surface (video frames as GPU textures)
  └─ WebView (WKWebView/WebView2, full-size overlay, transparent)
       ├─ CodeMirror editor
       ├─ Strudel pattern runtime (all JS unchanged)
       └─ computeExpectedTime() → postMessage({src, targetTime})
              → Rust: GStreamer seek → decoded frame → wgpu texture → composite
```

Tauri is the practical Rust WebView shell (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux). Alternatively: Electron with a Rust/C++ native addon using `napi-rs` + `gstreamer-rs`, keeping Chromium as the WebView (better Web API coverage).

All JS pattern logic, Strudel, visual controls, and CodeMirror stay in WebView unchanged.

**Key risk:** GStreamer's cross-platform reverse playback has platform-dependent behavior — needs empirical testing. WKWebView (Tauri/macOS) is behind Chrome in some Web APIs; Electron avoids this but adds binary size. Tauri's binary IPC for high-bandwidth frame data at 60fps is less proven than Electron's SharedArrayBuffer approach.

---

## Practical Decision Path

```
Step 1: Implement I-frame transcode in server.js (Approach 1) ✅ Done
  → Test empirically: does reverse playback feel smooth?
  → If yes: problem solved, done.

Step 2: If browser seek async overhead is still visible, implement WebCodecs path (Approach 2)
  → Keeps web architecture, adds programmatic decode control
  → Combined with I-frame source: ~1ms/frame, no perceived stutter

Step 3: If CPU decode cost is the remaining bottleneck (many streams, extreme framerates), add HAP (Approach 3)
  → Server transcodes to HAP; WebGL compositor via hapjs + OffscreenCanvas bridge
  → Zero CPU decode; Canvas2D compositor unchanged

Step 4: If stream count, frame rates, or quality demands exceed browser limits entirely, go native (Approach 4)
  → Full Metal compositor, AVFoundation reverse, professional VJ tool architecture
```

---

## Additional Options Investigated (lower priority)

| Option | Notes |
|--------|-------|
| **Electron + native addon** | Viable; SharedArrayBuffer zero-copy path. More complex build than WebCodecs but stays JS-heavy. Worth considering if WebCodecs proves insufficient without going full native. |
| **Tauri + gstreamer-rs** | GStreamer has real reverse playback support via GST_SEEK_FLAG_REVERSE. WKWebView's SharedArrayBuffer restrictions complicate high-bandwidth frame passing. Valid macOS-first option. |
| **Qt + FFmpeg** | Cross-platform but no native reverse playback advantage over browser. Not recommended. |
| **WebCodecs + H.264** (no I-frame transcode) | Still pays forward-decode penalty per reverse frame. Faster than `<video>` element but not fast enough for smooth reverse. Approach 1 + 2 must be combined. |

---

## Verification

For Approach 1 (server transcode):
- Download a clip, run the transcode, load in uzuvid, play at `speed(-1)` and `speed(-2)` — watch for frame drops
- Compare `seeking` event frequency in browser console before/after transcode

For Approach 2 (WebCodecs):
- Write a standalone `VideoDecoder` test: decode keyframe from MP4Box-identified byte range, measure time from `decode()` to `output()` callback
- Run existing test suite (`npm test`) to validate pattern system is unaffected

For Approach 3 (HAP):
- Encode a test clip with `ffmpeg -c:v hap_q`, load via `hapjs` in a standalone HTML page, measure WebGL upload time per frame
- Verify `WEBGL_compressed_texture_s3tc` is available in the target browser/Electron version

For Approach 4 (native):
- Prototype the `AVAssetReader` reverse read in a Swift playground first
- Measure frames delivered per second for 4 simultaneous 1080p streams in reverse

---

## Key Files

- `server/server.js` — transcode step entry point
- `src/video-playback.ts:computeExpectedTime()` — pure function, the integration seam for any decoder
- `src/video-playback.ts:updateVideoPlayback()` — where `el.currentTime` is assigned; replacement target for WebCodecs/native
- `src/main.ts` (lines ~674–800) — render loop, video pool, frame assignment
- `src/playback-rate.ts` — `isNativeRate()` boundary, becomes irrelevant in WebCodecs/native path
- `src/draw-fit.ts` — no changes needed for WebCodecs (VideoFrame is CanvasImageSource)
