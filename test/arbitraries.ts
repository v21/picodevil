/**
 * fast-check arbitraries for uzuvid code generation.
 *
 * These mirror the grammar from the old monkey tester but use fast-check's
 * Arbitrary combinators, giving us automatic shrinking when tests fail.
 *
 * Shrinking strategy:
 * - oneof: simpler alternatives listed first (atoms before sub-cycles)
 * - arrays: shrink by removing elements (fewer method calls, children)
 * - numbers: shrink toward 0/1
 * - mininotation: shrinks toward single atoms
 */

import fc from "fast-check";

// ============================================================
// Terminal pools — all served from /test-assets/ via Vite
// ============================================================

export const VIDEOS = [
  "red.mp4",
  "blue.mp4",
  "HCP-4P0eoOo.mp4",
  "hXJaBfcdCKM.mp4",
];

/** Registry shorthand names (no extension, no urlBase needed). */
export const VIDEO_REGISTRY_NAMES = [
  "redvid",
  "bluevid",
  "clipA",
  "clipB",
];

export const IMAGES = [
  "red.png",
  "blue.png",
  "sprite1.png",
  "sprite2.png",
  "photo1.jpg",
  "photo2.jpg",
  "anim1.gif",
  "anim2.gif",
  "texture.webp",
];

/** Registry shorthand names for images. */
export const IMAGE_REGISTRY_NAMES = [
  "redimg",
  "blueimg",
  "sprite",
  "photo",
];

/** Media registry entries to seed before monkey tests. Maps name → relative URL. */
export const REGISTRY_SEED: Array<{ name: string; url: string }> = [
  ...VIDEO_REGISTRY_NAMES.map((name, i) => ({
    name,
    url: `/test-assets/${VIDEOS[i % VIDEOS.length]}`,
  })),
  // Also seed raw filenames so screen("red.mp4:...") resolves via registry, not VIDEO_BASE
  ...VIDEOS.map(file => ({ name: file, url: `/test-assets/${file}` })),
  ...IMAGE_REGISTRY_NAMES.map((name, i) => ({
    name,
    url: `/test-assets/${IMAGES[i % IMAGES.length]}`,
  })),
];

export const COLORS = [
  "red", "green", "blue", "yellow", "cyan", "magenta",
  "purple", "orange", "white", "black", "pink",
  "#ff0000", "#00ff00", "#0000ff", "#fff", "#000",
];

/** Short strings for text() source — single-quoted in generated code. */
const TEXT_STRINGS = [
  "hello", "world", "test", "hi", "foo", "bar",
  "line one\\nline two", "A", "42",
];

/** Underscore-joined words for s("text:word_word") tokens. */
const TEXT_TOKENS = [
  "hello", "hello_world", "foo_bar", "test_text", "line_one",
];

const CONTINUOUS_SIGNALS = [
  "sine", "sine2", "cosine", "cosine2",
  "saw", "saw2", "isaw", "isaw2",
  "tri", "tri2", "itri", "itri2",
  "square", "square2",
  "rand", "rand2", "perlin",
  "mouseX", "mouseY",
];

const DISCRETE_NUMERIC_SIGNALS = ["time"];
const DISCRETE_BOOLEAN_SIGNALS = ["brand"];

const FIT_MODES = ["cover", "contain", "fill", "none", "tile", "tilecenter"];

const BLEND_MODES = [
  "source-over", "multiply", "screen", "overlay",
  "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
];

const EASING_CURVES = [
  "linear", "sine", "quad", "cubic", "quart", "quint",
  "expo", "circ", "elastic", "bounce", "back",
];
const EASING_DIRS = ["in", "out", "inout"];

const SPEED_LITERALS = ["-2", "-1", "-0.5", "0", "0.1", "0.25", "0.5", "1", "2", "4", "8", "16"];

// ============================================================
// Mininotation arbitraries
// ============================================================

/** Mininotation operator: @N, !N, *N, /N, ?, (p,s) */
const miniOp: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 1, max: 4 }).map(n => `@${n}`),
  fc.integer({ min: 2, max: 4 }).map(n => `!${n}`),
  fc.integer({ min: 2, max: 4 }).map(n => `*${n}`),
  fc.integer({ min: 2, max: 4 }).map(n => `/${n}`),
  fc.constant("?"),
  fc.double({ min: 0.1, max: 0.9, noNaN: true }).map(n => `?${n.toFixed(1)}`),
  fc.tuple(
    fc.integer({ min: 2, max: 5 }),
    fc.integer({ min: 2, max: 8 }),
    fc.option(fc.integer({ min: 0, max: 7 }), { nil: undefined }),
  ).map(([p, s, rot]) => {
    const ss = Math.max(p, s);
    return rot !== undefined ? `(${p},${ss},${rot % ss})` : `(${p},${ss})`;
  }),
);

/**
 * Build a mininotation arbitrary for a given atom pool.
 * Uses fc.letrec for safe recursion with depth control via maxDepth.
 */
export function miniArb(pool: string[], _maxDepth = 2): fc.Arbitrary<string> {
  const atom = fc.constantFrom(...pool);

  // Build recursive grammar
  const { expr } = fc.letrec(tie => ({
    // A single slice: atom, sub-cycle, slow-sequence, polymeter, or rest
    slice: fc.oneof(
      { weight: 6, arbitrary: atom },
      { weight: 1, arbitrary: fc.constant("~") },
      { weight: 2, arbitrary: tie("seq").map(s => `[${s}]`) },
      { weight: 1, arbitrary: tie("seq").map(s => `<${s}>`) },
      {
        weight: 1, arbitrary: fc.tuple(
          tie("seq"),
          fc.option(fc.integer({ min: 2, max: 5 }), { nil: undefined }),
        ).map(([s, pct]) => pct !== undefined ? `{${s}}%${pct}` : `{${s}}`)
      },
    ),

    // Slice with optional operators
    sliceWithOps: fc.tuple(
      tie("slice"),
      fc.array(miniOp, { minLength: 0, maxLength: 2 }),
    ).map(([s, ops]) => s + ops.join("")),

    // Sequence: space-separated slices
    seq: fc.array(tie("sliceWithOps"), { minLength: 1, maxLength: 4 })
      .map(items => items.join(" ")),

    // Top-level: plain sequence, stack (comma), or choose (pipe)
    expr: fc.oneof(
      { weight: 6, arbitrary: tie("seq") },
      { weight: 2, arbitrary: fc.array(tie("seq"), { minLength: 2, maxLength: 3 }).map(ss => ss.join(", ")) },
      { weight: 1, arbitrary: fc.array(tie("seq"), { minLength: 2, maxLength: 4 }).map(ss => ss.join(" | ")) },
    ),
  }));

  return (expr as fc.Arbitrary<string>).filter(s => s.length > 0 && s.length < 200);
}

// ============================================================
// Signal & argument arbitraries
// ============================================================

/** Continuous signal with optional modifiers and easing — no time conversion, returns numbers. */
const continuousSignal: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom(...CONTINUOUS_SIGNALS),
  fc.oneof(
    { weight: 5, arbitrary: fc.constant("") },
    {
      weight: 2, arbitrary: fc.tuple(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
      ).map(([lo, hi]) => `.range(${lo.toFixed(2)}, ${hi.toFixed(2)})`)
    },
    { weight: 1, arbitrary: fc.constantFrom(2, 3, 4, 8).map(n => `.div(${n})`) },
  ),
  fc.oneof(
    { weight: 5, arbitrary: fc.constant("") },
    {
      weight: 2, arbitrary: fc.tuple(
        fc.constantFrom(8, 16, 32),
        fc.oneof(
          fc.constantFrom(...EASING_CURVES).map(c => `'${c}'`),
          miniArb(EASING_CURVES, 1).map(m => `"${m}"`),
        ),
        fc.oneof(
          fc.constantFrom(...EASING_DIRS).map(d => `'${d}'`),
          miniArb(EASING_DIRS, 1).map(m => `"${m}"`),
        ),
      ).map(([n, c, d]) => `.segment(${n}).lerp(${c}, ${d})`)
    },
    {
      weight: 1, arbitrary: fc.tuple(
        fc.constantFrom(8, 16, 32),
        fc.oneof(
          fc.double({ min: 0.1, max: 1.0, noNaN: true }).map(n => n.toFixed(2)),
          miniArb(["0.1", "0.3", "0.5", "0.8", "1"], 1).map(m => `"${m}"`),
        ),
      ).map(([n, t]) => `.segment(${n}).spline(${t})`)
    },
  ),
).map(([sig, mod, easing]) => sig + mod + easing);

const numericSignalFunction: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 2, max: 10 }).map(n => `irand(${n})`),
  fc.array(fc.constantFrom(...SPEED_LITERALS.filter(s => s !== "0")), { minLength: 2, maxLength: 5 })
    .map(vs => `choose(${vs.join(", ")})`),
  fc.array(fc.constantFrom(...SPEED_LITERALS.filter(s => s !== "0")), { minLength: 2, maxLength: 5 })
    .map(vs => `chooseCycles(${vs.join(", ")})`),
  fc.array(fc.constantFrom(...SPEED_LITERALS.filter(s => s !== "0")), { minLength: 2, maxLength: 5 })
    .map(vs => `chooseIn(${vs.join(", ")})`),
  fc.integer({ min: 1, max: 8 }).map(n => `run(${n})`),
  fc.double({ min: 0, max: 1, noNaN: true }).map(n => `steady(${n.toFixed(2)})`),
  fc.tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 2, noNaN: true }),
  ).map(([val, min, max]) => {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max) || 1;
    const v = lo + val * (hi - lo);
    return `slider(${v.toFixed(3)}, ${lo.toFixed(2)}, ${hi.toFixed(2)})`;
  }),
);

/** Any signal expression (may include booleans — use for speed). */
const anySignalExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: continuousSignal },
  { weight: 1, arbitrary: fc.constantFrom(...DISCRETE_NUMERIC_SIGNALS, ...DISCRETE_BOOLEAN_SIGNALS) },
  { weight: 2, arbitrary: numericSignalFunction },
  { weight: 1, arbitrary: fc.double({ min: 0.1, max: 0.9, noNaN: true }).map(n => `brandBy(${n.toFixed(2)})`) },
);

// ============================================================
// Unconstrained numeric arg helpers
// ============================================================

/** Wide pool of numeric mini-patternable literals (negatives, fractions, large). */
const NUMERIC_LITERALS = [
  "-16", "-8", "-4", "-2", "-1", "-0.5", "-0.25", "-0.125",
  "0", "0.125", "0.25", "0.5", "0.75", "1", "2", "4", "8", "16",
];

/** Any numeric argument: unconstrained double, signal, or mini-patterned literal. */
const numericArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.double({ noNaN: true }).map(n => String(n)) },
  { weight: 4, arbitrary: anySignalExpr },
  { weight: 3, arbitrary: miniArb(NUMERIC_LITERALS, 1).map(m => `"${m}"`) },
);

/** Any integer argument: wide-range literal, signal, or mini-patterned literal. */
const integerArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: -16, max: 64 }).map(n => String(n)) },
  { weight: 3, arbitrary: anySignalExpr },
  { weight: 2, arbitrary: miniArb(NUMERIC_LITERALS.filter(n => !n.includes(".")), 1).map(m => `"${m}"`) },
);

/** Binary/boolean pattern: mini 0/1, or signal comparison. */
const binaryPatArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: miniArb(["0", "1"], 2).map(m => `"${m}"`) },
  { weight: 3, arbitrary: anySignalExpr.map(s => `(${s}).gt(0.5)`) },
  { weight: 3, arbitrary: anySignalExpr.map(s => `(${s}).lt(0.5)`) },
);

/** Speed argument: signal or quoted mininotation of speed literals. */
const speedArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: anySignalExpr },
  { weight: 6, arbitrary: miniArb(SPEED_LITERALS, 2).map(m => `"${m}"`) },
);

/** Alpha argument: signal or quoted mininotation of alpha values. */
const alphaArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: continuousSignal },
  { weight: 6, arbitrary: miniArb(["0", "0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
);

/** Rotation argument (in turns). */
const rotArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: continuousSignal },
  { weight: 6, arbitrary: miniArb(["0", "0.25", "0.5", "0.75", "1", "-0.25"], 1).map(m => `"${m}"`) },
);

/** Scale argument. */
const scaleArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: continuousSignal },
  { weight: 6, arbitrary: miniArb(["0.5", "1", "1.5", "2", "-1", "0.25", "3"], 1).map(m => `"${m}"`) },
);

/** Position argument. */
const posArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: continuousSignal },
  { weight: 6, arbitrary: miniArb(["0", "0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
  // Edge cases: negative, >1, and values that create inverted ranges
  { weight: 1, arbitrary: miniArb(["-0.5", "-0.25", "0", "1.5", "2"], 1).map(m => `"${m}"`) },
);

/** Dimension argument. */
const dimArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: continuousSignal },
  { weight: 7, arbitrary: miniArb(["0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
);

/** Crop coordinate argument: normalized [0,1] with a few edge cases outside the range. */
const cropArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: miniArb(["0", "0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
  { weight: 2, arbitrary: continuousSignal },
  // Edge cases: values outside [0,1] trigger tiling
  { weight: 1, arbitrary: miniArb(["-0.1", "-0.25", "1.1", "1.25", "1.5"], 1).map(m => `"${m}"`) },
);

/** Crop width/height argument: positive fractions, occasionally > 1 for tiling. */
const cropDimArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: miniArb(["0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
  { weight: 2, arbitrary: continuousSignal },
  { weight: 1, arbitrary: miniArb(["1.1", "1.25", "1.5", "2"], 1).map(m => `"${m}"`) },
);

// ============================================================
// Strudel pattern method arbitraries
// ============================================================

/** Seed argument for shuffleStack/shuffleStackCycle: number, mini pattern, or signal. */
const shuffleSeed: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 100 }).map(n => `${n}`) },
  { weight: 3, arbitrary: miniArb(["1", "2", "3", "4", "5", "6", "7", "8"], 1).map(m => `"${m}"`) },
  { weight: 2, arbitrary: fc.constantFrom("sine", "saw", "rand", "tri") },
  { weight: 2, arbitrary: fc.constant("") }, // no arg = default fixed shuffle
);

/** Strudel methods + transform functions — mutually recursive via fc.letrec. */
const _strudelBuilders = fc.letrec((tie: any) => ({
  simpleTransformFn: fc.oneof(
    { weight: 4, arbitrary: numericArg.map((n: string) => `x => x.fast(${n})`) },
    { weight: 4, arbitrary: numericArg.map((n: string) => `x => x.slow(${n})`) },
    { weight: 3, arbitrary: fc.constant("x => x.rev()") },
    { weight: 2, arbitrary: alphaArg.map((a: string) => `x => x.alpha(${a})`) },
    { weight: 2, arbitrary: speedArg.map((s: string) => `x => x.speed(${s})`) },
    { weight: 2, arbitrary: rotArg.map((r: string) => `x => x.rotateZ(${r})`) },
    { weight: 2, arbitrary: posArg.map((p: string) => `x => x.x(${p})`) },
    { weight: 1, arbitrary: fc.constant("x => x.palindrome()") },
    { weight: 1, arbitrary: fc.constant("x => x.brak()") },
    { weight: 1, arbitrary: integerArg.map((n: string) => `x => x.iter(${n})`) },
    { weight: 1, arbitrary: (tie("strudelMethod") as fc.Arbitrary<string>).map((m: string) => `x => x${m}`) },
  ),
  strudelMethod: fc.oneof(
    // ── Existing (now use numericArg/integerArg) ────────────────────────────
    { weight: 3, arbitrary: numericArg.map((n: string) => `.slow(${n})`) },
    { weight: 3, arbitrary: numericArg.map((n: string) => `.fast(${n})`) },
    { weight: 3, arbitrary: fc.constant(".rev()") },
    { weight: 2, arbitrary: integerArg.map((n: string) => `.chop(${n})`) },
    { weight: 2, arbitrary: integerArg.map((n: string) => `.chop(${n}).rev()`) },
    { weight: 2, arbitrary: fc.tuple(integerArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.every(${n}, ${fn})`) },

    // ── Timing offsets ────────────────────────────────────────────────────
    { weight: 2, arbitrary: numericArg.map((n: string) => `.early(${n})`) },
    { weight: 2, arbitrary: numericArg.map((n: string) => `.late(${n})`) },

    // ── Direction / no-arg ────────────────────────────────────────────────
    { weight: 2, arbitrary: fc.constant(".palindrome()") },
    { weight: 1, arbitrary: fc.constant(".revv()") },
    { weight: 1, arbitrary: fc.constant(".brak()") },
    { weight: 1, arbitrary: fc.constant(".press()") },
    { weight: 1, arbitrary: numericArg.map((f: string) => `.pressBy(${f})`) },
    { weight: 1, arbitrary: fc.constant(".invert()") },

    // ── Rotation ──────────────────────────────────────────────────────────
    { weight: 2, arbitrary: integerArg.map((n: string) => `.iter(${n})`) },
    { weight: 2, arbitrary: integerArg.map((n: string) => `.iterBack(${n})`) },

    // ── Time windows ──────────────────────────────────────────────────────
    { weight: 2, arbitrary: fc.tuple(numericArg, numericArg)
        .map(([b, e]: [string, string]) => `.zoom(${b}, ${e})`) },
    { weight: 2, arbitrary: fc.tuple(numericArg, numericArg)
        .map(([b, e]: [string, string]) => `.compress(${b}, ${e})`) },
    { weight: 1, arbitrary: fc.tuple(numericArg, numericArg)
        .map(([b, e]: [string, string]) => `.focus(${b}, ${e})`) },
    { weight: 1, arbitrary: numericArg.map((n: string) => `.fastGap(${n})`) },
    { weight: 1, arbitrary: numericArg.map((f: string) => `.linger(${f})`) },
    { weight: 1, arbitrary: fc.tuple(numericArg, numericArg)
        .map(([o, c]: [string, string]) => `.ribbon(${o}, ${c})`) },

    // ── Repetition ────────────────────────────────────────────────────────
    { weight: 2, arbitrary: integerArg.map((n: string) => `.ply(${n})`) },
    { weight: 1, arbitrary: integerArg.map((n: string) => `.repeatCycles(${n})`) },

    // ── Rhythm ────────────────────────────────────────────────────────────
    { weight: 2, arbitrary: numericArg.map((n: string) => `.swing(${n})`) },
    { weight: 2, arbitrary: fc.tuple(numericArg, numericArg)
        .map(([f, n]: [string, string]) => `.swingBy(${f}, ${n})`) },
    { weight: 2, arbitrary: numericArg.map((n: string) => `.hurry(${n})`) },

    // ── Conditional / periodic ────────────────────────────────────────────
    { weight: 2, arbitrary: fc.tuple(integerArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.firstOf(${n}, ${fn})`) },
    { weight: 2, arbitrary: fc.tuple(integerArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.lastOf(${n}, ${fn})`) },
    { weight: 2, arbitrary: fc.tuple(binaryPatArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([c, fn]: [string, string]) => `.when(${c}, ${fn})`) },

    // ── Overlay / echo ────────────────────────────────────────────────────
    { weight: 2, arbitrary: (tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map((fn: string) => `.superimpose(${fn})`) },
    { weight: 2, arbitrary: fc.tuple(numericArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([t, fn]: [string, string]) => `.off(${t}, ${fn})`) },
    { weight: 2, arbitrary: fc.tuple(integerArg, numericArg)
        .map(([n, t]: [string, string]) => `.echoWith(${n}, ${t}, (p, i) => p.alpha(1 - i * 0.25))`) },
    { weight: 2, arbitrary: fc.tuple(integerArg, numericArg, numericArg)
        .map(([n, t, f]: [string, string, string]) => `.echo(${n}, ${t}, ${f})`) },

    // ── Temporal nesting ──────────────────────────────────────────────────
    { weight: 2, arbitrary: fc.tuple(numericArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.inside(${n}, ${fn})`) },
    { weight: 1, arbitrary: fc.tuple(numericArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.outside(${n}, ${fn})`) },
    { weight: 2, arbitrary: fc.tuple(integerArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.chunk(${n}, ${fn})`) },
    { weight: 2, arbitrary: fc.tuple(integerArg, tie("simpleTransformFn") as fc.Arbitrary<string>)
        .map(([n, fn]: [string, string]) => `.chunkBack(${n}, ${fn})`) },

    // ── Binary structure ──────────────────────────────────────────────────
    { weight: 1, arbitrary: miniArb(["0", "1"], 2).map((m: string) => `.struct("${m}")`) },
    { weight: 1, arbitrary: miniArb(["0", "1"], 2).map((m: string) => `.mask("${m}")`) },

    // ── Conditional muting ────────────────────────────────────────────────
    { weight: 1, arbitrary: binaryPatArg.map((c: string) => `.bypass(${c})`) },

    // ── Step ops ──────────────────────────────────────────────────────────
    { weight: 1, arbitrary: integerArg.map((n: string) => `.pace(${n})`) },
    { weight: 1, arbitrary: integerArg.map((n: string) => `.take(${n})`) },
    { weight: 1, arbitrary: integerArg.map((n: string) => `.drop(${n})`) },
    { weight: 1, arbitrary: integerArg.map((n: string) => `.shrink(${n})`) },
    { weight: 1, arbitrary: integerArg.map((n: string) => `.grow(${n})`) },
  ),
}));

const strudelMethod = _strudelBuilders.strudelMethod as fc.Arbitrary<string>;
const simpleTransformFn = _strudelBuilders.simpleTransformFn as fc.Arbitrary<string>;

// ============================================================
// Method chain arbitraries
// ============================================================

interface MethodCall { code: string }

const videoMethod: fc.Arbitrary<MethodCall> = fc.oneof(
  speedArg.map(a => ({ code: `.speed(${a})` })),
  posArg.map(a => ({ code: `.begin(${a})` })),
  posArg.map(a => ({ code: `.end(${a})` })),
  posArg.map(a => ({ code: `.duration(${a})` })),
  posArg.map(a => ({ code: `.dur(${a})` })),
  posArg.map(a => ({ code: `.scrub(${a})` })),
  fc.constant({ code: `.speed(0)` }),
  fc.constantFrom(...SPEED_LITERALS).map(n => ({ code: `.speed(${n})` })),
  // sync mode: bare sync(), sync(true), sync(fraction)
  fc.constant({ code: `.sync()` }),
  fc.constant({ code: `.sync(true)` }),
  fc.double({ min: 0, max: 1, noNaN: true }).map(n => ({ code: `.sync(${n.toFixed(2)})` })),
  alphaArg.map(a => ({ code: `.alpha(${a})` })),
  alphaArg.map(a => ({ code: `.opacity(${a})` })),
  fc.double({ min: 1, max: 64, noNaN: true }).map(n => ({ code: `.pixelate(${Math.round(n)})` })),
  fc.constantFrom(...FIT_MODES).map(m => ({ code: `.objectfit("${m}")` })),
  fc.constantFrom(...BLEND_MODES).map(m => ({ code: `.blend("${m}")` })),
  miniArb(BLEND_MODES, 1).map(m => ({ code: `.blend("${m}")` })),
  alphaArg.map(a => ({ code: `.grey(${a})` })),
  alphaArg.map(a => ({ code: `.huerot(${a})` })),
  numericArg.map(a => ({ code: `.contrast(${a})` })),
  numericArg.map(a => ({ code: `.brightness(${a})` })),
  fc.tuple(rotArg, numericArg).map(([h, s]) => ({ code: `.tint(${h}, ${s})` })),
  rotArg.map(h => ({ code: `.tint(${h})` })),
  scaleArg.map(a => ({ code: `.scaleX(${a})` })),
  scaleArg.map(a => ({ code: `.scaleY(${a})` })),
  scaleArg.map(a => ({ code: `.scale(${a})` })),
  rotArg.map(a => ({ code: `.rotateX(${a})` })),
  rotArg.map(a => ({ code: `.rotateY(${a})` })),
  rotArg.map(a => ({ code: `.rotateZ(${a})` })),
  rotArg.map(a => ({ code: `.rotate(${a})` })),
  fc.tuple(rotArg, rotArg).map(([t, ax]) => ({ code: `.rotate(${t}, ${ax})` })),
  numericArg.map(a => ({ code: `.barrel(${a})` })),
  // crop controls
  cropArg.map(a => ({ code: `.cropx(${a})` })),
  cropArg.map(a => ({ code: `.cropy(${a})` })),
  cropDimArg.map(a => ({ code: `.cropw(${a})` })),
  cropDimArg.map(a => ({ code: `.croph(${a})` })),
  fc.tuple(cropArg, cropArg, cropDimArg, cropDimArg).map(([x, y, w, h]) => ({
    code: `.crop(${x}, ${y}, ${w}, ${h})`,
  })),
  cropDimArg.map(a => ({ code: `.cropwh(${a})` })),
);

const videoChain: fc.Arbitrary<string> = fc.array(videoMethod, { minLength: 0, maxLength: 5 })
  .map(ms => ms.map(m => m.code).join(""));

const sharedMethod: fc.Arbitrary<MethodCall> = fc.oneof(
  alphaArg.map(a => ({ code: `.alpha(${a})` })),
  alphaArg.map(a => ({ code: `.opacity(${a})` })),
  fc.double({ min: 1, max: 64, noNaN: true }).map(n => ({ code: `.pixelate(${Math.round(n)})` })),
  fc.constantFrom(...FIT_MODES).map(m => ({ code: `.objectfit("${m}")` })),
  fc.constantFrom(...BLEND_MODES).map(m => ({ code: `.blend("${m}")` })),
  miniArb(BLEND_MODES, 1).map(m => ({ code: `.blend("${m}")` })),
  alphaArg.map(a => ({ code: `.grey(${a})` })),
  alphaArg.map(a => ({ code: `.huerot(${a})` })),
  numericArg.map(a => ({ code: `.contrast(${a})` })),
  numericArg.map(a => ({ code: `.brightness(${a})` })),
  fc.tuple(rotArg, numericArg).map(([h, s]) => ({ code: `.tint(${h}, ${s})` })),
  rotArg.map(h => ({ code: `.tint(${h})` })),
  scaleArg.map(a => ({ code: `.scaleX(${a})` })),
  scaleArg.map(a => ({ code: `.scaleY(${a})` })),
  scaleArg.map(a => ({ code: `.scale(${a})` })),
  rotArg.map(a => ({ code: `.rotateX(${a})` })),
  rotArg.map(a => ({ code: `.rotateY(${a})` })),
  rotArg.map(a => ({ code: `.rotateZ(${a})` })),
  rotArg.map(a => ({ code: `.rotate(${a})` })),
  fc.tuple(rotArg, rotArg).map(([t, ax]) => ({ code: `.rotate(${t}, ${ax})` })),
  numericArg.map(a => ({ code: `.barrel(${a})` })),
  // crop controls
  cropArg.map(a => ({ code: `.cropx(${a})` })),
  cropArg.map(a => ({ code: `.cropy(${a})` })),
  cropDimArg.map(a => ({ code: `.cropw(${a})` })),
  cropDimArg.map(a => ({ code: `.croph(${a})` })),
  fc.tuple(cropArg, cropArg, cropDimArg, cropDimArg).map(([x, y, w, h]) => ({
    code: `.crop(${x}, ${y}, ${w}, ${h})`,
  })),
  cropDimArg.map(a => ({ code: `.cropwh(${a})` })),
  posArg.map(a => ({ code: `.x(${a})` })),
  posArg.map(a => ({ code: `.y(${a})` })),
  posArg.map(a => ({ code: `.left(${a})` })),
  posArg.map(a => ({ code: `.top(${a})` })),
  dimArg.map(a => ({ code: `.width(${a})` })),
  dimArg.map(a => ({ code: `.height(${a})` })),
  dimArg.map(a => ({ code: `.w(${a})` })),
  dimArg.map(a => ({ code: `.h(${a})` })),
  fc.tuple(
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 0, max: 8 }),
  ).map(([r, c, i]) => ({ code: `.grid(${r}, ${c}, ${i})` })),
  // mapOn: extract a field and apply lerp/spline to it
  fc.tuple(
    fc.constantFrom("'x'", "'y'", "'alpha'", "'width'", "'height'", "'rotateZ'"),
    fc.oneof(
      fc.constant("x => x.lerp()"),
      fc.constantFrom(...EASING_CURVES).map(c => `x => x.lerp('${c}')`),
      fc.constant("x => x.spline()"),
    ),
  ).map(([key, fn]) => ({ code: `.mapOn(${key}, ${fn})` })),
  strudelMethod.map(code => ({ code })),
  // Structural modifiers (per-hap probability filters)
  fc.double({ min: 0.1, max: 0.9, noNaN: true }).map(p => ({ code: `.degradeBy(${p.toFixed(2)})` })),
  fc.constant({ code: `.degrade()` }),
  fc.tuple(fc.double({ min: 0.1, max: 0.9, noNaN: true }), simpleTransformFn)
    .map(([p, fn]) => ({ code: `.sometimesBy(${p.toFixed(2)}, ${fn})` })),
  simpleTransformFn.map(fn => ({ code: `.sometimes(${fn})` })),
  simpleTransformFn.map(fn => ({ code: `.often(${fn})` })),
  simpleTransformFn.map(fn => ({ code: `.rarely(${fn})` })),
  // shuffleStack/shuffleStackCycle/shuffleIndex/shuffleIndexCycle — can appear anywhere
  shuffleSeed.map(s => ({ code: `.shuffleStack(${s})` })),
  shuffleSeed.map(s => ({ code: `.shuffleStackCycle(${s})` })),
  shuffleSeed.map(s => ({ code: `.shuffleIndex(${s})` })),
  shuffleSeed.map(s => ({ code: `.shuffleIndexCycle(${s})` })),
  // text styling — valid on any pattern, harmless on non-text sources
  fc.constantFrom(...COLORS).map(c => ({ code: `.fontColor('${c}')` })),
  fc.constantFrom(...COLORS).map(c => ({ code: `.textColor('${c}')` })),
  fc.constantFrom(...COLORS).map(c => ({ code: `.fontBGColor('${c}')` })),
  fc.integer({ min: 8, max: 96 }).map(n => ({ code: `.fontSize(${n})` })),
  fc.integer({ min: 8, max: 96 }).map(n => ({ code: `.textSize(${n})` })),
  fc.constantFrom('sans-serif', 'monospace', 'serif', 'bold monospace', 'italic sans-serif')
    .map(f => ({ code: `.font('${f}')` })),
);

// ============================================================
// Screen expression arbitraries
// ============================================================

export interface GeneratedExpr {
  code: string;
}

/**
 * Mixed token pool for screen()/s(): registry names and colors.
 * Used without urlBase — registry handles resolution.
 */
const SCREEN_TOKENS = [
  ...COLORS.slice(0, 6),
  ...VIDEO_REGISTRY_NAMES,
  ...IMAGE_REGISTRY_NAMES,
];

/**
 * Token pool for screen() with extension-based filenames.
 * Must be paired with .urlBase('/test-assets/') in generated code.
 */
const SCREEN_EXT_TOKENS = [
  ...COLORS.slice(0, 4),
  "red.mp4", "blue.mp4",
  "red.png", "blue.png", "photo1.jpg",
];

/** A single screen expression (color, video, or image) without .out(). */
export const screenExpr: fc.Arbitrary<GeneratedExpr> = fc.oneof(
  // color
  {
    weight: 3, arbitrary: fc.tuple(
      miniArb(COLORS, 2),
      fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
    ).map(([pat, methods]) => ({
      code: `color("${pat}")${methods.map(m => m.code).join("")}`,
    }))
  },

  // color via explicit mini()
  {
    weight: 1, arbitrary: fc.tuple(
      miniArb(COLORS, 2),
      fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
    ).map(([pat, methods]) => ({
      code: `color(mini("${pat}"))${methods.map(m => m.code).join("")}`,
    }))
  },

  // image (with urlBase)
  {
    weight: 2, arbitrary: fc.tuple(
      miniArb(IMAGES, 1),
      fc.array(sharedMethod, { minLength: 0, maxLength: 4 }),
    ).map(([pat, methods]) => ({
      code: `image("${pat}").urlBase('/test-assets/')${methods.map(m => m.code).join("")}`,
    }))
  },

  // image (via registry name, no urlBase)
  {
    weight: 1, arbitrary: fc.tuple(
      miniArb(IMAGE_REGISTRY_NAMES, 1),
      fc.array(sharedMethod, { minLength: 0, maxLength: 4 }),
    ).map(([pat, methods]) => ({
      code: `image("${pat}")${methods.map(m => m.code).join("")}`,
    }))
  },

  // video (with urlBase)
  {
    weight: 4, arbitrary: fc.tuple(
      miniArb(VIDEOS, 2),
      videoChain,
    ).map(([pat, chain]) => ({
      code: `video("${pat}").urlBase('/test-assets/')${chain}`,
    }))
  },

  // video (via registry name, no urlBase)
  {
    weight: 2, arbitrary: fc.tuple(
      miniArb(VIDEO_REGISTRY_NAMES, 2),
      videoChain,
    ).map(([pat, chain]) => ({
      code: `video("${pat}")${chain}`,
    }))
  },

  // s() / screen() — auto-detecting, mixed token pool, shared methods
  {
    weight: 3, arbitrary: fc.tuple(
      miniArb(SCREEN_TOKENS, 1),
      fc.array(sharedMethod, { minLength: 0, maxLength: 3 }),
      fc.boolean(),
    ).map(([pat, methods, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}("${pat}")${methods.map(m => m.code).join("")}`,
    }))
  },

  // s() / screen() — with video methods (any method valid on any source)
  {
    weight: 1, arbitrary: fc.tuple(
      miniArb(SCREEN_TOKENS, 1),
      videoChain,
      fc.boolean(),
    ).map(([pat, chain, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}("${pat}")${chain}`,
    }))
  },

  // s() / screen() — extension-based tokens, urlBase to reach test assets
  {
    weight: 2, arbitrary: fc.tuple(
      miniArb(SCREEN_EXT_TOKENS, 1),
      fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
      fc.boolean(),
    ).map(([pat, methods, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}("${pat}").urlBase('/test-assets/')${methods.map(m => m.code).join("")}`,
    }))
  },

  // s() / screen() — inline begin/end offsets via colon syntax: "vid:.2:.7"
  {
    weight: 2, arbitrary: fc.tuple(
      fc.tuple(
        fc.constantFrom(...VIDEO_REGISTRY_NAMES, "red.mp4", "blue.mp4"),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
      ).map(([t, b, e]) => `${t}:${b.toFixed(2)}:${e.toFixed(2)}`),
      fc.array(videoMethod, { minLength: 0, maxLength: 2 }),
      fc.boolean(),
    ).map(([tok, methods, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}("${tok}")${methods.map(m => m.code).join("")}`,
    }))
  },

  // s() / screen() — inline begin only: "vid:.3"
  {
    weight: 1, arbitrary: fc.tuple(
      fc.tuple(
        fc.constantFrom(...VIDEO_REGISTRY_NAMES, "red.mp4", "blue.mp4"),
        fc.double({ min: 0, max: 0.9, noNaN: true }),
      ).map(([t, b]) => `${t}:${b.toFixed(2)}`),
      fc.array(videoMethod, { minLength: 0, maxLength: 2 }),
      fc.boolean(),
    ).map(([tok, methods, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}("${tok}")${methods.map(m => m.code).join("")}`,
    }))
  },

  // s() / screen() — wrapping an already-typed pattern
  {
    weight: 2, arbitrary: fc.tuple(
      fc.oneof(
        miniArb(VIDEO_REGISTRY_NAMES, 1).map(p => `video("${p}")`),
        miniArb(IMAGE_REGISTRY_NAMES, 1).map(p => `image("${p}")`),
        miniArb(COLORS, 1).map(p => `color("${p}")`),
      ),
      fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
      fc.boolean(),
    ).map(([inner, methods, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}(${inner})${methods.map(m => m.code).join("")}`,
    }))
  },

  // text() — single-quoted string
  {
    weight: 2, arbitrary: fc.tuple(
      fc.constantFrom(...TEXT_STRINGS),
      fc.array(sharedMethod, { minLength: 0, maxLength: 3 }),
    ).map(([str, methods]) => ({
      code: `text('${str}')${methods.map(m => m.code).join("")}`,
    }))
  },

  // s("text:token") — underscore-separated token
  {
    weight: 1, arbitrary: fc.tuple(
      fc.constantFrom(...TEXT_TOKENS),
      fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
      fc.boolean(),
    ).map(([tok, methods, useAlias]) => ({
      code: `${useAlias ? "s" : "screen"}('text:${tok}')${methods.map(m => m.code).join("")}`,
    }))
  },
);

// ============================================================
// Top-level expression arbitrary
// ============================================================

/** CPS value — numeric or patterned. */
const cpsValue: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constant("setCps(0)") },
  { weight: 1, arbitrary: fc.double({ min: 0.01, max: 0.5, noNaN: true }).map(v => `setCps(${v.toFixed(1)})`) },
  { weight: 3, arbitrary: fc.double({ min: 0.5, max: 2, noNaN: true }).map(v => `setCps(${v.toFixed(1)})`) },
  { weight: 8, arbitrary: fc.double({ min: 2, max: 10, noNaN: true }).map(v => `setCps(${v.toFixed(1)})`) },
  { weight: 1, arbitrary: fc.double({ min: 10, max: 1000, noNaN: true }).map(v => `setCps(${v.toFixed(1)})`) },
  { weight: 3, arbitrary: fc.double({ min: 0.5, max: 2, noNaN: true }).map(v => `setCpm(${(v * 60).toFixed(1)})`) },
  {
    weight: 2, arbitrary: fc.tuple(
      fc.constantFrom(...CONTINUOUS_SIGNALS),
      fc.double({ min: 0.1, max: 4, noNaN: true }),
      fc.double({ min: 0.5, max: 8, noNaN: true }),
    ).map(([sig, lo, hi]) => `setCps(${sig}.range(${lo.toFixed(2)}, ${hi.toFixed(2)}))`)
  },
);

/** Grid method chain applied after gridMod. */
const gridChain: fc.Arbitrary<string> = fc.array(
  fc.oneof(
    alphaArg.map(a => `.alpha(${a})`),
    scaleArg.map(a => `.scale(${a})`),
  ),
  { minLength: 0, maxLength: 2 },
).map(ms => ms.join(""));

/** Optional loadVideo/loadImage preamble lines. */
const loadPreamble: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constant("") },
  {
    weight: 1, arbitrary: fc.tuple(
      fc.constantFrom(...VIDEO_REGISTRY_NAMES),
      fc.constantFrom(...VIDEOS),
    ).map(([name, file]) => `loadVideo('${name}', '/test-assets/${file}')`)
  },
  {
    weight: 1, arbitrary: fc.tuple(
      fc.constantFrom(...IMAGE_REGISTRY_NAMES),
      fc.constantFrom(...IMAGES),
    ).map(([name, file]) => `loadImage('${name}', '/test-assets/${file}')`)
  },
);

/** Label prefix: $, named, _muted, or Ssolo. */
const labelPrefix: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constant("$") },
  { weight: 2, arbitrary: fc.constantFrom("bg", "fg", "main", "overlay") },
  { weight: 1, arbitrary: fc.constantFrom("_bg", "_fg", "muted_") },
  { weight: 1, arbitrary: fc.constantFrom("Sbg", "Sfg") },
);

/** Full top-level expression using label: syntax. */
export const topExpr: fc.Arbitrary<GeneratedExpr> = fc.oneof(
  // index + cols/rows + gridMod expression
  {
    weight: 4, arbitrary: fc.tuple(
      loadPreamble,
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 1, maxLength: 4 }),
      fc.integer({ min: 2, max: 5 }),
      fc.integer({ min: 2, max: 5 }),
      gridChain,
      labelPrefix,
    ).map(([load, cps, children, cols, rows, chain, label]) => {
      const preamble = [load, cps].filter(Boolean).join("\n");
      const childrenCode = children.map((c: any) => c.code).join(", ");
      return {
        code: `${preamble ? preamble + "\n" : ""}${label}: index(${childrenCode}).cols(${cols}).rows(${rows}).gridMod()${chain}`,
      };
    })
  },

  // indexNow + rowscols + gridMod expression
  {
    weight: 3, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 1, maxLength: 4 }),
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, children, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const childrenCode = children.map((c: any) => c.code).join(", ");
      return {
        code: `${cpsCode}${label}: index(${childrenCode}).rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // index + rowscols + gridMod expression
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 1, maxLength: 4 }),
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, children, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const childrenCode = children.map((c: any) => c.code).join(", ");
      return {
        code: `${cpsCode}${label}: index(${childrenCode}).rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // Standalone screen expression
  {
    weight: 3, arbitrary: fc.tuple(
      loadPreamble,
      fc.option(cpsValue, { nil: undefined }),
      screenExpr,
      labelPrefix,
    ).map(([load, cps, screen, label]) => {
      const preamble = [load, cps].filter(Boolean).join("\n");
      return {
        code: `${preamble ? preamble + "\n" : ""}${label}: ${screen.code}`,
      };
    })
  },

  // stackN expression — n copies of a single pattern, each decorrelated
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      screenExpr,
      fc.integer({ min: 2, max: 4 }),
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, child, n, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      return {
        code: `${cpsCode}${label}: stackN(${n}, ${child.code}).rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // Multiple layered $: lines
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(fc.tuple(screenExpr, labelPrefix), { minLength: 2, maxLength: 4 }),
    ).map(([cps, lines]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const lineCode = lines.map(([screen, label]) => `${label}: ${screen.code}`).join("\n");
      return {
        code: `${cpsCode}${lineCode}`,
      };
    })
  },

  // shuffleStack + index + gridMod — shuffled grid layout
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 2, maxLength: 4 }),
      shuffleSeed,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, children, seed, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const childrenCode = children.map((c: any) => c.code).join(", ");
      const seedArg = seed ? `(${seed})` : "()";
      return {
        code: `${cpsCode}${label}: stack(${childrenCode}).shuffleStack${seedArg}.index().rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // shuffleStackCycle + indexCycle + gridMod
  {
    weight: 1, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 2, maxLength: 4 }),
      shuffleSeed,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, children, seed, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const childrenCode = children.map((c: any) => c.code).join(", ");
      const seedArg = seed ? `(${seed})` : "()";
      return {
        code: `${cpsCode}${label}: stack(${childrenCode}).shuffleStackCycle${seedArg}.indexCycle().rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // shuffleIndex + gridMod — shuffled cell assignment without reordering
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 2, maxLength: 4 }),
      shuffleSeed,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, children, seed, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const childrenCode = children.map((c: any) => c.code).join(", ");
      const seedArg = seed ? `(${seed})` : "()";
      return {
        code: `${cpsCode}${label}: stack(${childrenCode}).shuffleIndex${seedArg}.rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // shuffleIndexCycle + gridMod
  {
    weight: 1, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 2, maxLength: 4 }),
      shuffleSeed,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, children, seed, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const childrenCode = children.map((c: any) => c.code).join(", ");
      const seedArg = seed ? `(${seed})` : "()";
      return {
        code: `${cpsCode}${label}: stack(${childrenCode}).shuffleIndexCycle${seedArg}.rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // chopStack + gridMod
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      screenExpr,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, child, n, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const cols = Math.ceil(Math.sqrt(n));
      return {
        code: `${cpsCode}${label}: ${child.code}.chopStack(${n}).rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // syncStack + gridMod
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      screenExpr,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, child, n, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const cols = Math.ceil(Math.sqrt(n));
      return {
        code: `${cpsCode}${label}: ${child.code}.syncStack(${n}).rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // cropStack + gridMod (reassembles source frame)
  {
    weight: 2, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      screenExpr,
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      gridChain,
      labelPrefix,
    ).map(([cps, child, rows, cols, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      return {
        code: `${cpsCode}${label}: ${child.code}.cropStack(${rows}, ${cols}).gridMod()${chain}`,
      };
    })
  },

  // chopStack + fit + gridMod
  {
    weight: 1, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      screenExpr,
      fc.integer({ min: 2, max: 4 }),
      gridChain,
      labelPrefix,
    ).map(([cps, child, n, chain, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      const cols = Math.ceil(Math.sqrt(n));
      return {
        code: `${cpsCode}${label}: ${child.code}.chopStack(${n}).fit().rowscols(${cols}).gridMod()${chain}`,
      };
    })
  },

  // stepcat with 2–3 screen sources
  {
    weight: 1, arbitrary: fc.tuple(
      fc.option(cpsValue, { nil: undefined }),
      fc.array(screenExpr, { minLength: 2, maxLength: 3 }),
      labelPrefix,
    ).map(([cps, exprs, label]) => {
      const cpsCode = cps !== undefined ? `${cps}\n` : "";
      return {
        code: `${cpsCode}${label}: stepcat(${exprs.map((e: any) => e.code).join(", ")})`,
      };
    })
  },

  // stackLeft / stackRight / stackCentre — omitted: Strudel upstream crashes on
  // polymeter ({x}) and zero-duration clips trigger .eq / .maximum on undefined.

);

// ============================================================
// Mixed-case variant — exercises transpiler case normalisation
// ============================================================

/**
 * Apply random case to each character of an identifier using a bit array.
 * String literals (matched by the outer regex) are left unchanged.
 */
function randomizeCaseFull(name: string, bits: boolean[]): string {
  return name.split("").map((c, i) => (bits[i % bits.length] ? c.toUpperCase() : c.toLowerCase())).join("");
}

// Matches quoted strings OR bare identifiers — strings are skipped, identifiers are mutated.
const MIXED_CASE_TOKEN_RE = /(["'`])(?:[^\\]|\\.)*?\1|([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

/**
 * Variant of topExpr where API identifiers have randomly mixed case.
 * Exercises the transpiler's identifier case-normalisation pass end-to-end.
 */
export const topExprMixedCase: fc.Arbitrary<GeneratedExpr> = fc.tuple(
  topExpr,
  fc.array(fc.boolean(), { minLength: 32, maxLength: 32 }),
).map(([expr, bits]) => {
  const code = expr.code.replace(MIXED_CASE_TOKEN_RE, (match, _quote, ident) => {
    if (ident) return randomizeCaseFull(ident, bits);
    return match; // string literal — leave unchanged
  });
  return { code };
});
