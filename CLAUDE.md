# uzuvid - agent orientation doc

> This file is machine-authored for use by coding agents. Last updated 2026-03-08.

## What is this?

uzuvid is a live-coding visual performance tool. Users write JavaScript in a browser-based editor (CodeMirror), hit Ctrl+Enter to evaluate, and the code controls what gets drawn to a fullscreen canvas. It uses Strudel's mininotation system for rhythmic patterns of colors and videos.

## Design principles

- **No fast paths** — treat everything uniformly as patterns. No `typeof` shortcuts or separate code paths for literal values vs patterns. `reify()` handles both.
- **Everything resolves at query time, not build time** — grid size, position, children, all parameters come from pattern resolution at the moment of query. No baking in values at construction time.
- **One code path** — avoid branching on "is this a number or a pattern?". The same logic should handle both.
- **Prefer simplicity and deletion** — remove code rather than add special cases. Three similar lines are better than a premature abstraction.
- **Patterns all the way down** — everything is a Strudel Pattern with object values. Controls are methods on Pattern.prototype via `createMixParam`. No class hierarchy.

## Project structure

```
uzuvid/
  index.html              — single-page app shell, loads src/main.ts via Vite
  vitest.config.ts        — vitest config (browser mode via Playwright)
  package.json            — Vite dev server, Strudel + CodeMirror deps
  notes.md                — design notes (human-authored, aspirational, not all implemented)
  TODO.md                 — current task list
  src/
    main.ts               — core runtime: pattern state, video pool, render loop, eval bridge
    editor.ts             — CodeMirror 6 editor setup, Ctrl+Enter eval binding
    config.ts             — constants: REVERSE_SEEK_INTERVAL (ms), VIDEO_BASE, IMAGE_BASE, CYCLES_PER_SECOND
    transpiler.ts         — $: label transpiler, double-quote mini() wrapping
    visual-controls.ts    — createMixParam, position/grid/speed/alpha controls on Pattern.prototype
    grid-stack.ts         — gridStack() and four() helpers using .gridModulo()
    color-pattern.ts      — color() function: wraps mini pattern with {color} values
    video-pattern.ts      — video() function: wraps mini pattern with {src} values
    image-pattern.ts      — image() function: wraps mini pattern with {src, type:"image"} values
    draw-fit.ts           — drawFit() helper for cover/contain/fill/none rendering, FitMode type
    video-playback.ts     — video frame rendering: playback update, seeking
    playback-rate.ts      — setPlaybackRate helper, native rate range constants
    time-value.ts         — TimeValue type and parsing (relative, seconds, milliseconds)
    pattern-extensions.ts — .lerp(), .spline(), .sec(), .ms() pattern extensions
  test/
    monkey-test.ts        — grammar-based random pattern generator + browser runner
    monkey-failures.json  — saved failure cases for conformance replay
    image-assets.txt      — list of image URLs for monkey testing
  server/                 — standalone Node.js package (separate npm install)
    server.js             — HTTP server: downloads YouTube videos via yt-dlp, serves MP4s
    server.test.js        — tests (node --test), mocks spawn to avoid real downloads
    package.json          — deps: yt-dlp-wrap, ffmpeg-static
```

## How the frontend works

1. `src/main.ts` maintains a `screens` array collected from `.p()` registrations each eval cycle.
2. The transpiler converts `$: expr` lines into `expr.p("$")` calls, and wraps double-quoted strings in `mini()`.
3. The render loop runs at requestAnimationFrame rate. Each frame it:
   - Computes cycle position from elapsed time and `cyclesPerSecond`
   - Queries each screen pattern with `queryArc(t, t + 0.001)`
   - Draws each event: resolves position (x/y/width/height), alpha, scale, fit, then renders color/video/image
4. `window.uzuEval(code)` is called by the editor. It transpiles, clears state, then runs the code as a `new Function`.

## Pattern architecture

There is no class hierarchy. Everything is a Strudel `Pattern` with object-valued events. Controls are added to `Pattern.prototype` via `createMixParam` (in `visual-controls.ts`), which uses Strudel's `set.mix` (appBoth) combinator to merge properties at query time.

Key controls (all on Pattern.prototype):
- `.alpha()`, `.speed()`, `.x()`, `.y()`, `.width()`, `.height()`, `.scaleX()`, `.scaleY()`, `.fit()`
- `.grid(i, cols, rows)` — positions in a grid cell; all args can be patterns; composes with existing position for nesting
- `.gridModulo(childIndex, numChildren, cols, rows)` — assigns multiple grid cells to a child; all args can be patterns
- `.p(id)` — registers pattern for rendering (`$` = anonymous/stacking, `S` prefix = solo, `_` prefix/suffix = mute)

Grid position composition: when `.grid()` is called on a pattern that already has position (from a prior `.grid()`), positions compose: `finalX = outer.x + inner.x * outer.width`. This enables grid-of-grids nesting.

## User-facing API (available in the editor)

- `mini(str)` — raw Strudel mininotation, returns a pattern
- `color(str)` — pattern of `{color}` objects
- `video(str)` — pattern of `{src}` objects (video filenames from VIDEO_BASE)
- `image(str)` — pattern of `{src, type:"image"}` objects (image filenames from IMAGE_BASE)
- `gridStack(children[], cols, rows)` — distributes children across grid cells via `.gridModulo()`
- `four(children[])` — shorthand for `gridStack(children, 2, 2)`
- `setCps(n)` — set cycles per second
- `$: expr` — transpiled to `expr.p("$")`, registers pattern for rendering
- `name: expr` — transpiled to `expr.p("name")`, named pattern (last write wins)

Example: `$: video("clip1.mp4 clip2.mp4").speed("0.5 1 -1").fit("contain")`
Example: `$: gridStack([color("red"), video("clip.mp4")], 2, 2)`
Example: `$: video("a.mp4").grid("0,1,2,3", 2, 2)` — same video in all 4 cells

## Video playback speed

- Native HTML5 playback rates (0.0625–16.0) use `el.playbackRate` directly
- Rates outside this range (including negative/reverse) use manual seeking
- `setPlaybackRate()` in `src/playback-rate.ts` catches `NotSupportedError` to prevent the render loop from breaking

## Server component

The server (`server/`) is independent — separate package.json, separate `npm install`. It:
- Auto-downloads the `yt-dlp` binary on first run
- Bundles `ffmpeg-static` so no system ffmpeg is needed
- `GET /download?v=YOUTUBE_URL` — downloads video, returns `{ url: "http://localhost:3456/videos/ID.mp4" }`
- `GET /videos/ID.mp4` — serves cached videos with range request support

## Running & testing

```sh
# Frontend (from root)
npm install && npm run dev

# Server (from server/)
cd server && npm install && npm start

# Unit tests (from root) — vitest in browser mode via Playwright
npm test

# Monkey testing — generates random patterns and checks for crashes/errors
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
3. When adding new user-facing functionality, also add coverage to the monkey tester
4. Run `npm test` (unit tests)
5. Run monkey testing: `npx run test:monkey` and `npm run test:monkey:replay`
6. Report what was done and wait for go-ahead

## Key patterns to know

- Strudel patterns have a `.queryArc(start, end)` method returning events with `.value`
- `reify()` turns any value (number, string, Pattern) into a Pattern — use it uniformly, don't branch on type
- `createMixParam(name)` registers a control on Pattern.prototype using `set.mix` (appBoth), which queries both patterns at frame time
- `.grid()` uses `new Pattern((state) => ...)` for query-time resolution; `state.span.begin`/`end` are Fraction objects
- `composePos()` handles grid nesting by composing inner position relative to outer cell
- Mininotation `,` = `stack()` (simultaneous), ` ` = alternation; `"0,3"` in `.grid()` means both cells at once
- Mininotation `/` is the "slow by N" operator, so URLs can't go in mini patterns — use `.urlBase()` instead
- Strudel Fraction types produce repeating-decimal strings — always use `Number(v)` before arithmetic
- The `videoPool` and `imagePool` Maps cache media elements by full URL to avoid re-creation
- Config constants live in `src/config.ts` — timing values are in milliseconds
