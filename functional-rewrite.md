# Functional Rewrite Plan

Goal: align uzuvid's pattern system with Strudel's architecture. Replace the OOP ScreenPattern class hierarchy with plain Strudel Patterns carrying typed value bags. Add Strudel-style `$:` label-based output. Make all screen methods proper functions registered on Pattern so they compose with `off`, `every`, `bind`, etc.

**Key principle: zero side-channel metadata on Patterns.** Everything lives in event values via `set.mix`. No `_srcPattern`, no `_controls`, no `_screenType`. Video state is a render concern — the render loop compares values between frames to detect changes, not pattern metadata.

---

## Part 1: The `$:` Transpiler and Label System

### What Strudel does

Strudel's transpiler (acorn-based AST transform) rewrites labeled statements:

```js
$: s("bd sd")          -->  s("bd sd").p("$")
d1: s("bd sd")         -->  s("bd sd").p("d1")
_$: s("bd sd")         -->  s("bd sd").p("_$")    // muted
S$: s("bd sd")         -->  s("bd sd").p("S$")    // soloed
```

At runtime, `.p(id)` registers the pattern in a `pPatterns` dict. After eval:
- Labels containing `$` get a unique suffix (`$0`, `$1`, ...) so multiple `$:` lines stack
- Named labels (`d1`, `d2`, ...) override — last write wins
- Labels starting with `_` or ending with `_` are muted (silently dropped)
- Labels starting with `S` are soloed (only soloed patterns play; non-solo patterns are excluded)
- All surviving patterns are `stack()`ed into a single output pattern

### What we build

**Step 1: Transpiler (`src/transpiler.ts`)**

Use `acorn` to parse user code into an AST. Walk top-level statements:

```
LabeledStatement where label matches /^[_S]?[$a-zA-Z]\w*_?$/
  --> rewrite to: <body_expression>.p("<label>")

All other statements: pass through unchanged.
```

Also rewrite double-quoted strings to `mini()` calls (matching Strudel's convention) — this is optional but nice for consistency.

Dependencies: `acorn` (parser, ~30kb), `escodegen`

**Step 2: Runtime `.p()` method**

Inject `.p()` onto Strudel's `Pattern.prototype` before each eval, exactly as Strudel does:

```ts
let pPatterns: Record<string, Pattern> = {};
let anonymousIndex = 0;

Pattern.prototype.p = function(id: string) {
  // muting: _label or label_
  if (id.startsWith('_') || id.endsWith('_')) return silence;
  // anonymous: $ becomes $0, $1, ...
  if (id.includes('$')) {
    id = `${id}${anonymousIndex}`;
    anonymousIndex++;
  }
  pPatterns[id] = this;
  return this;
};
```

**Step 3: Post-eval collection**

After running user code, collect registered patterns:

```ts
function collectScreens(): Pattern {
  let patterns: Pattern[] = [];
  let soloActive = false;

  for (const [key, pat] of Object.entries(pPatterns)) {
    const isSoloed = key.length > 1 && key.startsWith('S');
    if (isSoloed && !soloActive) {
      patterns = [];  // clear non-solo patterns
      soloActive = true;
    }
    if (!soloActive || isSoloed) {
      patterns.push(pat);
    }
  }

  return patterns.length ? stack(...patterns) : silence;
}
```

**Step 4: Wire into `uzuEval()`**

```ts
window.uzuEval = (code: string): string | null => {
  pPatterns = {};
  anonymousIndex = 0;

  const transpiled = transpile(code);   // AST transform
  // ... run transpiled code via new Function ...
  const rootPattern = collectScreens();
  // rootPattern is now a single stacked Pattern that the render loop queries
};
```

**What the user writes:**

```js
$: color("red")
$: video("clip.mp4").speed("0.5 1 2")
d1: video("other.mp4").alpha(sine)
```

**What `.out()` becomes:** Nothing. It's gone. `$:` replaces it entirely.

**Backwards compat during migration:** Keep `.out()` working as sugar for `this.p("$")` so old code doesn't break immediately. Deprecate and remove later.

---

## Part 2: Controls via `set.mix` (the key architectural insight)

### The problem with the default combinator

Strudel's `registerControl` uses `pat.set(paramPat)`, which defaults to `set.in` (`appLeft`). `appLeft` queries the parameter pattern at the source event's `wholeOrPart()` span:

```js
// appLeft, line 191 of pattern.mjs:
const hap_vals = pat_val.query(state.setSpan(hap_func.wholeOrPart()));
```

For a discrete source event with `whole=[0,1]`, querying `sine` at `[0,1]` gives `sin(2pi * 0) = 0` — the value at cycle start, not at the current frame time. **This is wrong for per-frame visual sampling.**

### The solution: `set.mix` uses `appBoth`

`appBoth` (line 122-126 of pattern.mjs) queries **both** patterns at the **original query state**:

```js
// appWhole (used by appBoth):
const hap_funcs = pat_func.query(state);  // source at frame time
const hap_vals = pat_val.query(state);     // param at frame time too!
```

When we point-sample with `queryArc(t, t+0.001)`, both the source and parameter patterns are queried at `[t, t+0.001]`. A continuous signal like `sine` gets sampled at exactly the frame time. Parts are intersected, so the result correctly pairs source events with parameter values that overlap in time.

### How this works for each case

**Discrete source + discrete param:** `video("a.mp4 b.mp4").speed("0.5 1")`
- Both patterns subdivide the cycle. `appBoth` intersects their parts.
- Point-sampling at t=0.3 gives `{ src: "a.mp4", speed: 0.5 }`. Correct.

**Discrete source + continuous signal:** `video("a.mp4").speed(sine)`
- Source has `whole=[0,1]`, `part=[0.3, 0.301]`.
- Sine has `whole=undefined`, `part=[0.3, 0.301]`, `value=sin(2pi * 0.3)`.
- `appBoth` intersects parts -> `[0.3, 0.301]`. Correct frame-time value.

### Implementation: `createMixParam`

Modeled on Strudel's `createParam` (controls.mjs:10-54), but using `set.mix` instead of `set` (which defaults to `set.in`):

```ts
import { reify, Pattern } from "@strudel/core";

function createMixParam(name: string) {
  const withVal = (v: any) => ({ [name]: v });

  const func = function(value: any, pat?: Pattern) {
    if (!pat) return reify(value).withValue(withVal);
    if (value === undefined) return pat.fmap(withVal);
    return pat.set.mix(reify(value).withValue(withVal));
  };

  Pattern.prototype[name] = function(value: any) {
    return func(value, this);
  };

  return func;
}
```

Register all visual controls:

```ts
// Shared controls (all screen types)
const alpha    = createMixParam('alpha');
const opacity  = createMixParam('opacity');  // alias
const scaleX   = createMixParam('scaleX');
const scaleY   = createMixParam('scaleY');
const fit      = createMixParam('fit');

// Video-specific controls
const speed    = createMixParam('speed');
const start    = createMixParam('start');
const end      = createMixParam('end');
const duration = createMixParam('duration');
```

### What this gives us

Because we use the same mechanism as Strudel's `registerControl`:

- **Methods on Pattern:** `video("clip.mp4").speed("0.5 1")`
- **Standalone functions:** `speed("0.5 1", video("clip.mp4"))`
- **Composable via `off`:** `video("clip.mp4").off(0.5, speed(2))` — stacks a time-shifted copy with different speed
- **Composable via `every`:** `video("clip.mp4").speed(1).every(4, speed(2))` — every 4th cycle, double speed
- **Works with `bind`:** patterns-of-patterns compose naturally
- **No custom `overlay()` combinator needed** — `set.mix` IS our overlay, using Strudel's native machinery
- **No side-channel metadata** — everything is in the event values, propagated by Strudel's own combinators
- **Combinators like `fast`, `slow` work** because the result is a plain Pattern — no metadata to lose

### Screen constructors

```ts
function video(pat: string): Pattern {
  return mini(pat).withValue((v: string) => ({
    _type: "video",
    src: v,
    speed: 1,        // defaults baked into initial values
    start: TIME_ZERO,
    end: TIME_END,
    endIsDuration: false,
  }));
}

function color(pat: string): Pattern {
  return mini(pat).withValue((v: string) => ({
    _type: "color",
    color: v,
  }));
}

function image(pat: string): Pattern {
  return mini(pat).withValue((v: string) => ({
    _type: "image",
    src: v,
  }));
}
```

### `scale()` as sugar

```ts
// scale(x) sets both scaleX and scaleY
// This is just a compound param:
Pattern.prototype.scale = function(value: any) {
  return this.scaleX(value).scaleY(value);
};
```

### Render loop reads event values directly

No more `instanceof` checks, no more `_controls` sampling. Just read from the event:

```ts
function renderScreen(ev: any, event: Hap, ctx, canvas, ...) {
  // ev is the event value — a plain object with all controls resolved
  const a = ev.alpha !== undefined ? clamp01(Number(ev.alpha)) : 1;
  ctx.globalAlpha = a;

  const sx = ev.scaleX !== undefined ? Number(ev.scaleX) : 1;
  const sy = ev.scaleY !== undefined ? Number(ev.scaleY) : 1;
  // ... apply transforms ...

  switch (ev._type) {
    case "color": renderColor(ev, ctx, canvas); break;
    case "video": renderVideo(ev, event, ...); break;
    case "image": renderImage(ev, ctx, canvas); break;
    case "grid":  renderGrid(ev, ...); break;
  }
}
```

---

## Part 3: Video State is a Render Concern

### No onset tracking, no `_srcPattern`

Video playback state (which element to use, when to seek) is entirely a render-side concern. The pattern just tells us "what should be on screen right now" — it's the render loop's job to figure out what changed.

### Render-time value comparison

Each render slot tracks just enough to detect changes:

```ts
interface VideoSlotState {
  lastSrc: string | null;
  lastSpeed: number;
  el: HTMLVideoElement | null;
}

// Per-frame:
const src = ev.src;
const speed = ev.speed ?? 1;
const base = ev.urlBase ?? VIDEO_BASE;

if (src !== slot.lastSrc) {
  // Source changed → get/create element, seek to start
  slot.el = getVideoEl(src, base);
  slot.el.currentTime = resolveTime(ev.start, slot.el.duration);
}

if (speed !== slot.lastSpeed) {
  // Speed changed → update playback rate
  setPlaybackRate(slot.el, speed);
}

slot.lastSrc = src;
slot.lastSpeed = speed;
```

### Why this is simpler and better

- **No `_srcPattern` metadata** — nothing to propagate through combinators
- **No onset detection** — no dependence on Strudel's whole/part semantics
- **No eager probing** — no `queryArc(0, 1)` at eval time for element creation
- **Works with any combinator chain** — `fast`, `slow`, `off`, `every` all work because the render loop just compares resolved values
- **Prewarming is separate** — blob prefetch can still probe cycle 0-1 for URLs, but that's an optimization, not part of the pattern model

### What drives the video position?

The pattern determines everything: `src`, `speed`, `start`, `end`. The render loop:
1. Detects src change via value comparison → swaps/creates element, seeks to start
2. Applies speed via `playbackRate` (native range) or manual seeking (reverse/extreme)
3. Enforces loop region (start/end) by checking bounds each frame

The video element's internal playhead is just a cache of "where we are" — the pattern is the source of truth. If the pattern says `speed: 0` (scrub), the video is paused at the `start` position. If the pattern says `speed: -1`, manual seeking walks backwards. The element is stateful but subordinate to the pattern.

---

## Part 4: Grid in the New Model

### Grid children and overrides live in event values

No side-channel metadata. Grid children are Pattern objects embedded directly in event values. Strudel's combinators pass them through opaquely (they don't recurse into value objects):

```ts
function grid(children: Pattern[], cols: PatOrValue, rows: PatOrValue): Pattern {
  const colsPat = asPat(cols);
  const rowsPat = asPat(rows);

  return new Pattern((state) => {
    const c = sampleAt(colsPat, state, 2);
    const r = sampleAt(rowsPat, state, 2);

    return [new Hap(undefined, state.span, {
      _type: "grid",
      cols: Math.max(1, Math.floor(c)),
      rows: Math.max(1, Math.floor(r)),
      children: children,
      overrides: [],
    })];
  });
}

function four(children: Pattern[]): Pattern {
  return grid(children, 2, 2);
}

function sampleAt(pat: Pattern, state: any, fallback: number): number {
  const haps = pat.query(state);
  return haps.length ? Number(haps[0].value) : fallback;
}
```

### setI / modI modify event values

Since children and overrides are in the event value, `setI` and `modI` just compose a transform on the value:

```ts
Pattern.prototype.setI = function(index: PatOrValue, screen: Pattern) {
  const indexPat = asPat(index);
  return new Pattern((state) => {
    const haps = this.query(state);
    return haps.map(h => {
      if (h.value?._type !== "grid") return h;
      const idxHaps = indexPat.query(state);
      const newOverrides = [...h.value.overrides];
      for (const ih of idxHaps) {
        newOverrides.push({ type: 'set', index: Math.floor(Number(ih.value)), screen });
      }
      return h.withValue(v => ({ ...v, overrides: newOverrides }));
    });
  });
};

Pattern.prototype.modI = function(index: PatOrValue, fn: (pat: Pattern) => Pattern) {
  const indexPat = asPat(index);
  return new Pattern((state) => {
    const haps = this.query(state);
    return haps.map(h => {
      if (h.value?._type !== "grid") return h;
      const idxHaps = indexPat.query(state);
      const newOverrides = [...h.value.overrides];
      for (const ih of idxHaps) {
        newOverrides.push({ type: 'mod', index: Math.floor(Number(ih.value)), fn });
      }
      return h.withValue(v => ({ ...v, overrides: newOverrides }));
    });
  });
};
```

### Grid rendering

The render loop handles grid events by iterating cells, applying canvas transforms, and recursively querying/rendering each child pattern:

```ts
function renderGrid(ev: any, state, ctx, canvas) {
  const { cols, rows, children, overrides } = ev;
  const totalCells = cols * rows;
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;

  for (let i = 0; i < totalCells; i++) {
    // Resolve child: apply overrides, fall back to cycling through children
    let child = children[i % children.length];
    for (const o of overrides) {
      const wrapped = ((o.index % totalCells) + totalCells) % totalCells;
      if (wrapped === i) {
        if (o.type === 'set') child = o.screen;
        else child = o.fn(child);
      }
    }

    // Set up cell viewport
    ctx.save();
    ctx.beginPath();
    ctx.rect((i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH);
    ctx.clip();
    ctx.translate((i % cols) * cellW, Math.floor(i / cols) * cellH);
    ctx.scale(cellW / canvas.width, cellH / canvas.height);

    // Query child pattern at current state and render
    const childEvents = child.queryArc(t, t + 0.001);
    for (const ce of childEvents) {
      renderScreen(ce.value, ce, ctx, canvas, ...);
    }

    ctx.restore();
  }
}
```

Grid children are themselves Patterns — they compose normally with all controls and combinators.

---

## Part 5: Fraction-Based Time

### Where to use fractions

- **Pattern query arcs**: Use Strudel Fraction for `queryArc(begin, end)` — ensures event boundaries align exactly with cycle subdivisions
- **Cycle position computation**: Compute `cycleNum` and `cyclePos` using Fraction math

### Where to keep floats

- `performance.now()` — wall clock, always float
- `video.currentTime` — DOM API, always float
- Canvas coordinates — pixels, always float
- `playbackRate` — DOM API, always float

### Implementation

```ts
import Fraction from 'fraction.js'; // already a transitive dep via Strudel

function frame() {
  const now = performance.now() - startTime;
  const nowSec = now / 1000;

  // Use Fraction for cycle math
  const totalCycles = Fraction(nowSec).mul(cyclesPerSecond);
  const cycleNum = totalCycles.floor();
  const cyclePos = totalCycles.sub(cycleNum);
  const t = totalCycles; // Fraction — pass to queryArc

  // queryArc accepts Fractions natively
  for (const screen of screens) {
    const events = screen.queryArc(t, t.add(Fraction(1, 1000)));
    // ...
  }
}
```

**Caveat:** Fraction math is slower than float math. Profile to ensure it doesn't impact frame rate. If it does, compute fractions less frequently (e.g., per-cycle) and interpolate with floats within a cycle.

---

## Part 6: Migration Sequence

Do this in order. Each step is independently shippable and testable.

### Step 0: Make visual tests
- The user added this, so you first need to figure out the details
- Existing screenshots are all blank
- Probably need to not render headless?



### Step 1: Add the transpiler and `$:` labels
- Install `acorn` + `astring`
- Write `src/transpiler.ts` — AST transform for labeled statements
- Wire into `uzuEval()` — transpile before `new Function()`
- Add `.p()` to Pattern.prototype with anonymous/named/mute/solo logic
- Add post-eval `collectScreens()`
- Keep `.out()` working (calls `.p("$")` internally) for backwards compat
- **Test:** write patterns using `$:` syntax, verify they render
- **Test:** muting with `_$:`, soloing with `S$:`, named overrides with `d1:`

### Step 2: Register visual controls via `createMixParam`
- Write `src/visual-controls.ts` — `createMixParam` using `set.mix`
- Register: `alpha`, `opacity`, `speed`, `start`, `end`, `duration`, `fit`, `scaleX`, `scaleY`, `scale`
- These immediately work as methods on any Pattern
- **Test:** `mini("0.5 1").speed` type chain works
- **Test:** `video("clip.mp4").speed(sine)` samples sine at frame time, not cycle start

### Step 3: Convert ColorPattern to a plain function
- `color(pat)` returns `mini(pat).withValue(v => ({ _type: "color", color: v }))`
- Remove ColorPattern class
- Update render loop to dispatch on `ev._type` instead of `instanceof`
- **Test:** all color patterns render identically

### Step 4: Convert ImagePattern to a plain function
- `image(pat)` returns `mini(pat).withValue(v => ({ _type: "image", src: v }))`
- `urlBase` becomes a visual param
- Remove ImagePattern class
- **Test:** image patterns render identically

### Step 5: Convert VideoPattern to a plain function
- `video(pat)` returns source pattern with default video controls in values
- Render loop uses value comparison for video element lifecycle (no onset tracking)
- Remove VideoPattern class
- **Test:** video patterns render identically

### Step 6: Convert GridPattern
- `grid(children, cols, rows)` returns a Pattern with children and overrides in event values
- `setI`, `modI` as methods on Pattern that modify event values
- Remove GridPattern class
- **Test:** grid rendering, cell cycling, overrides all work

### Step 7: Remove ScreenPattern base class and overlay()
- All screen types are now plain Patterns with `_type` values and `set.mix`-composed controls
- `overlay()` combinator is gone — `set.mix` replaces it
- `screen-pattern.ts` deleted
- **Test:** full test suite passes

### Step 8: Add Fraction-based time
- Change render loop to compute cycle position with Fractions
- Pass Fractions to queryArc
- Profile and verify no frame rate impact
- **Test:** visual output unchanged, long-running sessions show no drift

### Step 9: Remove `.out()` and legacy support
- Remove `.out()` from Pattern.prototype
- Update all examples and docs
- **Test:** only `$:` syntax works

---

## Appendix: Files Affected

| File                        | Change                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `src/transpiler.ts`         | NEW — acorn-based AST transform for `$:` labels                                             |
| `src/visual-controls.ts`    | NEW — `createMixParam` using `set.mix`, all control registrations                           |
| `src/main.ts`               | Major rewrite — transpiler integration, `.p()` injection, render loop dispatches on `_type` |
| `src/video-playback.ts`     | Moderate — accept plain event values, value-comparison-based state tracking                 |
| `src/pattern-extensions.ts` | Minor — keep as-is, already extends Pattern.prototype                                       |
| `src/screen-pattern.ts`     | DELETE after step 7                                                                         |
| `src/color-pattern.ts`      | DELETE after step 3                                                                         |
| `src/image-pattern.ts`      | DELETE after step 4                                                                         |
| `src/video-pattern.ts`      | DELETE after step 5                                                                         |
| `src/grid-pattern.ts`       | DELETE after step 6                                                                         |
| `src/draw-fit.ts`           | No change                                                                                   |
| `src/time-value.ts`         | No change                                                                                   |
| `src/config.ts`             | No change                                                                                   |
| `package.json`              | Add `acorn`, `astring`                                                                      |
| `test/monkey-test.ts`       | Update to use `$:` syntax                                                                   |

## Appendix: Strudel Internals Reference

### `set.mix` (`appBoth`) — why it works for us

```
pat.set.mix(paramPat)
  -> pat._opMix(paramPat, (a) => (b) => _composeOp(a, b, (a, b) => b))
  -> pat.fmap(func).appBoth(paramPat)
  -> appWhole(intersect_wholes, paramPat)
```

`appWhole` (pattern.mjs:122):
```js
const hap_funcs = pat_func.query(state);  // both query at original state
const hap_vals = pat_val.query(state);     // = our frame time [t, t+0.001]
```

Both sides queried at `state` (frame time). Parts intersected. Values combined via `_composeOp` with `set` semantics (right overwrites left for matching keys, union for non-overlapping keys).

### `_composeOp` — object-aware value merging

```js
function _composeOp(a, b, func) {
  if (_nonArrayObject(a) || _nonArrayObject(b)) {
    return unionWithObj(a, b, func);  // merges object keys
  }
  return func(a, b);
}
```

When both values are objects (our `{ _type, src, speed, ... }` bags), `unionWithObj` merges them — matching keys get the `set` function applied (right overwrites), non-matching keys pass through. This is exactly the behavior we need for layering controls onto a base screen value.

## Appendix: Open Questions

1. **Stacking = layering.** `off(0.5, speed(2))` on a video creates two layers. For audio this is polyphony; for video this is alpha-composited layering. This is correct but potentially surprising. If a user wants speed-change-at-offset (not layering), they use mininotation: `speed("1 [~ 2]")`.

2. **Should we support `all()` and `each()`?** Strudel's `all(fast(2))` applies a transform to all stacked screens. `each(fast(2))` applies per-screen. Nice for live performance. Add in a later pass.

3. **Name collisions with Strudel's built-in controls.** Strudel already has `speed` registered as an audio control. We either: (a) reuse it (our values merge with audio values in the same event bag — fine if we namespace with `_type`), (b) use different names (`vspeed`?), or (c) override it. Option (a) is cleanest — Strudel's `speed` already does `{ speed: value }` in the event, which is exactly what we want.

4. **Grid per-cell video state.** Each grid cell needs its own `VideoSlotState` for value-comparison tracking. Keyed by cell index, grown on demand as grid size changes. This is render-side state, not pattern state.
