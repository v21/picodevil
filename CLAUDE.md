# uzuvid - agent orientation doc

> This file is machine-authored for use by coding agents. Last updated 2026-04-22.

## What is this?

uzuvid is a live-coding visual performance tool. Users write JavaScript in a browser-based editor (CodeMirror), hit Ctrl+Enter to evaluate, and the code controls what gets drawn to a fullscreen canvas. It uses Strudel's mininotation system for rhythmic patterns of colors and videos.

## Design principles

- **Do things the Strudel way** - this means functional composition, simplicity, and optimising for a user who is live coding.
- **No fast paths** — treat everything uniformly as patterns. No `typeof` shortcuts or separate code paths for literal values vs patterns. `reify()` handles both.
- **Everything resolves at query time, not build time** — grid size, position, children, all parameters come from pattern resolution at the moment of query. No baking in values at construction time.
- **Prefer simplicity and deletion** — remove code rather than add special cases. Three similar lines are better than a premature abstraction.
- **Patterns all the way down** — everything is a Strudel Pattern with object values. Controls are methods on Pattern.prototype via `createMixParam`. No class hierarchy.
- **Prefer testing to reasoning** - if you have a choice between creating a test case and observing what happens, or trying to trace through the logic abstractly, then prefer making a test case.

## Project structure

```
uzuvid/
  index.html              — single-page app shell, loads src/main.ts via Vite
  vitest.config.ts        — vitest config (browser mode via Playwright)
  package.json            — Vite dev server, Strudel + CodeMirror deps
  notes.md                — design notes (human-authored, aspirational, not all implemented)
  TODO.md                 — current task list
  README.md               - human-authored README file, explaining the architecture of the project
  src/
    main.ts               — core runtime: pattern state, video pool, render loop, eval bridge; wires renderer backend
    editor.ts             — CodeMirror 6 editor setup, Ctrl+Enter eval binding
    config.ts             — constants: REVERSE_SEEK_INTERVAL (ms), VIDEO_BASE, IMAGE_BASE, CYCLES_PER_SECOND, SERVER_ENABLED
    transpiler.ts         — $: label transpiler, double-quote mini() wrapping
    visual-controls.ts    — createMixParam, position/grid/speed/alpha controls on Pattern.prototype
    grid-stack.ts         — gridStack() and four() helpers using .gridModulo()
    shuffle-stack.ts      — .shuffleStack(seed?) and .shuffleStackCycle(seed?) on Pattern.prototype
    color-pattern.ts      — color() function: wraps mini pattern with {color} values
    video-pattern.ts      — video() function: wraps mini pattern with {src} values
    image-pattern.ts      — image() function: wraps mini pattern with {src, type:"image"} values
    screen-pattern.ts     — screen()/s() function: auto-detects type per token (registry → extension → color fallback)
    draw-fit.ts           — drawFit() helper for cover/contain/fill/none rendering in Canvas 2D; FitMode type
    video-playback.ts     — video frame rendering: playback update, seeking (computeExpectedTime, detectWindowMoving, renderVideoFrame)
    event-begin.ts        — eventBeginFromHap: derives playback start cycle from hap + event value
    video-pool.ts         — computeExpectedFromEvent, scoreFreeElement for video element pool
    playback-rate.ts      — setPlaybackRate helper, native rate range constants
    time-value.ts         — TimeValue type and parsing (relative, seconds, milliseconds)
    pattern-extensions.ts — .lerp(), .spline(), .sec(), .ms() pattern extensions
    create-mix-param.ts   — createMixParam: custom combiner preserving whole spans
    renderer-interface.ts — Renderer interface, TileParams, TileSource types
    renderer.ts           — FrameRenderer: frame loop logic, event collection, video assignment, dispatches TileParams to backend
    canvas2d-renderer.ts  — Canvas2DRenderer: Renderer impl using CanvasRenderingContext2D (fallback / dev reference)
    webgl-renderer.ts     — WebGLRenderer: Renderer impl using WebGL2 (default); GPU texture upload, UV/fit on CPU, blend modes
    texture-cache.ts      — TextureCache: manages WebGL textures; videos re-uploaded each frame, images/colors cached
  test/
    monkey-test.ts              — grammar-based random pattern generator + browser runner
    regression-cases.json       — saved regression cases for conformance replay
    arbitraries.ts              — fast-check arbitraries for code generation
    upload-integration-test.ts  — end-to-end Playwright test for file drag-and-drop upload
  server/                 — standalone Node.js package (separate npm install)
    server.js             — HTTP server: downloads YouTube videos via yt-dlp, serves MP4s; also accepts local file uploads
    server.test.js        — tests (node --test), mocks spawn/execFile to avoid real downloads
    package.json          — deps: yt-dlp-wrap, ffmpeg-static
```

## How the frontend works

1. `src/main.ts` maintains a `screens` array collected from `.p()` registrations each eval cycle.
2. The transpiler converts `$: expr` lines into `expr.p("$")` calls, and wraps double-quoted strings in `mini()`.
3. The render loop runs at requestAnimationFrame rate. Each frame it:
   - Computes cycle position from elapsed time and `cyclesPerSecond`
   - Queries each screen pattern with `queryArc(t, t)` (zero-width instant query)
   - `FrameRenderer.render()` collects events, assigns video pool elements, then dispatches `TileParams` to the active `Renderer` backend
4. `window.uzuEval(code)` is called by the editor. It transpiles, clears state, then runs the code as a `new Function`.

## Renderer architecture

Rendering is split into two layers:

- **`FrameRenderer`** (`src/renderer.ts`) — frame-loop logic: event collection, video pool assignment, prewarm, building `TileParams` structs. Backend-agnostic.
- **`Renderer` interface** (`src/renderer-interface.ts`) — `resize / beginFrame / drawTile(TileParams) / endFrame / dispose`. Backends plug in here.

Two backends exist:

- **`WebGLRenderer`** (`src/webgl-renderer.ts`) — **default**. Uploads video frames as GPU textures (`gl.texImage2D`) — no CPU readback. UV rect and fit (cover/fill) computed CPU-side and passed as uniforms. Transforms (rotateZ, rotateX/Y scale, scaleX/Y) encoded as a 4×4 column-major matrix built on CPU. Blend modes use `blendFuncSeparate` so RGB and alpha channels accumulate correctly.
- **`Canvas2DRenderer`** (`src/canvas2d-renderer.ts`) — fallback. Uses `CanvasRenderingContext2D` / `drawImage`. Add `?renderer=canvas2d` to the URL to use it.

Backend selection in `main.ts`: WebGL2 is attempted first; if unavailable it falls back to Canvas 2D automatically. The `?renderer=canvas2d` query param forces Canvas 2D (useful for visual comparison during development).

`TextureCache` (`src/texture-cache.ts`) manages WebGL textures:
- Videos/streams: `texImage2D` every frame (content changes)
- Images: uploaded once, cached by element reference
- Colors: 1×1 RGBA texture, cached by `"r,g,b"` key
- All video elements are created with `crossOrigin = "anonymous"` (set in the pool factory in `main.ts`) so WebGL can upload them without CORS errors

## Pattern architecture

There is no class hierarchy. Everything is a Strudel `Pattern` with object-valued events. Controls are added to `Pattern.prototype` via `createMixParam` (in `create-mix-param.ts`), which uses a custom combiner that queries both patterns at frame time (like appBoth) but preserves the source pattern's whole span (like appLeft). See `docs/combinators.md` for details.

Key controls (all on Pattern.prototype):
- `.alpha()`, `.speed()`, `.x()`, `.y()`, `.width()`, `.height()`, `.scaleX()`, `.scaleY()`, `.objectfit()`, `.fit()`, `.blend()`
- `.x()` and `.y()` are **additive** (use `addOn` / appBoth) rather than replacement. This enables nested grid offset propagation: `inner.gridMod().x(0.1)` shifts the inner group within its outer cell. Exception: `_perEvent` controls (rand, irand, choose) fall back to appLeft for stable-per-onset sampling.
- `.grid(rows?, cols?, i?)` — positions in a grid cell; all args can be patterns; composes with existing position for nesting; `i` wraps with modulo so values >= rows×cols cycle back through the grid
- `.gridMod(rows?, cols?)` — assigns multiple grid cells to a child; all args can be patterns; stamps `layoutParent` on all output events
- `.p(id)` — registers pattern for rendering (`$` = anonymous/stacking, `S` prefix = solo, `_` prefix/suffix = mute)

Grid position composition: when `.grid()` is called on a pattern that already has position (from a prior `.grid()`), positions compose: `finalX = outer.x + inner.x * outer.width`. This enables grid-of-grids nesting.

**Nested grids**: `gridMod()` (and `grid()`, `circleMod()`, `circle()`) stamps a `layoutParent` token (unique per call site, assigned at construction time via `_layoutParentCounter`) on all output events. `applyIndex` in `index-patterns.ts` groups events sharing the same `(srcIdx, layoutParent)` as one logical slot when assigning `i`/`count`. This means an inner `index().gridMod()` group is treated as a single slot by an outer `index()`. `.i()` clears `layoutParent` to allow explicit slot overrides. Always use `stack(a, b, ...)` with separate args — `stack([a, b])` sequences the array into alternating events per cycle.

## User-facing API (available in the editor)

**Sources:** `mini(str)`, `color(str)`, `video(str)`, `image(str)`, `screen(str)` / `s(str)`

**Layout:** `gridStack(children, cols, rows)`, `stackN(n, ...patterns)`, `cycle(...args)`

**Indexing:** `index(...patterns)`, `indexCycle(...patterns)`, `indexWith(iLabel, countLabel, ...patterns)`, `indexCycleWith(iLabel, countLabel, ...patterns)`, `autoseed(...patterns)`

**Randomness (per-event stable):** `rand`, `rand2`, `irand(n)`, `brand`, `brandBy(p)`, `choose(...xs)`, `chooseWith(pat, xs)`, `wchoose(...pairs)`, `scramble(n)` / `.scramble(n)` — all stable for the duration of each hap, not per-frame flickering

**Strudel pattern transforms (re-exported):** `degradeBy(p)`, `degrade`, `undegradeBy(p)`, `undegrade`, `sometimesBy(p, fn)`, `sometimes(fn)`, `someCyclesBy(p, fn)`, `someCycles(fn)`, `often(fn)`, `rarely(fn)`, `almostNever(fn)`, `almostAlways(fn)`, `always(fn)`, `never(fn)`

**Media loading (imperative, idempotent):** `loadVideo(name, url)`, `loadImage(name, url)`, `loadCamera(name)`, `loadScreen(name)`

**Global:** `setCps(n)`, `setCpm(n)`, `hush()`

**Registration:** `$: expr` → `expr.p("$")` (stacking), `name: expr` → `expr.p("name")` (last write wins), `S` prefix = solo, `_` prefix/suffix = mute

**Key method controls on Pattern.prototype** (via `createMixParam`):
- Position/size: `.x()`, `.y()`, `.width()` / `.w()`, `.height()` / `.h()`
- Visual: `.alpha()`, `.scale()`, `.scaleX()`, `.scaleY()`, `.objectfit()`, `.blend()`
- Video: `.speed()`, `.start()`, `.end()`, `.duration()` / `.dur()`, `.scrub()`, `.sync()`, `.rolling()`, `.fit()`, `.urlBase()`
- Crop: `.cropx(n)`, `.cropy(n)`, `.cropw(n)`, `.croph(n)`, `.cropwh(n)`, `.crop(x, y, w, h)` — cropx/cropy are the **centre** of the crop window (default 0.5); cropw/croph are width/height fractions (negative = flip axis; 0 = single-pixel colour fill); crop outside [0,1] tiles the source
- Grid labelling: `.i(n)`, `.count(n)`, `.rows(n)`, `.cols(n)`, `.rowscols(n)`
- Circle labelling: `.radius(n)`, `.startOffset(n)`, `.circleCount(n)`
- Grid placement: `.grid(rows?, cols?, i?)`, `.gridMod(rows?, cols?)`
- Circle placement: `.circle(radius?, startOffset?, circleCount?, i?)`, `.circleMod(radius?, startOffset?, circleCount?)`
- Iteration: `.iteratorWith(fn)`, `.iterator()`
- Stack shuffling: `.shuffleStack(seed?)`, `.shuffleStackCycle(seed?)`
- Slice stacking: `.chopStack(n)`, `.syncStack(n)`, `.cropStack(rows, cols?)` — spatial frame-slicing into rows×cols tiles
- Field transforms: `.mapOn(key, fn)`, `.addOn(key, amt)`, `.subOn(key, amt)`, `.mulOn(key, amt)`, `.divOn(key, amt)`, `.modOn(key, amt)`, `.powOn(key, amt)`, `.setOn(key, amt)` — extract/transform/write back a named field; function forms also available: `mapOn(pat, key, fn)`, `addOn(pat, key, amt)`, etc.
- Misc: `.mapWithVal(fn)`, `.stackN(n)`

Example: `$: video("clip1.mp4 clip2.mp4").speed("0.5 1 -1").fit("contain")`
Example: `$: gridStack([color("red"), video("clip.mp4")], 2, 2)`
Example: `$: index(color("red"), color("blue")).rowscols(2).gridMod()`
Example: `$: video("a.mp4").i("0 1 2 3").rowscols(2).grid()`
Example: `$: stack(color("red"), color("blue"), color("green")).shuffleStack(42).index().rowscols(2).gridMod()`
Example: `loadVideo("clip", "https://example.com/vid.mp4"); $: video("clip")`
Example: `$: s("clip.mp4").chopStack(4).rowscols(2).gridMod()` — 4 simultaneous slices tiled in a 2×2 grid
Example: `$: stack(s("a.mp4"), s("b.mp4")).chopStack(4).index().rowscols(2).gridMod()` — chopStack on stacked sources; index() re-numbers all slices 0..7
Example: `$: s("clip.mp4").syncStack(4).rowscols(2).gridMod().rolling()` — 4 phase-offset copies (sync 0, 0.25, 0.5, 0.75) tiled in a grid
Example: `$: s("clip.mp4").cropStack(2).gridMod()` — slice frame into 2×2 tiles, reassembled into grid
Example: `$: s("clip.mp4").cropStack(2, 3).gridMod()` — 2 rows, 3 columns
Example: `$: s("clip.mp4").crop(0.5, 0.5, 0.5, 0.5)` — render center quarter of source (centre at 0.5,0.5; size 0.5×0.5), stretched to fill cell
Example: `$: s("clip.mp4").cropw(0.5).objectfit("contain")` — centre strip of source, letterboxed
Example: `$: s("clip.mp4").crop(0.25, 0.5, 0.5, 1).objectfit("contain")` — left half of source, letterboxed
Example: `$: s("clip.mp4").cropx(sine.range(0.25, 0.75)).cropw(0.5)` — sliding crop window
Example: `$: s("clip.mp4").cropw(1.2)` — slightly wider than source; edges tile
Example: `$: s("clip.mp4").cropwh(0.5)` — 2× zoom into centre (crops to centre quarter)
Example: `$: s("clip.mp4").cropwh(-1)` — full source, flipped both axes
Example: `$: s("clip.mp4").x(".1 -.1").mapOn('x', x => x.lerp())` — smoothly interpolate the x field between values
Example: `$: s("clip.mp4").alpha("0 1").mapOn('alpha', a => a.spline())` — spline-interpolate the alpha field
Example: `$: s("clip.mp4").speed("1 2").mulOn('speed', 0.5)` — halve the speed field arithmetically
Example (nested grid): `$: stack(stack(color("cyan"), color("magenta")).index().rowscols(2).gridMod(), color("red")).index().rowscols(2).gridMod()`

## Video playback speed

- Native HTML5 playback rates (0.0625–16.0) use `el.playbackRate` directly
- Rates outside this range (including negative/reverse) use manual seeking
- `setPlaybackRate()` in `src/playback-rate.ts` catches `NotSupportedError` to prevent the render loop from breaking

## Continuous playback modes: sync() vs rolling()

- **`.sync()`** — position is a pure function of elapsed clock time + speed. On re-eval, the video re-syncs to its clock position. Speed=0 snaps to `loopStart` (there is no "correct" clock position for a paused video).
- **`.rolling()`** — position is stateful and preserved across re-evals and speed changes. Speed=0 freezes the video at its current position; resuming continues from there. Implemented via `syncDistOffset` on the video element state.
- Both use `eventBeginFromHap` returning 0, and both use `computeSyncDistOffset` for speed/range-change continuity. The difference is that rolling skips the `syncDistOffset` reset on `isNewEvent`.
- `isNewEvent` in sync/rolling mode only fires on the **first frame after a fresh pool element is assigned** (not on new cycles) — because `eventBegin` is always 0, `lastEventBegin=0` persists across re-evals of the same element.
- `computeSyncDistOffset` in `src/sync-continuity.ts` handles speed=0 transitions: `oldSpeed=0` recovers frozen position from `syncOffset + oldDistOffset`; `newSpeed=0` returns `targetDistInLoop - syncOffset` to encode the freeze position as `distOffset`.

## Server component

The server (`server/`) is independent — separate package.json, separate `npm install`. It:
- Auto-downloads the `yt-dlp` binary on first run
- Bundles `ffmpeg-static` so no system ffmpeg is needed
- `GET /download?v=YOUTUBE_URL` — downloads video via yt-dlp, re-encodes as I-frame-only MP4, returns `{ url: "http://localhost:3456/videos/ID.mp4" }`
- `POST /upload?name=foo.mp4` — accepts raw binary body, re-encodes as I-frame-only MP4, returns `{ url, ready: true }`. Used for local file drag-and-drop.
- `GET /videos/ID.mp4` — serves cached/uploaded videos with range request support

### SERVER_ENABLED flag

`src/config.ts` exports `SERVER_ENABLED` (default `true`). When `false`:
- Drag-and-drop files are registered as blob URLs only (no upload to server)
- Intended for future public deployments where the Node server is not available
- Set this to `false` before deploying without the server

### Local file drag-and-drop upload

When `SERVER_ENABLED=true`, dropping a video file onto the sidebar video tab:
1. Adds the entry immediately with a blob URL (responsive — playable at once)
2. Uploads the file to `POST /upload` with XHR (for upload progress events)
3. Server re-encodes to I-frame-only MP4 via ffmpeg (same as YouTube downloads)
4. Entry URL swaps from blob to the server URL; thumbnail regenerated
5. Progress shown in the sidebar: `↑N%` during upload, `⚙` during transcode

**`MediaEntry` fields relevant to uploads:**
- `uploading?: boolean` — set while upload+transcode is in progress
- `uploadProgress?: number` — 0–1 during upload phase; `undefined` during transcode
- `error?: string` — set on failure (retry `↻` button appears)

**Blob URLs are never persisted to localStorage** — they're session-scoped and dead after reload. Entries mid-upload that don't complete before the page is closed are simply lost.

## Running & testing

```sh
# Frontend (from root)
npm install && npm run dev

# Server (from server/)
cd server && npm install && npm start

# Unit tests (from root) — vitest in browser mode via Playwright
npm test

# Monkey testing — generates random patterns and checks for crashes/errors
npm run test:monkey

# Replay saved failures as a conformance suite
npm run test:monkey:replay

# Stress testing — runs demanding video patterns, collects frame timing metrics
# Reports p50/p95/p99/max frame times, fails if p95 > 32ms (configurable)
npm run test:stress:headless
# Or with visible browser:
npm run test:stress
# Run only cases matching a substring (case-insensitive):
npx tsx test/stress-test.ts --case "rolling" --headless

# Upload integration test — end-to-end file drag-and-drop upload (requires port 3456 free)
npm run test:upload
```

### Test suite overview

Unit tests live in `src/*.test.ts` and run in Playwright browser mode via vitest. Beyond standard per-module unit tests, the suite includes five higher-level test layers that we should expand whenever possible:

- **Pipeline tests** (`playback-pipeline.test.ts`) — build real pattern chains, query them, and verify the full eventBeginFromHap → computeExpectedTime pipeline produces correct positions. Good place to add regression tests for specific pattern combos that break.
- **Invariant tests** (`playback-invariants.test.ts`) — property-based tests via fast-check verifying invariants that must hold for any inputs (position in range, continuity, monotonicity, etc.)
- **Simulation tests** (`playback-simulation.test.ts`) — step through pattern chains at 60fps, verify trace invariants, and test equivalence classes (e.g. alpha doesn't change position, speed(1) is identity)
- **Monkey testing** (`test/`):
  - `monkey-test.ts` — grammar-based random pattern generator, checks for crashes/errors
  - `regression-cases.json` — saved monkey failures for conformance replay
- **Stress testing** (`test/`) — `stress-test.ts` — performance regression: runs demanding video patterns, fails if p95 frame time > 32ms
- **Upload integration test** (`test/`) — `upload-integration-test.ts` — end-to-end Playwright test covering file drag-and-drop upload in both `SERVER_ENABLED=true` and `=false` modes. Catches CORS issues, XHR failures, and URL swap logic. Run with `npm run test:upload`.

### Performance profiling

The render loop is instrumented with `performance.mark` / `performance.measure` so Chrome DevTools shows per-phase timings on the timeline. The four named measures are:

| Measure name | What it covers |
|---|---|
| `uzu query` | Pattern `.queryArc()` calls — building the event list |
| `uzu assign` | Pool matching — scoring and assigning video/image elements |
| `uzu draw` | Video frame rendering + GPU dispatch (`beginFrame` → `endFrame`) |
| `uzu prewarm` | Lookahead query + prewarm element creation/seeking |

**Interactive profiling workflow (for exploratory investigation):**
1. `npm run dev` — start the dev server
2. Open Chrome at `http://localhost:5173`
3. Write and evaluate your pattern in the editor
4. Open DevTools → Performance tab → Record → interact for a few seconds → Stop
5. In the flame chart, look for `uzu query / uzu assign / uzu draw / uzu prewarm` in the "Timings" lane — these show exactly which phase is eating time. GPU work (compositing, texture upload) appears separately in the GPU track and is **not** captured by our JS marks.
6. The sidebar Perf tab shows a live frame-time graph and pool stats while you experiment.

**Note on total frame time:** our JS marks cover only JS execution. Browser compositing and GPU work happen after `endFrame()` and are not included — the inter-frame gap (shown in the perf panel as "frame gap") is the real perceived cost. If JS phases look fast but frame gap is high, the bottleneck is GPU-side (too many texture uploads, too large a canvas, etc.).

**Automated regression (`stress-test.ts`):**
- Reports `p50/p95` for each phase alongside total frame times in the stderr summary
- Use `--case <substring>` to target a single scenario during investigation
- Phase times are also in the JSON output (`cases[].phases.{query,assign,draw,prewarm}`)
- stress-test only measures JS-side frame times from `uzuMetrics`; it cannot see GPU work, video decode, or IPC costs

**Deep CDP trace profiling (`test/perf-trace.ts`):**

Use this when the stress-test shows `draw` is slow but you need to understand *why* — i.e. whether the cost is JS, GPU texture uploads, video decode, seek storms, or IPC backpressure. It opens a real browser, runs a pattern, captures a Chrome DevTools Protocol trace, and prints a structured summary.

To investigate a specific pattern:

1. Edit the `SETUP_CODE` and `PATTERN_CODE` constants at the top of `test/perf-trace.ts`. Set `SETUP_CODE = ""` if no imperative setup is needed (e.g. when `s("file.mp4")` resolves via `VIDEO_BASE` automatically).
2. Set `DURATION_MS` (total run time, including warmup) and `TRACE_DURATION_MS` (how long to actually record). Warmup = `DURATION_MS - TRACE_DURATION_MS`; use at least 10–15s warmup for pool settling. A 20s trace gives enough data for p95/p99.
3. Run: `npx tsx test/perf-trace.ts` (opens a visible browser window).
4. The script prints several analysis sections to stdout:
   - **Top events by total time** — the global leaderboard. `WebGL` / `CommandBuffer::Flush` totals reveal GPU pressure. `GpuChannelHost::VerifyFlush` is main-thread time *stalled waiting for GPU*.
   - **Inter-frame gaps** — p50/p95/max of time between `BeginMainThreadFrame` events. This is the real perceived frame rate, including GPU stalls.
   - **GPU/CC thread events** — work happening on the GPU process thread, separate from JS.
   - **Media/Video/Decode events** — `MojoVideoDecoder::Decode`, `MojoVideoDecoderService::OnDecoderOutput` (max here = decode spike causing a frame drop), `RendererImpl::SetPlaybackRate` (high call counts = excessive rate-setting each frame), `RendererImpl::StartPlayingFrom` (= seeks; high rate = seek storm).
   - **uzu named measures** — our `performance.measure` spans if captured (requires `blink.user_timing` category; may be empty in some configurations).
   - **Slow rAF frames** — events found *inside* rAF callbacks that took >20ms, to identify which JS operations correlate with frame drops.

Key things to look for:
- **GPU bottleneck**: `WebGL` total >> JS time, and `GpuChannelHost::VerifyFlush` is large → too many texture uploads per frame. Each active video tile costs one `texImage2D` per frame.
- **Decode spikes**: `MojoVideoDecoderService::OnDecoderOutput` max > 20ms → decoder stall. Caused by seeks or too many concurrent streams.
- **Seek storm**: `RendererImpl::StartPlayingFrom` count / frame count > 1 → seeks every frame, usually from pool churn (shuffleStack reorder, pattern re-eval, syncStack element turnover).
- **Rate-set overhead**: `RendererImpl::SetPlaybackRate` count / frame count >> active tile count → calling setPlaybackRate on elements that haven't changed speed.

## Documentation

When adding or changing user-facing features, update the following:
1. **CLAUDE.md** — a quick mention of functionality and where to look for it
1. **`GUIDE.md`** — the human-readable user guide. Add a section or update the relevant section with examples, a parameter table, and behaviour notes.
2. **JSDoc in the source file** — automatically extracted by `vite-plugin-reference.ts` and displayed in the sidebar reference tab.

The plugin scans source files listed in `buildReferenceData()` in `vite-plugin-reference.ts` — add new files there when creating new user-facing modules. It matches `/** ... */ export function name` and `/** ... */ PatternProto.name =` patterns. Use `@param` for parameters and `@example` for usage examples. Categories are defined in the `fileMap` array (e.g. "Sources", "Controls", "Layout", "Indexing").

## Git commit style

- Do not add Co-Authored-By lines for AI/LLM assistants
- Do note in the commit body that LLM assistance was used, e.g. "Written with Claude."

## Communication style

- The user likes to be questioned when their assumptions are incorrect. They are delighted to find out that they're wrong.
- It can be worth asking explicitly if it's better to try to make small local changes to make something work, or to zoom out and shift how the system operates at a higher level. 
- Expressing uncertainty is good. Asking if it's worth researching deeper is good. Asking for help is good.
- It's good to check your work - if you can run tests to make sure things are valid, do so.

## Workflow when making changes

When working through a list of tasks, **stop and check in with the user after completing each one** — don't proceed to the next task without confirmation. For each task:
1. **Write a failing test first** (red) — unit test in `src/*.test.ts` and monkey tester coverage in `test/monkey-test.ts`. Skip this only when the change is config-only, or otherwise impractical to test upfront.
2. **Implement the change** to make the test pass (green)
3. When adding new user-facing functionality, also add coverage to the monkey tester
4. Run `npm test` (unit tests)
5. Run monkey testing: `npm run test:monkey` and `npm run test:monkey:replay`
5b. For performance-sensitive changes (video playback, pool management, render loop): also run `npm run test:stress:headless`
6. Report what was done and wait for go-ahead
7. Don't commit changes unless asked

Don't edit README yourself! This is a human written document. But do prompt the user if it's out of date.


## Key patterns to know

- Strudel patterns have a `.queryArc(start, end)` method returning events with `.value`
- `reify()` turns any value (number, string, Pattern) into a Pattern — use it uniformly, don't branch on type
- `createMixParam(name)` registers a control on Pattern.prototype using a custom combiner that queries both patterns at frame time while preserving the source's whole span (see `docs/combinators.md`)
- `.grid()` uses `new Pattern((state) => ...)` for query-time resolution; `state.span.begin`/`end` are Fraction objects
- `composePos()` handles grid nesting by composing inner position relative to outer cell
- Mininotation `,` = `stack()` (simultaneous), ` ` = alternation; `"0,3"` in `.grid()` means both cells at once
- Mininotation `/` is the "slow by N" operator, so URLs can't go in mini patterns — use `.urlBase()` instead
- The transpiler wraps double-quoted strings in `mini()`. Use single quotes for literal string arguments like `.urlBase('/path/')` — double quotes would parse `/` as mininotation
- Strudel Fraction types produce repeating-decimal strings — always use `Number(v)` before arithmetic
- The `videoPool` and `imagePool` Maps cache media elements by full URL to avoid re-creation
- Config constants live in `src/config.ts` — timing values are in milliseconds
- **`_onset` is baked into video event values** for playback timing — `eventBeginFromHap` in main.ts uses it to determine where the video should be playing from. Any function that produces video events (`video()`, `screen()`) must wrap in `new PatternClass((state) => ...)` and set `_onset: Number(hap.whole.begin)` on the value
