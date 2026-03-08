import {
  Hap, Pattern as CorePattern,
} from "@strudel/core";
import { PatternProto } from "./pattern-proto";

// unit helpers: tag pattern values so parseTimeValue interprets them as seconds/ms
PatternProto.sec = function () { return this.fmap((v: number) => v + "sec"); };
PatternProto.ms = function () { return this.fmap((v: number) => v + "ms"); };

// --- easing functions (Robert Penner's standard set) ---

const easings: Record<string, Record<string, (t: number) => number>> = {
  linear: {
    in: (t) => t,
    out: (t) => t,
    inout: (t) => t,
  },
  sine: {
    in: (t) => 1 - Math.cos((t * Math.PI) / 2),
    out: (t) => Math.sin((t * Math.PI) / 2),
    inout: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  },
  quad: {
    in: (t) => t * t,
    out: (t) => 1 - (1 - t) * (1 - t),
    inout: (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  },
  cubic: {
    in: (t) => t ** 3,
    out: (t) => 1 - (1 - t) ** 3,
    inout: (t) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  },
  quart: {
    in: (t) => t ** 4,
    out: (t) => 1 - (1 - t) ** 4,
    inout: (t) => t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2,
  },
  quint: {
    in: (t) => t ** 5,
    out: (t) => 1 - (1 - t) ** 5,
    inout: (t) => t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2,
  },
  expo: {
    in: (t) => t === 0 ? 0 : 2 ** (10 * t - 10),
    out: (t) => t === 1 ? 1 : 1 - 2 ** (-10 * t),
    inout: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  },
  circ: {
    in: (t) => 1 - Math.sqrt(1 - t * t),
    out: (t) => Math.sqrt(1 - (t - 1) ** 2),
    inout: (t) => t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2,
  },
  elastic: {
    in: (t) => t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3),
    out: (t) => t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
    inout: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / 4.5)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / 4.5)) / 2 + 1,
  },
  bounce: {
    out: (t) => {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
      if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },
    in: (t) => 1 - easings.bounce.out(1 - t),
    inout: (t) => t < 0.5 ? (1 - easings.bounce.out(1 - 2 * t)) / 2 : (1 + easings.bounce.out(2 * t - 1)) / 2,
  },
  back: {
    in: (t) => 2.70158 * t ** 3 - 1.70158 * t * t,
    out: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    inout: (t) => {
      const c = 1.70158 * 1.525;
      return t < 0.5
        ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2
        : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
    },
  },
};

function getEase(curve: string, direction: string): (t: number) => number {
  const c = easings[curve];
  if (!c) throw new Error(`Unknown easing curve: "${curve}". Available: ${Object.keys(easings).join(", ")}`);
  const fn = c[direction];
  if (!fn) throw new Error(`Unknown easing direction: "${direction}". Available: in, out, inout`);
  return fn;
}

// --- shared: collect sorted events with numeric values from a source pattern ---

interface NumEvent { begin: number; end: number; value: number }

function collectEvents(src: any, t: number, padding = 1): NumEvent[] {
  const cycle = Math.floor(t);
  const evs = src.queryArc(cycle - padding, cycle + 1 + padding);
  const result: NumEvent[] = [];
  for (const ev of evs) {
    if (ev.whole) {
      result.push({
        begin: Number(ev.whole.begin),
        end: Number(ev.whole.end),
        value: Number(ev.value),
      });
    }
  }
  // deduplicate by begin time (queryArc can return overlapping cycles)
  result.sort((a, b) => a.begin - b.begin);
  const deduped: NumEvent[] = [];
  for (const ev of result) {
    if (!deduped.length || Math.abs(ev.begin - deduped[deduped.length - 1].begin) > 0.0001) {
      deduped.push(ev);
    }
  }
  return deduped;
}

function findCurrentIndex(evs: NumEvent[], t: number): number {
  for (let i = evs.length - 1; i >= 0; i--) {
    if (evs[i].begin <= t + 0.0001) return i;
  }
  return 0;
}

// --- .lerp() — eased interpolation between discrete pattern values ---

PatternProto.lerp = function (curve = "linear", direction = "inout") {
  const src = this;
  const ease = getEase(curve, direction);
  return new CorePattern((state: any) => {
    const t = Number(state.span.begin);
    const evs = collectEvents(src, t);
    if (!evs.length) return [];

    const i = findCurrentIndex(evs, t);
    const cur = evs[i];
    const next = evs[i + 1] ?? cur;

    const span = cur.end - cur.begin;
    const frac = span > 0 ? (t - cur.begin) / span : 0;
    const val = cur.value + (next.value - cur.value) * ease(frac);
    return [new Hap(undefined, state.span, val)];
  });
};

// --- .spline() — Catmull-Rom spline interpolation between discrete pattern values ---
// Optional tension parameter (default 0.5, where 0 = sharp, 1 = very smooth)

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number, tension: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = tension * (p2 - p0);
  const m2 = tension * (p3 - p1);
  return (2 * t3 - 3 * t2 + 1) * p1
       + (t3 - 2 * t2 + t) * m1
       + (-2 * t3 + 3 * t2) * p2
       + (t3 - t2) * m2;
}

PatternProto.spline = function (tension = 0.5) {
  const src = this;
  return new CorePattern((state: any) => {
    const t = Number(state.span.begin);
    const evs = collectEvents(src, t);
    if (!evs.length) return [];

    const i = findCurrentIndex(evs, t);
    const cur = evs[i];

    // clamp indices for the 4 control points
    const prev = evs[Math.max(0, i - 1)];
    const next = evs[Math.min(evs.length - 1, i + 1)];
    const next2 = evs[Math.min(evs.length - 1, i + 2)];

    const span = cur.end - cur.begin;
    const frac = span > 0 ? (t - cur.begin) / span : 0;
    const val = catmullRom(prev.value, cur.value, next.value, next2.value, frac, tension);
    return [new Hap(undefined, state.span, val)];
  });
};
