# How picodevil combines patterns

picodevil controls (`.alpha()`, `.speed()`, `.x()`, etc.) need to merge a control value into a source pattern's events. Strudel provides several combinators for this. picodevil uses a custom one. This doc explains why.

## Background: Haps, wholes, and parts

A Strudel pattern produces **Haps** (events) when queried. Each Hap has:

- **whole** — the full timespan the event "wants" to occupy (e.g., 0–4 for a 4-cycle event). `undefined` for signals (continuous patterns like `sine`).
- **part** — the portion of the whole that was actually returned by this query. Always a subset of the query arc and a subset of whole.
- **value** — the event's payload (in picodevil: an object like `{_type:"video", src:"a.mp4", alpha:0.5, ...}`)

Example: `video("a.mp4").slow(4)` queried at arc 1–2:
```
whole = 0–4     (the event spans 4 cycles)
part  = 1–2     (we only asked about cycle 1–2)
value = {_type:"video", src:"a.mp4", _onset:0, begin:0, end:1}
```

Discrete patterns (from `mini()`, `pure()`, `reify(0.5)`) produce haps with concrete whole spans — typically one cycle each. Signal patterns (`sine`, `saw`, `steady(v)`) produce haps with `whole = undefined`.

## Strudel's combinator zoo

When combining two patterns (a source pattern and a control pattern), Strudel offers several "application" strategies. The key ones:

### appLeft (set / set.in) — "left structure wins"

```
Query: source at state.span
For each source hap:
  Query control at source hap's wholeOrPart()
  Result whole = source hap's whole  ← PRESERVED
  Result part  = intersection(source.part, control.part)
```

The source pattern's event structure (whole spans) is preserved. The control is sampled at the source event's timespan, not at the current frame time.

**Pro:** Whole spans are never clipped.
**Con:** Continuous signals (`sine`, `saw`) are sampled at the event's onset, not at each frame. A slowly-changing sine controlling alpha would step-change at event boundaries instead of animating smoothly.

### appBoth (set.mix) — "intersect everything"

```
Query: BOTH patterns independently at state.span
For each pair of overlapping haps:
  Result whole = intersection(source.whole, control.whole)  ← CLIPS
  Result part  = intersection(source.part, control.part)
```

Both patterns are queried at the same frame-time state, so continuous signals animate smoothly.

**Pro:** Continuous signals are sampled at frame time.
**Con:** Whole spans get clipped. `pure(0.5)` has per-cycle wholes (0–1), so a source event with `whole=0–8` gets clipped to `whole=0–1`.

Special case: if either whole is `undefined` (signal), the result whole is also `undefined` — the event structure is destroyed entirely.

### appRight (set.out) — "right structure wins"

Mirrors appLeft but keeps the control pattern's structure. Rarely used for controls.

### appSqueeze — "compress right into left"

The control pattern is time-compressed to fit within each source event. Used for things like `note("c e g").set.squeeze(velocity("0.5 1"))`.

## The problem with appBoth for picodevil

picodevil originally chose appBoth (set.mix) because we need frame-time sampling — `.alpha(sine)` should pulse smoothly every frame, not step at event boundaries.

But appBoth clips whole spans:

```
video("a.mp4").slow(8)  →  whole = 0–8
  .alpha(0.5)           →  reify(0.5) = pure(0.5), whole = 0–1 per cycle
                            appBoth intersects: whole = 0–1  ← CLIPPED

  .fit()                →  reads hap.whole to compute speed
                            sees hapDur = 1 instead of 8
                            speed is 8× too fast!

  .chop(4)              →  subdivides hap.whole
                            sees whole = 0–1, creates 4 × 0.25-cycle sub-events
                            should be 4 × 2-cycle sub-events!
```

This breaks `fit()`, `chop()`, `loopAt()`, and anything else that reads `hap.whole` for the true event duration.

The problem isn't limited to `begin`/`end` — ANY control using appBoth clips the whole. `.alpha(0.5).chop(4)` creates wrong sub-events. `.speed(2).fit()` computes wrong speed. It's a whole category of bugs.

## picodevil's solution: frame-time appLeft

picodevil's `createMixParam` uses a custom combiner that takes the best of both:

- **Queries both patterns at frame time** (like appBoth) — continuous signals animate smoothly
- **Preserves the source pattern's whole** (like appLeft) — chop/fit see the true event duration

```
Query: source at state.span → get source haps with their original wholes
Query: control at state.span → get current control value(s)
For each source hap:
  Find control haps whose parts overlap the source hap's part
  Result whole = source hap's whole    ← PRESERVED (like appLeft)
  Result part  = intersection of parts  ← narrowed to overlap region
  Result value = source value + control value merged in
```

### Diagram: three approaches compared

```
Source: video("a.mp4").slow(4) — one event, whole = 0–4
Control: alpha("0.5 1") — two events per cycle, wholes = 0–0.5, 0.5–1

Query arc: 1.7–1.701 (one render frame)

                        ┌──── source hap ────┐
   whole:  |────────────────────────────────────|     0 ──── 4
   part:                       ·                      1.7

                        ┌─ ctrl hap ─┐
   whole:              |────────────|                  1.5 ── 2
   part:                       ·                      1.7


appLeft (set.in):
   Queries ctrl at source's wholeOrPart [0–4]
   → Gets all ctrl events in range, picks overlapping
   Result: whole = 0–4 ✓   part = 1.7   alpha = 1
   But: ctrl is sampled at source's span, not frame time

appBoth (set.mix):
   Queries both at frame state [1.7–1.701]
   → source: whole=0–4, part=1.7
   → ctrl: whole=1.5–2, part=1.7
   Intersects wholes: 0–4 ∩ 1.5–2 = 1.5–2
   Result: whole = 1.5–2 ✗ (CLIPPED)   part = 1.7   alpha = 1

picodevil custom:
   Queries both at frame state [1.7–1.701]
   → source: whole=0–4, part=1.7
   → ctrl: whole=1.5–2, part=1.7 (or whole=undefined for signals)
   Keeps source's whole, intersects only parts
   Result: whole = 0–4 ✓   part = 1.7   alpha = 1
```

### Signal controls

With signals (e.g., `alpha(sine)`), the control hap has `whole = undefined`:

- **appBoth**: result whole = undefined (event structure destroyed!)
- **picodevil custom**: result whole = source's whole (preserved, signal is just a value source)

This means `video("a.mp4").slow(8).alpha(sine).chop(4)` works correctly — the signal doesn't destroy the event structure that chop needs.

## _perEvent mode

Some controls use random signals (e.g., `.i(irand(4))`) where the value should be **stable for the duration of each hap** rather than flickering every frame. These signals are marked with `_perEvent = true`.

The custom combiner handles this with a single branch point:

```typescript
// Default: query control at current frame state → signals animate smoothly
// _perEvent: query control at hap's onset → random values are stable per-event
const ctrlState = perEvent
  ? state.setSpan(onset, onset + epsilon)   // sample at event start
  : state;                                   // sample at frame time
```

The rest of the logic (part intersection, whole preservation, value merging) is identical. This replaces what was previously two completely separate code paths.

## Summary

| | appLeft | appBoth | picodevil custom |
|---|---------|---------|---------------|
| Control sampled at | event onset | frame time | frame time (or onset for _perEvent) |
| Source whole | preserved | clipped by intersection | preserved |
| Signal + discrete | works | whole destroyed (undefined) | whole preserved |
| Used for | Strudel's `registerControl` | Strudel's `set.mix` | picodevil's `createMixParam` |
