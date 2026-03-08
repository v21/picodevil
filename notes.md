# uzulang video

how to specify where the video is drawn?

I think each vid sets its position itself. in 3D space. in one of 2 coord systems - ortho (Z is depth, 0-1 x y is screen bounds) or perspective (uhhh... more complex. also the perspective can have diff cam params. maybe this comes later and there's a func you can apply to get it into 3D screenspace). anyway, also this makes rotations trivial.

and then... and then there's shorthand for 4up, 2up etc. I guess to swap quickly between them... you just change the Z of something? ooor... something? it's not a property of each video stream it's a property of the whole? but each does wanna control it itself?

so maybe there can be a central pattern each can consume? 

a problem to solve after.


properties of each vid:
- src 
- loop start
- loop end
- (or length - overrides end if set)
- play speed (can be neg)
- position (last set of width height top left right bottom centerX centerY)
- blend mode
- opacity
- tiling??

can also set playhead, which sets both loop properties to that val. if that's the case, speed doesn't apply

can also set position via grid(i, x, y) - puts the vid in the position it'd be in for a grid of x by y

can also do addition etc on these properties

a video can also be an image, in which case it doesn't play

or a live stream from other tab or window or whatever. or a webcam.

each prop can be set via a mini notation pattern
can also be smooth()ed? linear or splined
can also be a JS function with an arg of time - hmm, maybe this is smth where 1 = 1 cycle, and frac is pos within cycle.

global cps setting - which can be fixed or can listen to sounds to pick up beats. or tap it in.


what if a grid prop indexes into an array of videos. would allow a _lot_ of videos playing at once (as long as they played the same)



sample bank pane:
sample name => url
(and a handy shortcut for getting them via a YT url)

```
vid("scales")
.start("0 0 .2 3s 4s 500ms")
.duration("100ms 100ms")
.speed("<1 1 -1 1>")
.


```



```
return video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1")



do we wanna reset pos every loop? right now the pos is a drifting variable which can move... we can do this with scrub




proposed syntax:
```
let s0 = video("blah.mp4")
let s1 = video("bloop.mp4")

four([s0,s1,s1,s0]).out()
```

displays a grid like:
s0 s1
s1 s0

or `grid([s0], 5, 5)` displays a 5x5 grid, each with s0 playing

i guess if there's randomness in the pattern for each, that would get evaluated separately




maybe grid is the wrong way to think about this
maybe we want... like, stack takes an array of patterns, and runs them all independently
so we want to stack stuff, but also set positions 
and set positions in a way where we can override them
or maybe just draw on top of them rather than overriding them?
so what if `grid(i, w, h)` was on a pattern, and draws it on screen in the place that it would be in a grid of w x h - just setting pure positional stuff on them
and then a `gridStack([patterns], w, h)` which takes patterns, repeats it til it's w x h long, then sets `grid` on each element so that it draws in the right place
and junk setI and modI entirely
or, i guess... that could be a config extra param on `gridStack`?

anyway, i guess the first step to this would be that screens have position parameters - some resolved combo of `left` `top` `width`, `x` (which sets the center) etc. and then the `grid` and `gridStack` stuff is helpers on that
 




## claude strudel comparison

Strudel's Design Principles
Core Abstraction: Pattern = Function from Time → Events
A Pattern is a lazy function (State) → Hap[]. It doesn't hold data — it computes data when asked about a time range. Everything flows from this:

Combinators compose functions, not data. stack(a, b) returns a new Pattern whose query concatenates results from a.query() and b.query().
Transformations are closures. .fast(2) wraps the inner pattern's query function — time is scaled on the way in, unscaled on the way out. Nothing is computed until queried.
Mininotation compiles to pattern algebra. "a b c" becomes fastcat(pure("a"), pure("b"), pure("c")) — a tree of composed query functions.
Event Model: Hap = (whole, part, value)
The whole/part distinction is Strudel's key insight:

whole: The logical span of the event (e.g., a note occupies cycle 0–1)
part: The fragment actually returned for this query window
When you query arc 0.5–1.5, an event spanning 0–2 returns two Haps with the same whole but different parts
hasOnset() = whole.begin === part.begin — tells you if this is the start of an event
This lets Strudel answer: "what's happening now?" AND "is this the beginning of something, or a continuation?"

Time: Exact Fractions, Not Floats
All time is in arbitrary-precision Fractions. 1/3 stays 1/3, never 0.333.... This matters because pattern subdivision creates lots of thirds, sevenths, etc. Float drift would cause events to land on wrong cycle boundaries.

Signals vs. Discrete
Discrete patterns have whole timespans — they represent events with onsets and durations
Continuous signals have whole = undefined — they represent smoothly varying values (sine, saw, mouse position)
Both are Pattern objects with the same interface; the difference is semantic
Patterns of Patterns (Monadic)
Strudel supports bind — a pattern's value can itself produce a pattern. This enables dynamic structure where the output of one pattern determines the shape of another. This is the full Haskell-style FRP model.

How Uzuvid Uses Patterns — And Where It Diverges
1. Point Sampling vs. Arc Querying
Strudel: Queries a meaningful arc — queryArc(0, 1) returns all events in cycle 0, with whole/part metadata showing event boundaries and onsets.

Uzuvid: Queries queryArc(t, t + 0.001) — essentially a point sample. It takes events[0].value and uses that as the current frame's state. The whole/part distinction, onset detection, and event fragmentation are all discarded.

Impact: Uzuvid treats patterns as continuous signals that happen to be sampled from Strudel. It never asks "did something new start this frame?" or "how long does this event last?" — it just asks "what value is active right now?"

2. Values as Property Bags vs. Atomic Values
Strudel: Event values are typically atomic — a note name, a number, a sound reference. Combinators like struct and mask work on whole events.

Uzuvid: Event values are heterogeneous property bags like { src: "clip.mp4", speed: 1, alpha: 0.8, scaleX: 1.2 }. The custom overlay() combinator merges these bags via { ...base.value, ...param.value } at query time.

This means each "event" in uzuvid isn't really an event — it's a snapshot of all active parameters at a point in time. The pattern system is being used as a key-value store indexed by time.

3. The overlay() Combinator — A Custom Invention
Uzuvid's overlay() (screen-pattern.ts) queries both base and parameter patterns at the same state and merges values. This differs from Strudel's native .set() which re-queries parameter patterns over each base event's whole span.

This was built specifically because uzuvid needs continuous signals (like sine for alpha) to be sampled at frame time, not at event onset time. It's a pragmatic workaround for the point-sampling approach.

4. When Things Become Concrete
Strudel: Values stay abstract through the entire pattern pipeline. A pattern of "c3 e3 g3" stays as string values until the very end, when an audio engine maps them to frequencies. The pattern layer never interprets values.

Uzuvid: Concretization happens in two places:

Eval time: video() probes srcPattern.queryArc(0, 1) to preload video elements. This is an eager peek into the pattern to set up resources.
Frame time: renderScreen() queries the pattern and immediately interprets values — parsing colors, looking up video elements, computing playback rates.
The eager probing at eval time is a leak of the lazy abstraction — necessary because video elements need time to load, but it means the pattern is partially evaluated before the render loop starts.

5. Immutability: Same Spirit, Different Mechanism
Strudel: Patterns are immutable because they're functions. .fast(2) returns a new function wrapping the old one. No builder pattern needed — it's just function composition.

Uzuvid: ScreenPatterns use an explicit immutable builder pattern where each method creates a new instance via _cloneWithScreenProps(). This is more OOP-style — objects are cloned and modified rather than functions being composed.

6. Grid: Where Uzuvid Goes Beyond Strudel
GridPattern is uzuvid's biggest departure from Strudel's model. Strudel has no spatial concept — it's purely temporal. Uzuvid's grid system:

Manages per-cell state (video playback position per grid cell)
Supports dynamic overrides via .setI() / .modI() with pattern-based index selection
Clones children per cell so random patterns evaluate independently
Uses coordinate-space transforms rather than clipping
This is entirely uzuvid's own invention — spatial layout driven by temporal patterns.

The Major Differences, Summarized
Aspect	Strudel	Uzuvid
Core query	Arc query → event list with whole/part	Point sample → single value snapshot
Event identity	whole/part tracks event boundaries & onsets	Not used — each frame is independent
Values	Atomic (a note, a number)	Property bags merged via overlay
Time precision	Exact fractions	Floats (via performance.now())
Concretization	At the very end (audio engine)	Split: eager preload + per-frame rendering
Signals	First-class (whole=undefined)	Used but flattened into same property bags
Composition	Function composition (closures)	OOP builder pattern (clone + modify)
Spatial	None (purely temporal)	GridPattern with cell state
Pattern-of-pattern	Supported via monadic bind	Not used
The Fundamental Tension
Strudel's model is designed for discrete musical events — notes have onsets, durations, and clear boundaries. The whole/part system exists because music cares about "when does this note start?" and "how long does it last?"

Uzuvid's visual domain cares about continuous state — "what color/video/alpha should this pixel be right now?" This makes point sampling natural, but it means uzuvid is using maybe 10% of Strudel's event model. The mininotation and time-subdivision machinery are valuable, but the event semantics (onset detection, event fragmentation, whole/part) go unused.

Possible Directions This Suggests
Onset-driven transitions: If uzuvid used hasOnset(), it could trigger transitions (crossfades, cuts) at event boundaries rather than hard-switching every frame.
Event duration awareness: Knowing an event spans 0.5 cycles could drive effects like fade-in/fade-out automatically.
Fraction-based time: Using Strudel's fraction math for cycle position would eliminate any float-drift issues in long performances.
Bind/patterns-of-patterns: Could enable meta-patterns like "this pattern determines which other pattern plays in this cell."
```