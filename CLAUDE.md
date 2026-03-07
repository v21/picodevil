# uzuvid - agent orientation doc

> This file is machine-authored for use by coding agents. Last updated 2026-03-06.

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
    config.ts             — constants: REVERSE_SEEK_INTERVAL (ms), VIDEO_BASE, CYCLES_PER_SECOND
    video-pattern.ts      — VideoPattern class: wraps Strudel pattern with video props
    color-pattern.ts      — ColorPattern class: wraps Strudel pattern for color output
    outputable.ts         — Outputable interface (`.out()` method)
    video-playback.ts     — video frame rendering: playback update, seeking, cover-fit drawing
    playback-rate.ts      — setPlaybackRate helper, native rate range constants
    time-value.ts         — TimeValue type and parsing (relative, seconds, milliseconds)
    pattern-extensions.ts — .lerp(), .spline(), .sec(), .ms() pattern extensions
    playback-rate.test.ts — tests for playback rate error handling
    video-pattern.test.ts — tests for VideoPattern
  test/                   — integration tests
    monkey-test.ts        — grammar-based random pattern generator + browser runner
    monkey-failures.json  — saved failure cases for conformance replay
  server/                 — standalone Node.js package (separate npm install)
    server.js             — HTTP server: downloads YouTube videos via yt-dlp, serves MP4s
    server.test.js        — tests (node --test), mocks spawn to avoid real downloads
    package.json          — deps: yt-dlp-wrap, ffmpeg-static
    bin/                  — auto-downloaded yt-dlp binary (gitignored)
    videos/               — downloaded video cache (gitignored)
```

## How the frontend works

1. `src/main.ts` maintains a `pattern` (Strudel pattern object) and a `videoPattern` (VideoPattern | null).
2. The render loop runs at requestAnimationFrame rate. Timing is in **milliseconds** (converted to seconds only for cycle calculation). Each frame it:
   - Computes cycle position from elapsed time and `cyclesPerSecond`
   - Queries `pattern` for the current color, fills the canvas
   - If `videoPattern` is set, queries it for a video value (src + speed), draws that video frame on top
3. `window.uzuEval(code)` is called by the editor. It runs the code as a `new Function` body with `mini`, `color`, and `video` as available functions.
4. The default editor code is evaluated automatically at startup.

## Output model

Patterns use an explicit `.out()` method to push themselves as the active pattern (rather than returning from eval). Both `ColorPattern` and `VideoPattern` implement the `Outputable` interface. Internally, `.out()` calls a callback passed at construction time that sets the pattern on `src/main.ts` state.

## User-facing API (available in the editor)

- `mini(str)` — raw Strudel mininotation, returns a pattern
- `color(str)` — returns a `ColorPattern`, also clears any active video
- `video(str)` — returns a `VideoPattern` of video filenames (served from `http://localhost:3456/videos/`)

Chainable methods on VideoPattern:
- `.speed(str | number)` — playback speed pattern (supports negative for reverse)
- `.out()` — set as active video pattern

Chainable methods on ColorPattern:
- `.out()` — set as active color pattern

Example: `video("clip1.mp4 clip2.mp4").speed("0.5 1 -1").out()`

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
1. Make the change
2. Run `npm test` (unit tests)
3. Run monkey testing: `npx tsx test/monkey-test.ts --rounds 10 --delay 1000 --headless`
4. Commit if green
5. Report what was done and wait for go-ahead

## Key patterns to know

- Strudel patterns have a `.queryArc(start, end)` method returning events with `.value`
- The `videoPool` Map caches `<video>` elements by filename to avoid re-creation
- The server's `createServer(opts)` is exported for testability; tests pass `spawnFn` to mock yt-dlp
- Config constants live in `src/config.ts` — timing values are in milliseconds
