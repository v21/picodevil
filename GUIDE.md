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
$: color("red").x(0.5).width(0.5)       // right half
$: video("clip.mp4").x("0 0.5").width(0.5) // bounces left/right
```

| Method       | Description         | Default |
| ------------ | ------------------- | ------- |
| `.x(v)`      | Horizontal position | 0       |
| `.y(v)`      | Vertical position   | 0       |
| `.width(v)`  | Width               | 1       |
| `.height(v)` | Height              | 1       |

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

### URL base

Change where media files are loaded from:

```js
$: video("clip.mp4").urlBase('http://other-server/videos/')
```

Note: use single quotes for `.urlBase()` since double quotes trigger mininotation parsing.

## Grids

### `.grid(index, cols, rows)`

Position a pattern in a grid cell. All arguments can be patterns.

```js
$: video("clip.mp4").grid(0, 2, 2)   // top-left of a 2×2 grid
$: video("clip.mp4").grid(3, 2, 2)   // bottom-right
$: video("clip.mp4").grid("0 1 2 3", 2, 2) // cycles through cells
```

Use mininotation `,` (stack) to show in multiple cells simultaneously:

```js
$: video("clip.mp4").grid("0,1,2,3", 2, 2) // all 4 cells at once
```

Grids nest — calling `.grid()` on something already in a grid composes positions:

```js
$: color("red").grid(0, 2, 1).grid(0, 1, 2)  // nested subdivision
```

### `gridStack(children, cols, rows)`

Distributes an array of patterns across grid cells, cycling if there are more cells than children.

```js
$: gridStack([color("red"), color("blue"), video("clip.mp4")], 2, 2)
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
$: four([
  video("a.mp4").speed(1),
  video("b.mp4").speed(-1),
  video("c.mp4").speed(0.5),
  video("d.mp4").speed(2)
])

// Smoothly sliding video
$: video("clip.mp4").x(sine.slow(4)).width(0.5)

// Grid with patterned cell index
$: video("clip.mp4").grid("0 1 2 3", 2, 2).speed("1 -1")

// Layered colors with interpolated alpha
$: color("red").alpha("0 1".lerp("sine", "inout"))
$: color("blue").alpha("1 0".lerp("sine", "inout"))
```

## Server

The server downloads and serves videos. Run it separately:

```sh
cd server && npm install && npm start
```

Download a YouTube video:
```
GET http://localhost:3456/download?v=YOUTUBE_URL
```

Videos are then available at `http://localhost:3456/videos/ID.mp4`.
