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

export const COLORS = [
  "red", "green", "blue", "yellow", "cyan", "magenta",
  "purple", "orange", "white", "black", "pink",
  "#ff0000", "#00ff00", "#0000ff", "#fff", "#000",
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

const FIT_MODES = ["cover", "contain", "fill", "none"];

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
export function miniArb(pool: string[], maxDepth = 2): fc.Arbitrary<string> {
  const atom = fc.constantFrom(...pool);

  // Build recursive grammar
  const { expr } = fc.letrec(tie => ({
    // A single slice: atom, sub-cycle, slow-sequence, polymeter, or rest
    slice: fc.oneof(
      { weight: 6, arbitrary: atom },
      { weight: 1, arbitrary: fc.constant("~") },
      { weight: 2, arbitrary: tie("seq").map(s => `[${s}]`) },
      { weight: 1, arbitrary: tie("seq").map(s => `<${s}>`) },
      { weight: 1, arbitrary: fc.tuple(
        tie("seq"),
        fc.option(fc.integer({ min: 2, max: 5 }), { nil: undefined }),
      ).map(([s, pct]) => pct !== undefined ? `{${s}}%${pct}` : `{${s}}`) },
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

  return expr.filter(s => s.length > 0 && s.length < 200);
}

// ============================================================
// Signal & argument arbitraries
// ============================================================

/** Continuous signal with optional modifiers and easing — no time conversion, returns numbers. */
const continuousSignal: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom(...CONTINUOUS_SIGNALS),
  fc.oneof(
    { weight: 5, arbitrary: fc.constant("") },
    { weight: 2, arbitrary: fc.tuple(
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 2, noNaN: true }),
    ).map(([lo, hi]) => `.range(${lo.toFixed(2)}, ${hi.toFixed(2)})`) },
    { weight: 1, arbitrary: fc.constantFrom(2, 3, 4, 8).map(n => `.div(${n})`) },
  ),
  fc.oneof(
    { weight: 5, arbitrary: fc.constant("") },
    { weight: 2, arbitrary: fc.tuple(
      fc.oneof(
        fc.constantFrom(...EASING_CURVES).map(c => `'${c}'`),
        miniArb(EASING_CURVES, 1).map(m => `"${m}"`),
      ),
      fc.oneof(
        fc.constantFrom(...EASING_DIRS).map(d => `'${d}'`),
        miniArb(EASING_DIRS, 1).map(m => `"${m}"`),
      ),
    ).map(([c, d]) => `.lerp(${c}, ${d})`) },
    { weight: 1, arbitrary: fc.oneof(
      fc.double({ min: 0.1, max: 1.0, noNaN: true }).map(n => `.spline(${n.toFixed(2)})`),
      miniArb(["0.1", "0.3", "0.5", "0.8", "1"], 1).map(m => `.spline("${m}")`),
    ) },
  ),
).map(([sig, mod, easing]) => sig + mod + easing);

/** Continuous signal with optional time conversion — returns TimeValue strings. */
const continuousTimeSignal: fc.Arbitrary<string> = fc.tuple(
  continuousSignal,
  fc.oneof(
    { weight: 7, arbitrary: fc.constant("") },
    { weight: 1, arbitrary: fc.constant(".sec()") },
    { weight: 1, arbitrary: fc.constant(".ms()") },
  ),
).map(([sig, time]) => sig + time);

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
);

/** Numeric signal expression with optional time conversion — for time args. */
const numericSignalExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: continuousTimeSignal },
  { weight: 2, arbitrary: fc.constantFrom(...DISCRETE_NUMERIC_SIGNALS) },
  { weight: 2, arbitrary: numericSignalFunction },
);

/** Any signal expression (may include booleans — use for speed). */
const anySignalExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: continuousSignal },
  { weight: 1, arbitrary: fc.constantFrom(...DISCRETE_NUMERIC_SIGNALS, ...DISCRETE_BOOLEAN_SIGNALS) },
  { weight: 2, arbitrary: numericSignalFunction },
  { weight: 1, arbitrary: fc.double({ min: 0.1, max: 0.9, noNaN: true }).map(n => `brandBy(${n.toFixed(2)})`) },
);

/** Time value: relative, seconds, milliseconds */
const timeValue: fc.Arbitrary<string> = fc.oneof(
  fc.double({ min: 0, max: 0.9, noNaN: true }).map(n => n.toFixed(2)),
  fc.double({ min: 0, max: 10, noNaN: true }).map(n => `${n.toFixed(1)}s`),
  fc.double({ min: 0, max: 10, noNaN: true }).map(n => `${n.toFixed(1)}sec`),
  fc.integer({ min: 100, max: 5000 }).map(n => `${n}ms`),
  fc.integer({ min: 100, max: 5000 }).map(n => `${n}millis`),
);

const timeMiniPool: fc.Arbitrary<string[]> = fc.array(timeValue, { minLength: 3, maxLength: 6 });

/** Time argument: either a signal or quoted mininotation of time values. */
const timeArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: numericSignalExpr },
  { weight: 7, arbitrary: timeMiniPool.chain(pool => miniArb(pool, 1).map(m => `"${m}"`)) },
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

/** Scale argument. */
const scaleArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: continuousSignal },
  { weight: 6, arbitrary: miniArb(["0.5", "1", "1.5", "2", "-1", "0.25", "3"], 1).map(m => `"${m}"`) },
);

/** Position argument. */
const posArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: continuousSignal },
  { weight: 7, arbitrary: miniArb(["0", "0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
);

/** Dimension argument. */
const dimArg: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: continuousSignal },
  { weight: 7, arbitrary: miniArb(["0.25", "0.5", "0.75", "1"], 1).map(m => `"${m}"`) },
);

// ============================================================
// Strudel pattern method arbitraries
// ============================================================

/** Strudel methods that work on any pattern. */
const strudelMethod: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 2, max: 8 }).map(n => `.slow(${n})`),
  fc.integer({ min: 2, max: 8 }).map(n => `.fast(${n})`),
  fc.constant(".rev()"),
  fc.integer({ min: 2, max: 5 }).map(n => `.every(${n}, x => x.fast(2))`),
  fc.integer({ min: 2, max: 5 }).map(n => `.every(${n}, x => x.rev())`),
);

// ============================================================
// Method chain arbitraries
// ============================================================

interface MethodCall { code: string }

const videoMethod: fc.Arbitrary<MethodCall> = fc.oneof(
  speedArg.map(a => ({ code: `.speed(${a})` })),
  timeArg.map(a => ({ code: `.start(${a})` })),
  timeArg.map(a => ({ code: `.end(${a})` })),
  timeArg.map(a => ({ code: `.duration(${a})` })),
  timeArg.map(a => ({ code: `.dur(${a})` })),
  timeArg.map(a => ({ code: `.scrub(${a})` })),
  fc.constant({ code: `.speed(0)` }),
  fc.constantFrom(...SPEED_LITERALS).map(n => ({ code: `.speed(${n})` })),
  alphaArg.map(a => ({ code: `.alpha(${a})` })),
  alphaArg.map(a => ({ code: `.opacity(${a})` })),
  fc.constantFrom(...FIT_MODES).map(m => ({ code: `.fit("${m}")` })),
  scaleArg.map(a => ({ code: `.scaleX(${a})` })),
  scaleArg.map(a => ({ code: `.scaleY(${a})` })),
  scaleArg.map(a => ({ code: `.scale(${a})` })),
);

const videoChain: fc.Arbitrary<string> = fc.array(videoMethod, { minLength: 0, maxLength: 5 })
  .map(ms => ms.map(m => m.code).join(""));

const sharedMethod: fc.Arbitrary<MethodCall> = fc.oneof(
  alphaArg.map(a => ({ code: `.alpha(${a})` })),
  alphaArg.map(a => ({ code: `.opacity(${a})` })),
  fc.constantFrom(...FIT_MODES).map(m => ({ code: `.fit("${m}")` })),
  scaleArg.map(a => ({ code: `.scaleX(${a})` })),
  scaleArg.map(a => ({ code: `.scaleY(${a})` })),
  scaleArg.map(a => ({ code: `.scale(${a})` })),
  posArg.map(a => ({ code: `.x(${a})` })),
  posArg.map(a => ({ code: `.y(${a})` })),
  posArg.map(a => ({ code: `.left(${a})` })),
  posArg.map(a => ({ code: `.top(${a})` })),
  dimArg.map(a => ({ code: `.width(${a})` })),
  dimArg.map(a => ({ code: `.height(${a})` })),
  dimArg.map(a => ({ code: `.w(${a})` })),
  dimArg.map(a => ({ code: `.h(${a})` })),
  fc.tuple(
    fc.integer({ min: 0, max: 8 }),
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 1, max: 4 }),
  ).map(([i, c, r]) => ({ code: `.grid(${i}, ${c}, ${r})` })),
  strudelMethod.map(code => ({ code })),
);

// ============================================================
// Screen expression arbitraries
// ============================================================

export interface GeneratedExpr {
  code: string;
}

/** A single screen expression (color, video, or image) without .out(). */
export const screenExpr: fc.Arbitrary<GeneratedExpr> = fc.oneof(
  // color
  { weight: 3, arbitrary: fc.tuple(
    miniArb(COLORS, 2),
    fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
  ).map(([pat, methods]) => ({
    code: `color("${pat}")${methods.map(m => m.code).join("")}`,
  })) },

  // color via explicit mini()
  { weight: 1, arbitrary: fc.tuple(
    miniArb(COLORS, 2),
    fc.array(sharedMethod, { minLength: 0, maxLength: 2 }),
  ).map(([pat, methods]) => ({
    code: `color(mini("${pat}"))${methods.map(m => m.code).join("")}`,
  })) },

  // image
  { weight: 2, arbitrary: fc.tuple(
    miniArb(IMAGES, 1),
    fc.array(sharedMethod, { minLength: 0, maxLength: 4 }),
  ).map(([pat, methods]) => ({
    code: `image("${pat}").urlBase('/test-assets/')${methods.map(m => m.code).join("")}`,
  })) },

  // video
  { weight: 5, arbitrary: fc.tuple(
    miniArb(VIDEOS, 2),
    videoChain,
  ).map(([pat, chain]) => ({
    code: `video("${pat}").urlBase('/test-assets/')${chain}`,
  })) },
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
  { weight: 2, arbitrary: fc.tuple(
    fc.constantFrom(...CONTINUOUS_SIGNALS),
    fc.double({ min: 0.1, max: 4, noNaN: true }),
    fc.double({ min: 0.5, max: 8, noNaN: true }),
  ).map(([sig, lo, hi]) => `setCps(${sig}.range(${lo.toFixed(2)}, ${hi.toFixed(2)}))`) },
);

/** Grid method chain applied after gridStack/four/grid. */
const gridChain: fc.Arbitrary<string> = fc.array(
  fc.oneof(
    alphaArg.map(a => `.alpha(${a})`),
    scaleArg.map(a => `.scale(${a})`),
  ),
  { minLength: 0, maxLength: 2 },
).map(ms => ms.join(""));

/** Label prefix: $, named, _muted, or Ssolo. */
const labelPrefix: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constant("$") },
  { weight: 2, arbitrary: fc.constantFrom("bg", "fg", "main", "overlay") },
  { weight: 1, arbitrary: fc.constantFrom("_bg", "_fg", "muted_") },
  { weight: 1, arbitrary: fc.constantFrom("Sbg", "Sfg") },
);

/** Full top-level expression using label: syntax. */
export const topExpr: fc.Arbitrary<GeneratedExpr> = fc.oneof(
  // Grid expression (gridStack / four)
  { weight: 5, arbitrary: fc.tuple(
    fc.option(cpsValue, { nil: undefined }),
    fc.array(screenExpr, { minLength: 1, maxLength: 4 }),
    fc.integer({ min: 2, max: 5 }),
    fc.integer({ min: 2, max: 5 }),
    gridChain,
    fc.constantFrom("gridStack", "four"),
    labelPrefix,
  ).map(([cps, children, cols, rows, chain, variant, label]) => {
    const cpsCode = cps !== undefined ? `${cps}\n` : "";
    const childrenCode = children.map(c => c.code).join(", ");
    let expr: string;
    if (variant === "four") {
      expr = `four([${childrenCode}])`;
    } else {
      expr = `gridStack([${childrenCode}], ${cols}, ${rows})`;
    }

    return {
      code: `${cpsCode}${label}: ${expr}${chain}`,
    };
  }) },

  // Standalone screen expression
  { weight: 3, arbitrary: fc.tuple(
    fc.option(cpsValue, { nil: undefined }),
    screenExpr,
    labelPrefix,
  ).map(([cps, screen, label]) => {
    const cpsCode = cps !== undefined ? `${cps}\n` : "";
    return {
      code: `${cpsCode}${label}: ${screen.code}`,
    };
  }) },

  // Multiple layered $: lines
  { weight: 2, arbitrary: fc.tuple(
    fc.option(cpsValue, { nil: undefined }),
    fc.array(fc.tuple(screenExpr, labelPrefix), { minLength: 2, maxLength: 4 }),
  ).map(([cps, lines]) => {
    const cpsCode = cps !== undefined ? `${cps}\n` : "";
    const lineCode = lines.map(([screen, label]) => `${label}: ${screen.code}`).join("\n");
    return {
      code: `${cpsCode}${lineCode}`,
    };
  }) },
);
