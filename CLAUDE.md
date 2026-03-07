# uzuvid - agent orientation doc

> This file is machine-authored for use by coding agents. Last updated 2026-03-07.

## What is this?

uzuvid is a live-coding visual performance tool. Users write JavaScript in a browser-based editor (CodeMirror), hit Ctrl+Enter to evaluate, and the code controls what gets drawn to a fullscreen canvas. It uses Strudel's mininotation system for rhythmic patterns of colors and videos.

## Project structure

```
uzuvid/
  index.html              — single-page app shell, loads src/main.ts via Vite
  vitest.config.ts        — vitest config (browser mode via Playwright)
  package.json            — Vite dev server, Strudel + CodeMirror deps
  notes.md                — design notes (human-authored, aspirational, not all implemented)
  TODO.md                 — current task list
  src/                    — frontend source (all .ts)
    main.ts               — core runtime: pattern state, video pool, render loop, eval bridge
    editor.ts             — CodeMirror 6 editor setup, Ctrl+Enter eval binding
    config.ts             — constants: REVERSE_SEEK_INTERVAL (ms), VIDEO_BASE, IMAGE_BASE, CYCLES_PER_SECOND
    screen-pattern.ts     — ScreenPattern abstract base class, ScreenProps, FitMode type
    video-pattern.ts      — VideoPattern class: extends ScreenPattern with video props
    color-pattern.ts      — ColorPattern class: extends ScreenPattern for color output
    image-pattern.ts      — ImagePattern class: extends ScreenPattern for static images
    grid-pattern.ts       — GridPattern class: extends ScreenPattern for grid layouts
    draw-fit.ts           — shared drawFit() helper for cover/contain/fill/none rendering
    video-playback.ts     — video frame rendering: playback update, seeking
    playback-rate.ts      — setPlaybackRate helper, native rate range constants
    time-value.ts         — TimeValue type and parsing (relative, seconds, milliseconds)
    pattern-extensions.ts — .lerp(), .spline(), .sec(), .ms() pattern extensions
    playback-rate.test.ts — tests for playback rate error handling
    video-pattern.test.ts — tests for VideoPattern
  test/                   — integration tests
    monkey-test.ts        — grammar-based random pattern generator + browser runner
    monkey-failures.json  — saved failure cases for conformance replay
    image-assets.txt      — list of image URLs for monkey testing
  server/                 — standalone Node.js package (separate npm install)
    server.js             — HTTP server: downloads YouTube videos via yt-dlp, serves MP4s
    server.test.js        — tests (node --test), mocks spawn to avoid real downloads
    package.json          — deps: yt-dlp-wrap, ffmpeg-static
    bin/                  — auto-downloaded yt-dlp binary (gitignored)
    videos/               — downloaded video cache (gitignored)
```

## How the frontend works

1. `src/main.ts` maintains a `screens: ScreenPattern[]` stack. Each eval (Ctrl+Enter) tears down and rebuilds the stack.
2. The render loop runs at requestAnimationFrame rate. Timing is in **milliseconds** (converted to seconds only for cycle calculation). Each frame it:
   - Computes cycle position from elapsed time and `cyclesPerSecond`
   - Draws each screen in stack order (bottom to top), applying per-screen alpha and fit mode
3. `window.uzuEval(code)` is called by the editor. It clears all state (videos, images, screens) then runs the code as a `new Function` body with `mini`, `color`, `video`, `image`, `grid`, `four`, `setCps`, and Strudel signals available.

## Screen architecture

All screen types extend `ScreenPattern` (in `src/screen-pattern.ts`), which provides:
- `.alpha(pat)` / `.opacity(pat)` — screen opacity (pattern or signal)
- `.fit(mode)` — object-fit mode: `"cover"` (default), `"contain"`, `"fill"`, `"none"`
- `.scaleX(pat)` / `.scaleY(pat)` — scale on X/Y axis (pattern or signal)
- `.scale(pat)` — set both scaleX and scaleY (overrides earlier scaleX/scaleY)
- `.out()` — push screen onto the stack

Each subclass uses immutable builder pattern — every method returns a new instance. Subclasses implement `_cloneWithScreenProps()` to propagate shared screen props through their own constructors.

Screen types: `ColorPattern`, `VideoPattern`, `ImagePattern`, `GridPattern`.

## User-facing API (available in the editor)

- `mini(str)` — raw Strudel mininotation, returns a pattern
- `color(str)` — returns a `ColorPattern` (supports all CSS color names and hex codes)
- `video(str)` — returns a `VideoPattern` of video filenames (served from VIDEO_BASE)
- `image(str)` — returns an `ImagePattern` of image filenames (served from IMAGE_BASE)
- `grid(children[], cols, rows)` — returns a `GridPattern` arranging children in a grid
- `four(children[])` — shorthand for `grid(children, 2, 2)`
- `setCps(n)` — set cycles per second

Shared chainable methods (all screen types):
- `.alpha(pat)` / `.opacity(pat)` — screen opacity
- `.fit("cover" | "contain" | "fill" | "none")` — object-fit mode
- `.scaleX(pat)` / `.scaleY(pat)` — scale on X/Y axis
- `.scale(pat)` — set both scaleX and scaleY
- `.out()` — push to screen stack

VideoPattern-specific methods:
- `.speed(pat)` — playback speed (supports negative for reverse)
- `.start(pat)` / `.end(pat)` / `.duration(pat)` / `.dur(pat)` — loop region
- `.scrub(pat)` — scrub to position (sets start + duration(0))
- `.urlBase(str)` — custom video URL prefix

ImagePattern-specific methods:
- `.urlBase(str)` — custom image URL prefix

GridPattern (grid/four):
- Children array cycles when fewer elements than grid cells
- Children are cloned per cell (random patterns evaluate independently)
- Grids are nestable (a grid can contain other grids)
- Rendering uses coordinate-space transforms (children render as if full-canvas)
- Each grid tracks per-cell video state via `cellState` array

Example: `video("clip1.mp4 clip2.mp4").speed("0.5 1 -1").fit("contain").out()`
Example: `four([color("red"), video("clip.mp4"), image("pic.png"), color("blue")]).out()`
Example: `grid([video("a.mp4"), video("b.mp4")], 3, 3).alpha("0.8").out()`

## Video playback speed

- Native HTML5 playback rates (0.0625–16.0) use `el.playbackRate` directly
- Rates outside this range (including negative/reverse) use manual seeking: the video is paused, wall-clock time accumulates, and `el.currentTime` is set every `REVERSE_SEEK_INTERVAL` ms
- `setPlaybackRate()` in `src/playback-rate.ts` catches `NotSupportedError` to prevent the render loop from breaking
- `isNativeRate()` checks if a rate is within Chrome's supported range

## Server component

The server (`server/`) is independent — separate package.json, separate `npm install`. It:
- Auto-downloads the `yt-dlp` binary on first run
- Bundles `ffmpeg-static` so no system ffmpeg is needed
- `GET /download?v=YOUTUBE_URL` — downloads video, returns `{ url: "http://localhost:3456/videos/ID.mp4" }`
- `GET /videos/ID.mp4` — serves cached videos with range request support
- Files are named by YouTube video ID (e.g. `aGMOFLgB1CU.mp4`)

## Running & testing

```sh
# Frontend (from root)
npm install && npm run dev

# Server (from server/)
cd server && npm install && npm start
# or: npm run dev  (auto-reload)

# Unit tests (from root) — vitest in browser mode via Playwright
npm test

# Monkey testing — generates random patterns and checks for crashes/errors
# Requires: video server running (cd server && npm start)
npx tsx test/monkey-test.ts --rounds 10 --delay 1000 --headless

# Replay saved failures as a conformance suite
npx tsx test/monkey-test.ts --replay --delay 1000 --headless
```

## Git commit style

- Do not add Co-Authored-By lines for AI/LLM assistants
- Do note in the commit body that LLM assistance was used, e.g. "Written with LLM assistance."

## Workflow when making changes

When working through a list of tasks, **stop and check in with the user after completing each one** — don't proceed to the next task without confirmation. For each task:
1. **Write a failing test first** (red) — unit test in `src/*.test.ts` or monkey tester coverage in `test/monkey-test.ts`, whichever is appropriate. Skip this only when the change is purely visual, config-only, or otherwise impractical to test upfront.
2. **Implement the change** to make the test pass (green)
3. When adding new user-facing functionality (methods, screen types, etc.), also add coverage to the monkey tester (`test/monkey-test.ts`) so it generates random expressions exercising the new feature
4. Run `npm test` (unit tests)
5. Run monkey testing: `npx tsx test/monkey-test.ts --rounds 10 --delay 1000 --headless`
6. Report what was done and wait for go-ahead
7. Ask to commit, if the change is large

## Key patterns to know

- Strudel patterns have a `.queryArc(start, end)` method returning events with `.value`
- The `videoPool` and `imagePool` Maps cache media elements by full URL to avoid re-creation
- Screen types use immutable builder pattern — methods return new instances, never mutate
- `ScreenProps` bag carries shared properties (alpha, fit); subclasses propagate via `_cloneWithScreenProps()`
- Mininotation slashes are the "slow by N" operator, so URLs can't go in mini patterns — use `.urlBase()` instead
- Strudel Fraction types produce repeating-decimal strings like `"15.(103...)"` — always use `Number(v)` before `parseTimeValue()`
- The server's `createServer(opts)` is exported for testability; tests pass `spawnFn` to mock yt-dlp
- Config constants live in `src/config.ts` — timing values are in milliseconds
