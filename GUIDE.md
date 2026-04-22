# uzuvid user guide

uzuvid is a live-coding visual instrument. You write JavaScript in a browser editor, press **Ctrl+Enter** to evaluate, and the code controls what gets drawn to a fullscreen canvas. Everything is built on rhythmic patterns from [Strudel](https://strudel.cc).

## Getting started

```
npm install && npm run dev
```

Open the browser. Type code in the editor. Press Ctrl+Enter to run it.

## Basic concepts

Everything in uzuvid is a **pattern** — a function of time that produces values. Patterns cycle: each cycle, the pattern repeats. The default speed is 0.5 cycles per second (one cycle = 2 seconds).

### The `$:` syntax

Lines starting with `$:` register a pattern for rendering. You can have multiple `$:` lines — they all draw simultaneously, layered on top of each other.

```js
$: color("red blue")
$: video("clip.mp4")
```

You can also use named labels. Names are unique (last write wins), while `$:` lines stack:

```js
bg: color("black")
fg: video("clip.mp4")
```

Prefix a name with `_` or add a trailing `_` to mute it. Prefix with `S` to solo it.

```js
_bg: color("black")   // muted
Sfg: video("clip.mp4") // soloed
```

## Sources

### `color(mininotation)`

Fills the screen (or grid cell) with a CSS color.

```js
$: color("red")
$: color("red blue green")        // alternates each cycle
$: color("#ff0000 cyan darkblue")
```

### `video(mininotation)`

Plays video files. Videos are served from the server component (localhost:3456).

```js
$: video("clip1.mp4")
$: video("clip1.mp4 clip2.mp4")   // alternates each cycle
```

### `image(mininotation)`

Displays still images from the server.

```js
$: image("photo.jpg")
$: image("a.png b.jpg")
```

## Mininotation

uzuvid uses Strudel's mininotation for expressing patterns concisely. **Double-quoted strings** are automatically treated as mininotation. Single-quoted strings are plain strings (used for literal arguments like file paths).

### Key mininotation syntax

| Syntax  | Meaning                     | Example                                  |
| ------- | --------------------------- | ---------------------------------------- |
| `space` | Divide time equally         | `"a b c"` — three equal parts per cycle  |
| `,`     | Stack (play simultaneously) | `"a , b"` — both at once                 |
| `*N`    | Repeat N times              | `"a*4"` — four times per cycle           |
| `/N`    | Slow down by N              | `"a/2"` — once every 2 cycles            |
| `< >`   | Alternate per cycle         | `"<a b c>"` — a different one each cycle |
| `[ ]`   | Group                       | `"[a b] c"` — a and b share first half   |
| `!N`    | Replicate                   | `"a!3"` — same as `"a a a"`              |
| `?`     | Sometimes rest              | `"a?"` — 50% chance of silence           |
| `~`     | Rest (silence)              | `"a ~ b"` — gap in the middle            |

```js
$: color("red blue green")            // 3 colors per cycle
$: color("<red blue> <green yellow>") // alternates across cycles
$: video("clip.mp4*2 clip2.mp4")      // clip1 twice then clip2
```

### `mini(str)`

You can call `mini()` explicitly if you need the raw pattern (returns string values, not wrapped in color/video/image):

```js
$: color(mini("red blue").slow(2))
```

## Controls

All controls are methods you chain onto a pattern. Every control accepts patterns (including mininotation strings) as arguments.

### Position and size

By default, each pattern fills the entire canvas (x=0, y=0, width=1, height=1). Values are 0–1 relative to the canvas.

```js
$: color("red").x(0.5).width(0.5)          // right half
$: video("clip.mp4").x("0 0.5").width(0.5) // bounces left/right
```

| Method       | Description         | Default |
| ------------ | ------------------- | ------- |
| `.x(v)`      | Horizontal offset   | 0       |
| `.y(v)`      | Vertical offset     | 0       |
| `.width(v)`  | Width               | 1       |
| `.height(v)` | Height              | 1       |

`.x()` and `.y()` are **additive**: each call shifts by the given amount rather than setting an absolute position. This makes them work correctly with nested grids — `inner.gridMod().x(0.1)` shifts the whole inner group by 0.1 within its outer cell without affecting the outer layout. At the top level the behaviour is the same: `0 + v = v`.

### Transparency

```js
$: video("clip.mp4").alpha(0.5)
$: color("red").alpha("1 0.5 0")   // patterned alpha
```

### Scale

```js
$: video("clip.mp4").scale(0.5)          // half size (both axes)
$: video("clip.mp4").scaleX(2).scaleY(0.5) // stretch/squash
```

### Fit mode

Controls how video/image content fits within its cell. Options: `cover` (default), `contain`, `fill`, `none`.

```js
$: video("clip.mp4").fit("contain")
$: video("clip.mp4").fit("cover contain")  // alternates
```

- **cover** — fills the cell, cropping as needed (no letterboxing)
- **contain** — fits entirely within the cell (may letterbox)
- **fill** — stretches to fill exactly (may distort)
- **none** — draws at native resolution, centered

### Crop

Crop the source to a rectangle defined in normalized [0,1] source coordinates, then fit the cropped region into the cell using the current `objectfit` mode.

`cropx`/`cropy` are the **centre** of the crop window, not the top-left corner. `cropw`/`croph` are the width and height of the window as fractions of the source dimensions. Negative `cropw`/`croph` flips the axis. `cropwh(0)` samples a single pixel (fills the cell with that colour).

```js
$: video("clip.mp4").crop(0.5, 0.5, 0.5, 0.5)  // center quarter, stretched to fill
$: video("clip.mp4").cropw(0.5)                  // left half (centre default 0.5 → covers [0.25, 0.75])
$: video("clip.mp4").crop(0.25, 0.5, 0.5, 1).objectfit("contain")  // left half, letterboxed
$: video("clip.mp4").cropx(0.75).cropw(0.5)     // right half
$: video("clip.mp4").cropw(-1)                   // full source, horizontally flipped
$: video("clip.mp4").cropwh(-1)                  // full source, flipped both axes
```

| Method         | Description                                                      | Default |
| -------------- | ---------------------------------------------------------------- | ------- |
| `.cropx(v)`    | Horizontal centre of crop window in source coords (0–1)          | 0.5     |
| `.cropy(v)`    | Vertical centre of crop window in source coords (0–1)            | 0.5     |
| `.cropw(v)`    | Width of crop as fraction of source width; negative = flip       | 1       |
| `.croph(v)`    | Height of crop as fraction of source height; negative = flip     | 1       |
| `.cropwh(v)`   | Sets both cropw and croph; 0 = single-pixel colour fill          | 1       |
| `.crop(x,y,w,h)` | Shorthand for all four at once (x,y are centres)              |         |

All arguments accept patterns and signals:

```js
$: video("clip.mp4").cropx(sine.range(0.25, 0.75)).cropw(0.5)  // sliding crop window
$: video("clip.mp4").cropx("0.25 0.75").cropw(0.5)              // alternating halves
```

**Aspect ratio**: the cropped region's own aspect ratio is what `objectfit` applies to. `.objectfit("contain")` letterboxes the crop; `.objectfit("fill")` stretches it (ignoring aspect ratio).

**Tiling**: if the crop window extends outside [0,1] — for example `cropw(1.2)` with the default centre of 0.5 gives a window from −0.1 to 1.1 — the source wraps/tiles to fill the region.

```js
$: video("clip.mp4").cropw(1.2).objectfit("fill")  // slight tile wrap at edges
$: video("clip.mp4").crop(0.5, 0.5, 1.2, 1)        // same, explicit centre
```

### Video speed

```js
$: video("clip.mp4").speed(2)       // double speed
$: video("clip.mp4").speed(-1)      // reverse playback
$: video("clip.mp4").speed("1 2 -1") // patterned speed
$: video("clip.mp4").speed(0.5)     // half speed
```

Negative speeds play in reverse via manual seeking. Very slow or very fast rates outside the browser's native range (0.0625–16) also use manual seeking.

### Video start/end/duration

Control which portion of the video plays. Values are relative to video duration by default (0–1), or you can use `.sec()` / `.ms()` for absolute time.

```js
$: video("clip.mp4").start(0.5)              // start halfway through
$: video("clip.mp4").start(0.25).end(0.75)   // play middle 50%
$: video("clip.mp4").start(0).duration(0.25)  // play first quarter
$: video("clip.mp4").scrub(0.5)               // freeze at 50% (start + duration(0))
```

For absolute times:

```js
$: video("clip.mp4").start(mini("5").sec())     // start at 5 seconds
$: video("clip.mp4").duration(mini("500").ms())  // play 500ms
```

### Continuous playback: sync() and rolling()

By default, each cycle a video restarts from the beginning (or from `.start()`). Two modes let you play continuously:

**`.sync()`** — plays relative to the global clock, ignoring cycle boundaries. Position is a pure function of elapsed time and speed, so re-evaluating code resyncs the video to where it "should" be at that moment.

```js
$: video("clip.mp4").sync()              // plays continuously from cycle 0
$: video("clip.mp4").sync(0.5)           // phase-shifted: starts 50% through the video
$: video("clip.mp4").speed(2).sync()     // double speed, continuous
```

**`.rolling()`** — position is preserved across re-evals and speed changes. Speed=0 freezes in place; resuming continues from the frozen position. Use this when you want manual, history-dependent control over playback.

```js
$: video("clip.mp4").rolling()              // continues from wherever it was
$: video("clip.mp4").speed("0 1").rolling() // freeze half-cycle, advance half-cycle
$: video("clip.mp4").speed("-1 0").rolling() // reverse then freeze in place
$: video("clip.mp4").speed(sine).rolling()  // smooth continuous speed modulation
```

Combining both: `rolling()` takes precedence for a playing video; `sync()` initialises a freshly-loaded one.

```js
$: video("clip.mp4").sync().rolling()  // sync on first load, rolling thereafter
```

### URL base

Change where media files are loaded from:

```js
$: video("clip.mp4").urlBase('http://other-server/videos/')
```

Note: use single quotes for `.urlBase()` since double quotes trigger mininotation parsing.

## Grids

The grid system is built around two complementary ideas: **labelling** patterns with their position in a stack, and **placing** them into cells.

### Value setters

These methods attach metadata to each event value. They accept numbers or patterns.

| Method              | Description                                         |
| ------------------- | --------------------------------------------------- |
| `.i(n)`             | Cell index (0-based)                                |
| `.count(n)`         | Stride — how many patterns share the grid           |
| `.rows(n)`          | Number of rows                                      |
| `.cols(n)`          | Number of columns                                   |
| `.rowscols(n)`      | Set both rows and cols to the same value            |

```js
color("red").i(2).rows(2).cols(2)   // value will have i:2, rows:2, cols:2
color("red").rowscols(3)            // rows:3, cols:3
```

### `index(...patterns)` / `indexCycle(...patterns)`

Stack patterns and label each event with `i` (position) and `count` (total), so `.gridMod()` can place them automatically.

- **`index`** — labels events that are co-active at query time. `i` and `count` reflect only the patterns active at that moment.
- **`indexCycle`** — labels events by their temporal order within the current cycle. Events that appear earlier in the cycle get lower indices.

```js
$: index(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
$: indexCycle(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()

// Method form (on an existing stack)
$: stack(video("a.mp4"), video("b.mp4")).index().rowscols(2).gridMod()
```

Use `indexWith` / `indexCycleWith` to label with custom property names instead of `i` / `count`:

```js
$: indexWith("slot", "total", video("a.mp4"), video("b.mp4"))
```

### `.shuffleIndex(seed?)` / `.shuffleIndexCycle(seed?)`

Assigns shuffled `i` values (and matching `count`) to events **without changing their order**. Think of it as `.index()` / `.indexCycle()` but with randomised cell assignments.

- **`.shuffleIndex`** — shuffles the `i` values assigned at query time (mirrors `.index()`).
- **`.shuffleIndexCycle`** — shuffles the `i` values assigned by cycle-onset order (mirrors `.indexCycle()`).

The key difference from `.shuffleStack().index()`: event order in the result is preserved, so pool identity and video stacking order stay the same. Only the grid cell each event lands in is randomised.

`seed` accepts a number, string, or any pattern. Same seed → same assignment. No seed → fixed shuffle (seed 0).

```js
// Fixed shuffle: videos keep their pool identity, cells are shuffled
$: stack(video("a.mp4"), video("b.mp4"), video("c.mp4"), video("d.mp4"))
     .shuffleIndex(42).rowscols(2).gridMod()

// Different seed → different layout
$: stack(s("a.mp4"), s("b.mp4"), s("c.mp4"), s("d.mp4"))
     .shuffleIndex(99).rowscols(2).gridMod()

// Cycle variant for temporally-ordered patterns
$: stack(video("a.mp4"), video("b.mp4 c.mp4")).shuffleIndexCycle(7).rowscols(2).gridMod()
```

### `autoseed(...patterns)`

Stacks patterns and labels each hap with a deterministic `seed` value — a hash of the event's value, position in the cycle, and cycle number. Useful for giving each cell a stable unique random stream.

```js
$: autoseed(video("a.mp4").x(rand), video("b.mp4").x(rand)).rowscols(2).gridMod()
```

### `.grid(rows?, cols?, i?)`

Position a pattern in a single grid cell. All arguments are optional — missing values fall back to the event's own `rows`, `cols`, and `i` properties (set by `.i()`, `.rows()`, `.cols()`, or `index()`).

Cells are numbered left-to-right, top-to-bottom, starting at **0**.

```js
$: video("clip.mp4").grid(2, 2, 0)   // top-left of a 2×2 grid (rows=2, cols=2, i=0)
$: video("clip.mp4").grid(2, 2, 3)   // bottom-right
$: video("clip.mp4").i(1).grid(2)    // second row of a 2×1 grid (cols defaults to 1 when rows given)

// Read everything from values
$: video("clip.mp4").i(2).rows(2).cols(2).grid()
```

`.grid()` composes — calling it on a pattern that already has position nests it:

```js
$: color("red").i(0).rows(2).cols(2).grid()
             .i(0).rows(2).cols(2).grid()  // top-left quarter of top-left quarter
```

### `.gridMod(rows?, cols?)`

Places a pattern across **multiple** grid cells, cycling based on `count` as a stride. Given `i` and `count` from the event values, the pattern appears in cells `i`, `i + count`, `i + 2*count`, etc.

`count` is the **stride** (number of patterns sharing the grid), not the total number of cells.

```js
// 2 patterns in a 2×2 grid: red gets cells 0,2; blue gets cells 1,3
$: stack(
  color("red").i(0).count(2).rowscols(2).gridMod(),
  color("blue").i(1).count(2).rowscols(2).gridMod()
)

// Equivalent, using index() to label automatically
$: index(color("red"), color("blue")).rowscols(2).gridMod()
```

Explicit `rows`/`cols` arguments override the values:

```js
$: color("red").i(0).count(2).gridMod(2, 2)   // override grid size
```

#### Nested grids

You can nest a `gridMod()` inside another one. Use `index()` at each level to assign slots correctly. The inner group is treated as a single slot by the outer `index()`:

```js
// 2×2 outer grid: left cells contain an inner 2×2, right cells contain red
$: stack(
  stack(color("cyan"), color("magenta")).index().rowscols(2).gridMod(),
  color("red")
).index().rowscols(2).gridMod()
```

**Important:** always pass patterns as separate arguments to `stack()`, not as an array. `stack([a, b])` treats the array as a sequence (alternating per cycle) — `stack(a, b)` stacks them simultaneously.

You can shift a nested group within its outer cells using `.x()` / `.y()` before the outer `gridMod()` — because `.x()` is additive, it composes correctly at each level:

```js
$: stack(
  stack(color("cyan"), color("magenta")).index().rowscols(2).gridMod().x(0.1),
  color("red")
).index().rowscols(2).gridMod()
// inner 2×2 is shifted 0.1 units to the right within each of its outer cells
```

The circle methods use three circle-specific value setters:

| Method               | Description                                         |
| -------------------- | --------------------------------------------------- |
| `.radius(n)`         | Circle radius in screen coords (0–0.5)              |
| `.startOffset(n)`    | Rotation in turns (0=top, 0.25=right, 0.5=bottom)  |
| `.circleCount(n)`    | Total number of slots in the circle                 |

### `.circle(radius?, startOffset?, circleCount?, i?)`

Positions a pattern centered on a point along a circle. The screen center is `(0.5, 0.5)`. All args are optional and fall back to event values (`.radius()`, `.startOffset()`, `.circleCount()`, `.i()`). Element width/height default to 0.2 for centering.

```js
// 4 videos arranged in a circle
$: stack(
  video("a.mp4").i(0).circleCount(4).circle(0.35),
  video("b.mp4").i(1).circleCount(4).circle(0.35),
  video("c.mp4").i(2).circleCount(4).circle(0.35),
  video("d.mp4").i(3).circleCount(4).circle(0.35),
).width(0.2).height(0.2)

// Read radius and circleCount from value setters
$: index(video("a.mp4"), video("b.mp4"), video("c.mp4"), video("d.mp4"))
  .radius(0.35).circleCount(4).circle().width(0.2).height(0.2)

// All args explicit: circle(radius, startOffset, circleCount, i)
$: video("clip.mp4").circle(0.3, 0.25, 6, 2)   // slot 2 of 6, rotated 90°
```

### `.mapWithVal(fn)`

For each hap, calls `fn(pattern, value)` where `pattern` is a pure pattern of that hap's value and `value` is the raw value object. Lets you apply controls whose arguments depend on the event's own properties.

```js
// Set each element's radius from its i value
$: index(color("red"), color("blue")).circleCount(4).mapWithVal((p, v) => p.radius(v.i * 0.1 + 0.1)).circle()
```

### `.circleMod(radius?, startOffset?, circleCount?)`

Like `.gridMod()` but for circles. Distributes a pattern across multiple slots using `count` (from event value) as a stride. Appears at slots `i`, `i + count`, `i + 2*count`, etc. up to `circleCount`.

`count` is the **stride** (number of patterns sharing the circle); `circleCount` is the total number of slots.

```js
// 2 patterns sharing a 4-slot circle: red gets slots 0,2; blue gets slots 1,3
$: stack(
  color("red").i(0).count(2).circleCount(4).circleMod(0.35),
  color("blue").i(1).count(2).circleCount(4).circleMod(0.35),
).width(0.2).height(0.2)

// Using index() — circleCount set separately
$: index(video("a.mp4"), video("b.mp4")).circleCount(4).circleMod(0.35)
  .width(0.2).height(0.2)
```

### `gridStack(children, cols, rows)`

Distributes patterns across grid cells. Accepts an array, a single pattern, or any iterable. `cols` defaults to 2, `rows` defaults to `cols`.

```js
$: gridStack([color("red"), color("blue"), video("clip.mp4")], 2, 2)
$: gridStack(video("clip.mp4"), 3)                          // 3×3 grid, same video in each cell
$: gridStack(video("clip.mp4").iteratorWith((x, i) => x.speed(i + 1)), 2, 2)
$: gridStack(cycle([video("a.mp4"), video("b.mp4")], color("red")), 2, 2)
```

### `stackN(n, ...patterns)`

Stacks `n` copies of patterns, cycling through them to fill slots. `n` can be a pattern.

```js
$: stackN(4, color("red"))                          // 4 red layers (same position, stacked)
$: stackN(4, color("red"), color("blue"))           // red, blue, red, blue
$: stackN(sine.range(1, 4).slow(4), color("red"))  // dynamic count
```

### `cycle(...args)`

Round-robins between arguments. Arrays advance their own position; single patterns repeat forever.

```js
cycle([video("a.mp4"), video("b.mp4")], video("c.mp4"))
// yields: a, c, b, c, a, c, ...
```

### `.cropStack(rows, cols?)`

Slices the source frame into a `rows × cols` spatial grid and stacks all tiles simultaneously. Each tile gets its crop coordinates set automatically, plus `i`, `count`, `rows`, `cols` — so `.gridMod()` (with no arguments) reassembles them into the original layout.

```js
$: s("clip.mp4").cropStack(2).gridMod()             // 2×2 grid, looks like original
$: s("clip.mp4").cropStack(2, 3).gridMod()           // 2 rows, 3 columns
$: s("clip.mp4").cropStack(2).alpha("1 0.5 1 0.5").gridMod()  // dim alternate cells
```

`cols` defaults to `rows` (square grid). Unlike `.chopStack()` which slices temporally (begin/end), `.cropStack()` slices spatially (crop region). The tiles share the same playback position so they're perfectly in sync.

### `.iteratorWith(fn)` / `.iterator()`

Returns an infinite iterable of pattern variants. `.iteratorWith(fn)` calls `fn(pattern, index)` for each item; `.iterator()` repeats the pattern unchanged.

```js
$: gridStack(video("clip.mp4").iteratorWith((x, i) => x.speed(i + 1)), 2, 2)
$: gridStack(color("red").iterator(), 3, 1)
```


## Signals

Continuous signals vary smoothly over each cycle (0–1 range unless noted). Use them anywhere you'd use a number.

| Signal    | Shape                           |
| --------- | ------------------------------- |
| `sine`    | Sine wave 0→1→0                 |
| `sine2`   | Sine wave -1→1→-1               |
| `cosine`  | Cosine wave 1→0→1               |
| `cosine2` | Cosine wave 1→-1→1              |
| `saw`     | Ramp 0→1                        |
| `saw2`    | Ramp -1→1                       |
| `isaw`    | Ramp 1→0                        |
| `isaw2`   | Ramp 1→-1                       |
| `tri`     | Triangle 0→1→0                  |
| `tri2`    | Triangle -1→1→-1                |
| `itri`    | Triangle 1→0→1                  |
| `itri2`   | Triangle 1→-1→1                 |
| `square`  | Square wave 0/1                 |
| `square2` | Square wave -1/1                |
| `rand`    | Random 0–1                      |
| `rand2`   | Random -1–1                     |
| `irand`   | Random integer (use with range) |
| `brand`   | Random boolean 0/1              |
| `perlin`  | Perlin noise                    |
| `time`    | Elapsed time                    |
| `mouseX`  | Mouse X position                |
| `mouseY`  | Mouse Y position                |

```js
$: color("red").alpha(sine)             // pulsing transparency
$: video("clip.mp4").x(sine).width(0.5) // slides back and forth
$: video("clip.mp4").speed(sine.range(0.5, 2)) // speed varies smoothly
```

## Interpolation

### `.lerp(curve, direction)`

Smoothly interpolate between discrete pattern values instead of stepping.

Curves: `linear`, `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ`, `elastic`, `bounce`, `back`

Directions: `in`, `out`, `inout`

```js
$: color("red").x("0 0.5".lerp())                    // smooth linear slide
$: video("clip.mp4").alpha("0 1".lerp("sine", "inout")) // smooth sine fade
```

### `.spline(tension)`

Catmull-Rom spline interpolation for very smooth curves through pattern values.

```js
$: video("clip.mp4").x("0 0.3 0.7 1".spline())
$: color("red").alpha("0 1 0.5 1".spline(0.8))  // tension 0–1 (default 0.5)
```

## Utility functions

| Function                  | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `setCps(n)`               | Set cycles per second (default 0.5). Accepts a pattern. |
| `setCpm(n)`               | Set cycles per minute. Accepts a pattern.               |
| `run(n)`                  | Pattern of integers 0 to n-1                            |
| `choose(a, b, ...)`       | Random choice each cycle                                |
| `chooseIn(a, b, ...)`     | Random choice within subdivisions                       |
| `chooseCycles(a, b, ...)` | Random choice that changes each cycle                   |
| `signal(fn)`              | Custom signal from a function                           |
| `steady(v)`               | Constant value as a pattern                             |
| `stack(a, b, ...)`        | Layer patterns simultaneously                           |
| `cat(a, b, ...)`          | Concatenate patterns in sequence                        |
| `fastcat(a, b, ...)`      | Concatenate without stretching                          |
| `slowcat(a, b, ...)`      | Alias for `cat`                                         |
| `silence`                 | Empty pattern (no events)                               |
| `pure(v)`                 | Constant value each cycle                               |
| `reify(v)`                | Wrap value as pattern (passes patterns through)         |

```js
setCps(1)  // one cycle per second
setCpm(120)  // 120 cycles per minute (= 2 cps)
setCps(sine.range(0.5, 2).slow(10))  // tempo varies smoothly

$: video(choose("a.mp4", "b.mp4", "c.mp4"))
$: color("red").alpha(run(4).div(4))  // 0, 0.25, 0.5, 0.75
```

## Pattern methods from Strudel

Since uzuvid patterns are Strudel patterns, all standard Strudel methods work:

```js
$: color("red blue").slow(2)          // half speed (one color per 2 cycles)
$: color("red blue").fast(4)          // 4x speed
$: video("a.mp4 b.mp4").rev()         // reverse pattern order
$: color("red blue green").every(3, x => x.fast(2)) // every 3rd cycle, double speed
```

## Complete examples

```js
// Pulsing color background with video overlay
bg: color("darkblue purple")
$: video("clip.mp4").alpha(0.7).scale(0.8)

// 2×2 grid of videos with varying speed
$: gridStack([
  video("a.mp4").speed(1),
  video("b.mp4").speed(-1),
  video("c.mp4").speed(0.5),
  video("d.mp4").speed(2)
], 2, 2)

// Smoothly sliding video
$: video("clip.mp4").x(sine.slow(4)).width(0.5)

// Grid with patterned cell index
$: video("clip.mp4").i("0 1 2 3").rowscols(2).grid().speed("1 -1")

// Layered colors with interpolated alpha
$: color("red").alpha("0 1".lerp("sine", "inout"))
$: color("blue").alpha("1 0".lerp("sine", "inout"))
```

## Server

The server downloads, transcodes, and serves videos. Run it separately:

```sh
cd server && npm install && npm start
```

All videos served by the server are re-encoded as **I-frame-only MP4**, which enables smooth reverse playback and arbitrary seeking.

### YouTube videos

Paste a YouTube URL into the video tab's input bar in the sidebar. The server downloads and transcodes the video in the background. A spinner appears while it's in progress.

You can also call the endpoint directly:
```
GET http://localhost:3456/download?v=YOUTUBE_URL
```

### Local file drag-and-drop

Drag a video file from your file system onto the sidebar video tab. The file is uploaded to the server, re-encoded as I-frame-only MP4, and added to the list.

- The entry appears immediately with a temporary URL so you can start using it right away
- `↑N%` shows upload progress; `⚙` shows that transcoding is in progress
- Once complete, the URL switches to the server URL and a thumbnail is generated

Supported formats: `.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`

### Using media in code

Once added via the sidebar, reference videos and images by their name (not full URL):

```js
$: video("myclip")           // file added as "myclip"
$: image("myphoto")
$: screen("myclip")          // auto-detects type
```

Use `loadVideo` / `loadImage` to register media imperatively (e.g. in a persistent snippet):

```js
loadVideo("myclip", "http://localhost:3456/videos/ID.mp4")
$: video("myclip")
```
