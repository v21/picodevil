# Auto-FBO allocation for inline modulator sources

Status: **deferred**. Not implemented in the v1 modulation feature. Captured here so the design is recoverable when we want it.

## Problem

The v1 modulation API requires the user to declare every modulator as a named hidden screen on its own line:

```js
Hsmall: s("clip.mp4").scale(0.5)
$:      s("clip.mp4").modulate("small", 0.1)
```

Hydra's equivalent is one line:

```js
src(o0).modulate(src(o0).scale(0.5), 0.1).out()
```

The friction in uzuvid is real for live coding — every modulator wants a named-line shuffle. We deferred fixing this in v1 because hidden allocations make perf cliffs invisible: when every `.modulate(...)` call site can quietly create a new canvas-sized FBO, a 25-cell grid with 25 distinct inline modulators silently becomes 25 FBO uploads per frame.

This doc is the design for adding inline source-pattern modulator arguments later, with the cost-visibility problem addressed.

## Proposed API

Allow either form:

```js
$: s("clip.mp4").modulate("small", 0.1)                // v1 named form
$: s("clip.mp4").modulate(s("clip.mp4").scale(0.5), 0.1) // inline form
```

Methods detect whether the source argument is a string (or Pattern of strings) vs. a Pattern producing source events, and dispatch accordingly.

## Mechanism

### Stable per-call-site naming

Each call to `.modulate` (and siblings) gets a unique stable name at **construction time** via a module-level counter. Same pattern as `_layoutParentCounter` for nested grids in `src/index-patterns.ts`. Name format: `__auto_mod_${n}`.

Construction time, not query time — so the same source line generates the same FBO name across re-evaluations until the user edits the line, at which point the AST changes and the counter assigns a fresh number. Old FBOs age out within one frame (see sweep below).

### Hidden-screen registration

When a `.modulate(<source pattern>, amt)` is constructed:

1. Increment the counter, build `name = "__auto_mod_" + n`.
2. Register the source-pattern argument into the existing hidden-screen machinery (the same path `Hname: pat` uses in `main.ts` / `evalController`). Mark it as auto-generated so the GUIDE / reference / debug surfaces can distinguish auto from user-declared.
3. The resulting Pattern stamps `{ src: name, amt }` into the appropriate event slot at query time, identical to the named-form behavior.

The renderer resolves `src` to the corresponding FBO texture via the same `name → FBO` path used for `s("name")`. No new resolution logic.

### Stale-FBO sweep

Every frame's render pass marks each `__auto_mod_*` FBO it references (a `touchedThisFrame` flag on the FBO entry). After the pass, unmarked auto FBOs are released — their GL textures freed, their entries removed.

The counter resets to 0 at the start of each `uzuEval` call, so re-evaluation of the same source produces the same names again. Names that were valid before re-eval but aren't reached after re-eval simply don't get touched and are swept on the next frame.

User-declared hidden patterns (`Hmod: ...`) are tracked separately and never swept by this mechanism — they live until the user removes the declaration.

## Cost visibility

The reason we deferred this in v1: auto allocation hides cost. The mitigations:

- **Perf panel counter** for active auto-mod FBOs (count + total upload MB/frame). Make the number visible while the user is live coding.
- **Reference tab and/or sidebar** lists active auto-mod FBOs by call-site location (`source.ts:LINE`), so the user can see which `.modulate(...)` instances are alive.
- **Optional warning** when active auto-mod FBO count exceeds a threshold (configurable, e.g. 8).
- **Documentation** that shared modulators (declared once, referenced by name in many `.modulate("name", amt)` calls) are cheaper than inline modulators repeated per call site.

## Why deferred

- v1 needs to land. Adding auto allocation widens the surface and complicates the early stages where bugs are likeliest.
- Surfacing the cost visibility (perf panel additions, debug listings) is more work than the construction-time mechanism itself.
- Once users have lived with the named form for a while, we have data on whether the friction is severe enough to justify the hidden-allocation tradeoff.

## When we'd revisit

- If users frequently write 1-2-line modulator declarations as throwaway setup, the friction is real and worth removing.
- If perf-panel data from v1 shows that explicit modulator setup tends toward 1-3 named modulators per piece (suggesting heavy reuse), inline allocation is a small additional cost.
- If the auto-FBO mechanism is needed for other features (e.g. shorthand for nested compositing), the cost amortizes.

## Out of scope for this doc

- Resolution control for modulator FBOs (`.fboRes(w, h)`) — separate concern, also deferred from v1.
- Effect-chain ordering exposure (`.rotate.modulate` vs `.modulate.rotate` semantics) — separate, much bigger design.
