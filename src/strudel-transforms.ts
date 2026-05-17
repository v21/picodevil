/**
 * Documentation stubs for Strudel pattern transforms available in the editor.
 * Re-declared here purely so JSDoc can be extracted for the sidebar reference tab.
 * Actual implementations come from @strudel/core.
 */
import {
  Pattern as CorePattern,
  morph as _morph,
  stepcat as _stepcat,
  stepalt as _stepalt,
  tour as _tour,
  zip as _zip,
  stackLeft as _stackLeft,
  stackRight as _stackRight,
  stackCentre as _stackCentre,
  stackBy as _stackBy,
  register as _register,
} from "@strudel/core";

const PatternProto = CorePattern.prototype as any;

// ── Timing offsets ───────────────────────────────────────────────────────────

/**
 * Nudge a pattern earlier in time by the given number of cycles.
 * @param cycles amount to nudge (can be a pattern)
 * @example
 * $: stack(s("clip.mp4"), s("other.mp4").early(0.25))
 */
PatternProto.early = PatternProto.early;

/**
 * Nudge a pattern later in time by the given number of cycles.
 * @param cycles amount to nudge (can be a pattern)
 * @example
 * $: stack(s("clip.mp4"), s("other.mp4").late(0.25))
 */
PatternProto.late = PatternProto.late;

/**
 * Superimposes a time-shifted, transformed copy of the pattern on top of the original.
 * @param time cycle offset of the copy
 * @param func transform to apply to the copy
 * @example
 * $: s("clip.mp4").off(0.25, x => x.alpha(0.4))
 */
PatternProto.off = PatternProto.off;

/**
 * Set the cycles per minute for this pattern. Equivalent to `.cps(cpm / 60)`.
 * @param cpm cycles per minute
 * @example
 * $: s("clip.mp4 other.mp4").cpm(90)
 */
PatternProto.cpm = PatternProto.cpm;

// ── Direction ─────────────────────────────────────────────────────────────────

/**
 * Reverse events within each cycle.
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4").rev()
 */
PatternProto.rev = PatternProto.rev;

/**
 * Reverse the whole pattern (across all cycles, not just within each one).
 * Compare `.rev()` which reverses within each cycle but keeps cycle order.
 * @example
 * $: s("clip.mp4 other.mp4").slow(4).revv()
 */
PatternProto.revv = PatternProto.revv;

/**
 * Plays the pattern forwards then backwards, alternating each cycle.
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4").palindrome()
 */
PatternProto.palindrome = PatternProto.palindrome;

// ── Conditional / periodic ────────────────────────────────────────────────────

/**
 * Apply a function every n cycles. Alias: `firstOf`.
 * @param n cycle period
 * @param func transform to apply on the nth cycle
 * @example
 * $: s("clip.mp4 other.mp4").every(4, x => x.rev())
 */
PatternProto.every = PatternProto.every;

/**
 * Apply a function on the first of every n cycles. Alias: `every`.
 * @param n cycle period
 * @param func transform to apply
 */
PatternProto.firstOf = PatternProto.firstOf;

/**
 * Apply a function on the last of every n cycles.
 * @param n cycle period
 * @param func transform to apply
 * @example
 * $: s("clip.mp4 other.mp4").lastOf(4, x => x.rev())
 */
PatternProto.lastOf = PatternProto.lastOf;

/**
 * Apply a function whenever a condition pattern is true (non-zero).
 * @param cond binary pattern — truthy values trigger the function
 * @param func transform to apply when condition is true
 * @example
 * $: s("clip.mp4").when("<0 1>/2", x => x.speed(-1))
 */
PatternProto.when = PatternProto.when;

/**
 * Apply a function only to events that fall within the given time window of each cycle.
 * @param start start of window (0–1 within a cycle)
 * @param end end of window (0–1 within a cycle)
 * @param func transform to apply to events in the window
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").within(0, 0.5, x => x.speed(2))
 */
PatternProto.within = PatternProto.within;

/**
 * Filter events using a predicate function. Removes haps for which the function returns false.
 * @param func predicate receiving a Hap, return false to remove
 */
PatternProto.filter = PatternProto.filter;

/**
 * Filter events by their start time within the cycle.
 * @param func predicate receiving the hap's begin time (0–1), return false to remove
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").filterWhen(t => t < 0.5)
 */
PatternProto.filterWhen = PatternProto.filterWhen;

// ── Rotation ──────────────────────────────────────────────────────────────────

/**
 * Rotate the pattern's start point forward each cycle. After n cycles, the pattern wraps back.
 * @param n number of divisions (rotation steps per full wrap)
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").iter(4)
 */
PatternProto.iter = PatternProto.iter;

/**
 * Like `iter`, but rotates backward each cycle.
 * @param n number of divisions
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").iterBack(4)
 */
PatternProto.iterBack = PatternProto.iterBack;

/**
 * Every other cycle: play the pattern once, at double speed, offset by a quarter cycle.
 * Creates a breakbeat-style feel.
 * @example
 * $: s("clip.mp4 other.mp4").brak()
 */
PatternProto.brak = PatternProto.brak;

/**
 * Splits the pattern into n slices, then plays slices in the order given by a second pattern.
 * Similar to `slice` but works on pattern structure rather than sample data.
 * @param n number of slices
 * @param indices pattern of slice indices to play
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").bite(4, "3 2 1 0")
 */
PatternProto.bite = PatternProto.bite;

// ── Time window ───────────────────────────────────────────────────────────────

/**
 * Play only the portion of the pattern between positions b and e (0–1 within a cycle).
 * The selected portion is stretched to fill the whole cycle.
 * @param b begin fraction (0–1)
 * @param e end fraction (0–1)
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").zoom(0.25, 0.75)
 */
PatternProto.zoom = PatternProto.zoom;

/**
 * Compress the whole pattern into the span [b, e] within each cycle, leaving silence around it.
 * @param b start of compressed region (0–1)
 * @param e end of compressed region (0–1)
 * @example
 * $: s("clip.mp4 other.mp4").compress(0.25, 0.75)
 */
PatternProto.compress = PatternProto.compress;

/**
 * Like `compress`, but the focus region tiles to fill the cycle rather than leaving gaps.
 * @param b start fraction
 * @param e end fraction
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").focus(0.25, 0.75)
 */
PatternProto.focus = PatternProto.focus;

/**
 * Speed the pattern up by factor n, but leave silence for the remaining portion of the cycle.
 * @param factor speedup (e.g. 2 = plays at double speed in first half, silent second half)
 * @example
 * $: s("clip.mp4 other.mp4").fastGap(2)
 */
PatternProto.fastGap = PatternProto.fastGap;

/**
 * Loop a fixed portion of absolute time as a ribbon cut from the timeline.
 * @param offset start of the ribbon in absolute cycles
 * @param cycles length of the ribbon in cycles
 * @example
 * $: s("clip.mp4 other.mp4").ribbon(4, 2)
 */
PatternProto.ribbon = PatternProto.ribbon;

// ── Repetition ────────────────────────────────────────────────────────────────

/**
 * Select the given fraction of the pattern and repeat it to fill the rest of the cycle.
 * @param fraction fraction to keep and loop (e.g. 0.5 = first half repeated)
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").linger(0.5)
 */
PatternProto.linger = PatternProto.linger;

/**
 * Repeat each cycle n times before advancing.
 * @param n repetitions per cycle
 * @example
 * $: s("clip.mp4 other.mp4").repeatCycles(3)
 */
PatternProto.repeatCycles = PatternProto.repeatCycles;

/**
 * Repeat each event n times within its timespan.
 * @param n repetitions per event
 * @example
 * $: s("clip.mp4 other.mp4").ply(3)
 */
PatternProto.ply = PatternProto.ply;

/**
 * Like `ply`, but applies a function to each repeated copy.
 * @param n repetitions per event
 * @param func transform applied to each copy
 * @example
 * $: s("clip.mp4").plyWith(4, (p, i) => p.alpha(1 - i * 0.25))
 */
PatternProto.plyWith = PatternProto.plyWith;

/**
 * Like `plyWith`, but passes the iteration index as the second argument to the function.
 * @param n repetitions per event
 * @param func function receiving (pattern, index)
 */
PatternProto.plyForEach = PatternProto.plyForEach;

/**
 * Superimpose multiple time-offset copies of the pattern, applying a function to each.
 * @param times number of copies
 * @param time cycle offset between copies
 * @param func function receiving (copy, index)
 * @example
 * $: s("clip.mp4").echoWith(4, 0.125, (p, i) => p.alpha(1 - i * 0.2))
 */
PatternProto.echoWith = PatternProto.echoWith;

// ── Overlay / application ─────────────────────────────────────────────────────

/**
 * Overlay the original pattern with a transformed version (both play simultaneously).
 * @param func transform to apply to the copy
 * @example
 * $: s("clip.mp4").superimpose(x => x.early(0.5).alpha(0.5))
 */
PatternProto.superimpose = PatternProto.superimpose;

/**
 * Apply a function to the pattern. Equivalent to calling `func(pattern)`.
 * Useful for applying named transforms inline.
 * @param func function to apply
 * @example
 * $: s("clip.mp4 other.mp4").apply(x => x.every(4, p => p.rev()))
 */
PatternProto.apply = PatternProto.apply;

/**
 * Apply a function n times to the pattern.
 * @param n number of applications
 * @param func function to apply
 */
PatternProto.applyN = PatternProto.applyN;

/**
 * Speed up the pattern by factor r (like `fast`), and also multiply `.speed()` by r.
 * Keeps visual and playback rates in sync.
 * @param r speedup factor
 * @example
 * $: s("clip.mp4 other.mp4").hurry(2)
 */
PatternProto.hurry = PatternProto.hurry;

// ── Temporal nesting ──────────────────────────────────────────────────────────

/**
 * Apply a function 'inside' a scaled-up time window of n cycles, then scale back.
 * Equivalent to `.slow(n).func().fast(n)`.
 * @param n number of cycles to operate over
 * @param func transform to apply in the stretched time
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").inside(2, rev)
 */
PatternProto.inside = PatternProto.inside;

/**
 * Apply a function 'outside' a compressed time window. Equivalent to `.fast(n).func().slow(n)`.
 * @param n compression factor
 * @param func transform to apply
 * @example
 * $: s("clip.mp4 other.mp4").outside(2, x => x.rev())
 */
PatternProto.outside = PatternProto.outside;

/**
 * Divide the pattern into n chunks, cycling through them one per cycle and applying a function.
 * @param n number of chunks
 * @param func transform to apply to the current chunk
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").chunk(4, x => x.speed(-1))
 */
PatternProto.chunk = PatternProto.chunk;

/**
 * Like `chunk`, but cycles through chunks in reverse order.
 * @param n number of chunks
 * @param func transform to apply to the current chunk
 */
PatternProto.chunkBack = PatternProto.chunkBack;

// ── Rhythm / timing shape ─────────────────────────────────────────────────────

/**
 * Swing: delays events in the second half of each subdivision by a fraction.
 * 0 = no swing, 0.5 = maximum swing.
 * @param swing delay amount (0–1 relative to half-subdivision duration)
 * @param n number of subdivisions per cycle
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").swingBy(1/3, 4)
 */
PatternProto.swingBy = PatternProto.swingBy;

/**
 * Shorthand for `.swingBy(1/3, n)`.
 * @param n number of subdivisions
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").swing(4)
 */
PatternProto.swing = PatternProto.swing;

/**
 * Shift each event halfway into its timespan (syncopation).
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").press()
 */
PatternProto.press = PatternProto.press;

/**
 * Like `press`, but shift by a given fraction of each event's timespan.
 * @param r shift amount (0–1; 0.5 = same as press)
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").pressBy(0.25)
 */
PatternProto.pressBy = PatternProto.pressBy;

// ── Binary structure ──────────────────────────────────────────────────────────

/**
 * Apply the structure (rhythmic onsets) of a binary pattern to this pattern.
 * Only events aligned with 'true' steps in the binary pattern are kept.
 * @param binary mini-notation or list of 0s/1s defining the rhythmic structure
 * @example
 * $: s("clip.mp4").struct("1 0 1 1 0 1 0 1")
 */
PatternProto.struct = PatternProto.struct;

/**
 * Silence events where the mask pattern is 0 (or false).
 * @param binary pattern — 0/false removes the event, 1/true keeps it
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").mask("1 0 1 0")
 */
PatternProto.mask = PatternProto.mask;

/**
 * Swap 0s and 1s in a binary pattern. Useful with `.struct()` to invert a rhythm.
 * @example
 * $: s("clip.mp4").struct("1 0 0 1 0 0 1 0".invert())
 */
PatternProto.invert = PatternProto.invert;

// ── Arpeggio / index selection ────────────────────────────────────────────────

/**
 * When events are stacked (simultaneous), select which stacked event to play using an index pattern.
 * @param indices pattern of indices into the stack
 * @example
 * $: stack(s("clip.mp4"), s("other.mp4"), s("third.mp4")).arp("0 2 1 2")
 */
PatternProto.arp = PatternProto.arp;

/**
 * Like `arp`, but takes a function that receives the array of stacked haps and returns one.
 * @param func function receiving haps array, returning the selected hap
 */
PatternProto.arpWith = PatternProto.arpWith;

// ── Clip/sample manipulation ──────────────────────────────────────────────────

/**
 * Cut the clip into n equal pieces and play them as a sequence of short events.
 * Each piece is a granular slice of the source.
 * @param n number of pieces
 * @example
 * $: s("clip.mp4").chop(8)
 */
PatternProto.chop = PatternProto.chop;

/**
 * Like `chop`, but plays one piece per cycle in rotation, rather than all pieces per cycle.
 * @param n number of pieces
 * @example
 * $: s("clip.mp4").striate(8)
 */
PatternProto.striate = PatternProto.striate;

/**
 * Divide the clip into n slices, then play slices in the order given by a second pattern.
 * The second argument can be a number (evenly-spaced slices) or an array of cut points (0–1).
 * @param n number of slices (or array of cut points)
 * @param indices pattern of slice indices to play
 * @example
 * $: s("clip.mp4").slice(8, "0 1 2 3 4 5 6 7".rev())
 */
PatternProto.slice = PatternProto.slice;

/**
 * Like `slice`, but adjusts playback speed so each slice fills its step duration exactly.
 * @param n number of slices
 * @param indices pattern of slice indices
 * @example
 * $: s("clip.mp4").splice(4, "0 2 1 3")
 */
PatternProto.splice = PatternProto.splice;

/**
 * Change the playback speed so the clip fits exactly into the given number of cycles.
 * @param cycles target loop length in cycles
 * @example
 * $: s("clip.mp4").loopAt(2)
 */
PatternProto.loopAt = PatternProto.loopAt;

/**
 * Like `loopAt`, but also accounts for a specific cps value when computing speed.
 * @param cycles target loop length
 * @param cps cycles per second to use for the calculation
 */
PatternProto.loopAtCps = PatternProto.loopAtCps;

// ── Value arithmetic ──────────────────────────────────────────────────────────
// These operate on the pattern's value directly (a scalar or the whole object).
// For field-specific arithmetic on object-valued patterns, use .addOn(), .mulOn(), etc.

/**
 * Add a value (or pattern of values) to all events.
 * @param n value to add (can be a pattern)
 * @example
 * pure(0.5).add(sine.range(-0.1, 0.1))
 */
PatternProto.add = PatternProto.add;

/**
 * Subtract a value from all events.
 * @param n value to subtract
 */
PatternProto.sub = PatternProto.sub;

/**
 * Multiply all events by a value.
 * @param n multiplier
 * @example
 * saw.mul(0.5)
 */
PatternProto.mul = PatternProto.mul;

/**
 * Divide all events by a value.
 * @param n divisor
 */
PatternProto.div = PatternProto.div;

/**
 * Modulo all events by a value.
 * @param n modulus
 */
PatternProto.mod = PatternProto.mod;

/**
 * Raise all events to the given power.
 * @param n exponent
 */
PatternProto.pow = PatternProto.pow;

/**
 * Round all event values to the nearest integer.
 * @example
 * sine.range(0, 8).round()
 */
PatternProto.round = PatternProto.round;

/**
 * Floor all event values (round down to nearest integer).
 * @example
 * saw.range(0, 4).floor()
 */
PatternProto.floor = PatternProto.floor;

/**
 * Ceiling all event values (round up to nearest integer).
 */
PatternProto.ceil = PatternProto.ceil;

/**
 * Scale values from [0, 1] to [min, max] using an exponential (logarithmic) curve.
 * Useful for perceptually uniform ranges. Compare `.range()` which is linear.
 * @param min lower bound
 * @param max upper bound
 * @example
 * sine.rangex(0.1, 1.0)
 */
PatternProto.rangex = PatternProto.rangex;

/**
 * Scale values from the bipolar range [-1, 1] to [min, max].
 * @param min lower bound
 * @param max upper bound
 */
PatternProto.range2 = PatternProto.range2;

/**
 * Convert values from unipolar [0, 1] to bipolar [-1, 1].
 * @example
 * sine.toBipolar()
 */
PatternProto.toBipolar = PatternProto.toBipolar;

/**
 * Convert values from bipolar [-1, 1] to unipolar [0, 1].
 */
PatternProto.fromBipolar = PatternProto.fromBipolar;

/**
 * Parse ratio strings like `"3:2"` into floating-point numbers.
 * @example
 * pure("3:2").ratio()
 */
PatternProto.ratio = PatternProto.ratio;

/**
 * Apply an arbitrary function to the value of each event.
 * @param func function from value to new value
 * @example
 * pure(0.7).withValue(v => Math.sin(v * Math.PI))
 */
PatternProto.withValue = PatternProto.withValue;

// ── Binary rhythm morphing ────────────────────────────────────────────────────

/**
 * Morphs between two binary rhythms (lists of 1s/0s). The `by` value (0–1) slides
 * the onset positions from the first rhythm toward the second.
 * Both rhythms must have the same number of 1s.
 * @param from first rhythm as array or mini-notation
 * @param to second rhythm as array or mini-notation
 * @param by blend amount 0–1 (can be a signal)
 * @example
 * $: s("clip.mp4").struct(morph([1,0,1,0,1,0,1,0], [1,1,0,1,0,0,1,0], sine.slow(8)))
 */
export const morph = _morph;

// ── Step composition ──────────────────────────────────────────────────────────

/**
 * Concatenate patterns proportionally by step count (like `cat` but aware of step lengths).
 * Arguments can be plain patterns (steps inferred) or `[length, pattern]` pairs.
 * Alias: `timecat`, `timeCat`.
 * @example
 * $: stepcat(s("clip.mp4").take(3), s("other.mp4").take(1)).pace(4)
 */
export const stepcat = _stepcat;

/**
 * Concatenate patterns stepwise. If an argument is a list, the full pattern alternates between
 * the list elements on successive pass-throughs.
 * @example
 * $: stepalt([s("clip.mp4"), s("other.mp4")], s("third.mp4")).pace(4)
 */
export const stepalt = _stepalt;

/**
 * Inserts the given pattern into each position of the list of patterns in turn.
 * On the first repetition it is inserted at the end, moving backwards on each repeat.
 * @example
 * $: tour(s("clip.mp4"), s("other.mp4"), s("third.mp4")).pace(8)
 */
export const tour = _tour;

/**
 * Zip the steps of multiple patterns together into a dense single cycle.
 * @example
 * $: zip(s("clip.mp4 other.mp4"), s("third.mp4 fourth.mp4")).pace(8)
 */
export const zip = _zip;

/**
 * Fit the pattern to exactly n steps per cycle (speeds it up or down to match).
 * Alias: `steps`.
 * @param n target steps per cycle
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4").pace(4)
 */
PatternProto.pace = PatternProto.pace;

/**
 * Take the first n steps from the pattern (or last n if n is negative).
 * @param n number of steps to keep
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").take(2).pace(4)
 */
PatternProto.take = PatternProto.take;

/**
 * Drop the first n steps from the pattern (or last n if n is negative).
 * @param n number of steps to drop
 */
PatternProto.drop = PatternProto.drop;

/**
 * Increase density AND step count by factor n (like `fast` but step-aware).
 * `"a b".extend(2)` in a stepcat behaves like `"a b a b"`, not `"[a b] [a b]"`.
 * @param n factor
 */
PatternProto.extend = PatternProto.extend;

/**
 * Like `extend`, repeats the pattern n times while preserving step count.
 * @param n factor
 */
PatternProto.replicate = PatternProto.replicate;

/**
 * Expand each step by factor n (stretches step duration without changing density).
 * @param n expansion factor (can be a pattern for per-step variation)
 */
PatternProto.expand = PatternProto.expand;

/**
 * Contract each step by factor n (shrinks step duration).
 * @param n contraction factor
 */
PatternProto.contract = PatternProto.contract;

/**
 * Progressively drop steps (one per cycle) until the pattern disappears, then repeat.
 * Positive n drops from the start; negative drops from the end.
 * @param n direction and step count
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").shrink(1).pace(4)
 */
PatternProto.shrink = PatternProto.shrink;

/**
 * Progressively add steps until the full pattern plays, then repeat.
 * Positive n grows from the start; negative grows from the end.
 * @param n direction and step count
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").grow(1).pace(4)
 */
PatternProto.grow = PatternProto.grow;

// ── Chunk variants ────────────────────────────────────────────────────────────

/**
 * Like `chunk`, but the source pattern is not repeated for each chunk group —
 * it advances through its own cycle as chunks rotate.
 * @param n number of chunks
 * @param func transform to apply to the current chunk
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").fastChunk(4, x => x.speed(2))
 */
PatternProto.fastChunk = PatternProto.fastChunk;

/**
 * Like `chunk`, but the function receives the current chunk looped to fill the cycle.
 * @param n number of chunks
 * @param func transform to apply
 * @example
 * $: s("clip.mp4 other.mp4 third.mp4 fourth.mp4").chunkInto(4, x => x.speed(2))
 */
PatternProto.chunkInto = PatternProto.chunkInto;

/**
 * Like `chunkInto`, but cycles through chunks in reverse order.
 * @param n number of chunks
 * @param func transform to apply
 */
PatternProto.chunkBackInto = PatternProto.chunkBackInto;

// ── Span / arc variants ───────────────────────────────────────────────────────

/**
 * Like `compress`, but accepts a TimeSpan object instead of separate begin/end values.
 * @param span TimeSpan with begin and end properties
 */
PatternProto.compressSpan = PatternProto.compressSpan;

/**
 * Like `focus`, but accepts a TimeSpan object instead of separate begin/end values.
 * @param span TimeSpan with begin and end properties
 */
PatternProto.focusSpan = PatternProto.focusSpan;

/**
 * Like `zoom`, but accepts a TimeSpan (arc) object instead of separate begin/end values.
 * @param arc TimeSpan with begin and end properties
 */
PatternProto.zoomArc = PatternProto.zoomArc;

// ── Conditional muting ────────────────────────────────────────────────────────

/**
 * Silence the pattern when the condition is true (non-zero), keep it otherwise.
 * Opposite of `mask`. Useful for conditionally disabling a pattern.
 * @param on condition — 1/true = silent, 0/false = pass through
 * @example
 * $: s("clip.mp4").bypass("<0 1>/4")
 */
PatternProto.bypass = PatternProto.bypass;

// ── Speed fitting ─────────────────────────────────────────────────────────────

/**
 * Automatically adjust playback speed so the clip fills its event duration exactly.
 * Similar to `loopAt` but derives the target duration from the event itself.
 * @example
 * $: s("clip.mp4").slow(2).fit()
 */
PatternProto.fit = PatternProto.fit;

// ── Step-aligned stack ────────────────────────────────────────────────────────

/**
 * Stack patterns, padding shorter ones with silence on the right to match the longest.
 * Step-aware: shorter patterns get a gap appended rather than being stretched.
 * @example
 * $: stackLeft(s("clip.mp4 other.mp4"), s("third.mp4")).pace(4)
 */
export const stackLeft = _stackLeft;

/**
 * Stack patterns, padding shorter ones with silence on the left.
 * @example
 * $: stackRight(s("clip.mp4 other.mp4"), s("third.mp4")).pace(4)
 */
export const stackRight = _stackRight;

/**
 * Stack patterns, padding shorter ones with equal silence on both sides (centred).
 */
export const stackCentre = _stackCentre;

/**
 * Stack patterns with alignment controlled by a string: `"left"`, `"right"`, or `"centre"`.
 * @param by alignment — `"left"` | `"right"` | `"centre"`
 * @example
 * $: stackBy("centre", s("clip.mp4 other.mp4"), s("third.mp4")).pace(4)
 */
export const stackBy = _stackBy;

// ── Comparison / logic ────────────────────────────────────────────────────────
// These produce binary (0/1) patterns, useful as arguments to .when() and .struct().

/**
 * Returns 1 where pattern values are less than n, else 0.
 * @param n threshold
 * @example
 * $: s("clip.mp4").when(sine.lt(0.5), x => x.speed(-1))
 */
PatternProto.lt = PatternProto.lt;

/**
 * Returns 1 where pattern values are greater than n, else 0.
 * @param n threshold
 * @example
 * $: s("clip.mp4").when(sine.gt(0.5), x => x.speed(2))
 */
PatternProto.gt = PatternProto.gt;

/**
 * Returns 1 where pattern values are less than or equal to n, else 0.
 * @param n threshold
 */
PatternProto.lte = PatternProto.lte;

/**
 * Returns 1 where pattern values are greater than or equal to n, else 0.
 * @param n threshold
 */
PatternProto.gte = PatternProto.gte;

/**
 * Returns 1 where pattern values equal n, else 0.
 * @param n value to compare
 */
PatternProto.eq = PatternProto.eq;

/**
 * Returns 1 where pattern values do not equal n, else 0.
 * @param n value to compare
 */
PatternProto.ne = PatternProto.ne;

/**
 * Logical AND of two binary patterns (both must be 1).
 * @param other second pattern
 * @example
 * $: s("clip.mp4").when(sine.gt(0.3).and(sine.lt(0.7)), x => x.alpha(0.5))
 */
PatternProto.and = PatternProto.and;

/**
 * Logical OR of two binary patterns (either must be 1).
 * @param other second pattern
 */
PatternProto.or = PatternProto.or;

// ── Object value operators ────────────────────────────────────────────────────

/**
 * Replace the value of each event with the given value (or pattern of values).
 * Overwrites the whole value, unlike `add`/`mul` which modify it arithmetically.
 * @param val new value (can be a pattern)
 */
PatternProto.set = PatternProto.set;

/**
 * Keep a pattern's structure but replace values with those from another pattern.
 * Similar to `set` but preserves the source pattern's timing.
 * @param other pattern to take values from
 */
PatternProto.keep = PatternProto.keep;

/**
 * Like `keep`, but only replaces values where the other pattern's value is truthy.
 * @param other pattern providing the replacement values
 */
PatternProto.keepif = PatternProto.keepif;

// ── Extending Strudel ─────────────────────────────────────────────────────────

/**
 * Register a new pattern method. Adds it both as a standalone function (returned)
 * and as a method on Pattern.prototype. The last parameter of `func` is always the pattern.
 * @param name method name (or array of names for aliases)
 * @param func implementation — last argument is the pattern; earlier args are patternified automatically
 * @example
 * const mySpeed = register('mySpeed', (factor, pat) => pat.speed(factor).fast(factor))
 * $: s("clip.mp4").mySpeed(2)
 */
export const register = _register;
