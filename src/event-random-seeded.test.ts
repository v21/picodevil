/**
 * Seeded structural randomness: degradeBy / sometimes / etc. must honour the
 * per-hap `_randSeed` that picodevil's stacking ops (shuffleIndex, index, …)
 * stamp on each tile — so a probabilistic transform applies INDEPENDENTLY to
 * each co-active (stacked) video, instead of all-or-none across the stack.
 *
 * Events WITHOUT a `_randSeed` must keep vanilla Strudel behaviour (one shared
 * time-based coin flip for co-active events).
 */
import { describe, it, expect } from "vitest";
import { s } from "./screen-pattern";
import { color } from "./color-pattern";
import { rand } from "./event-random";
import "./visual-controls";
import "./shuffle-stack";
import "./pattern-extensions";
import "./index-patterns";
import "./grid-stack";

const SRC = "a,b,c,d,e,f,g"; // 7 co-active tiles

// flags[i] = 1 if tile i had `key` set to `match`
function flagsAt(pat: any, t: number, key = "speed", match = -1): number[] {
  return pat.queryArc(t, t).map((e: any) => (e.value?.[key] === match ? 1 : 0));
}
function isMixed(flags: number[]): boolean {
  return flags.some((v) => v === 1) && flags.some((v) => v === 0);
}

describe("seeded sometimes() decorrelates across stacked tiles", () => {
  it("WITH shuffleIndex: applies independently per tile (mixed cycles appear)", () => {
    const pat = (s(SRC) as any)
      .shuffleIndex(rand.segment(1))
      .sometimes((x: any) => x.speed(-1));
    let mixed = 0;
    for (let cyc = 0; cyc < 16; cyc++) if (isMixed(flagsAt(pat, cyc + 0.01))) mixed++;
    // With 7 tiles @ p=0.5, all-same has prob ~1.6%/cycle — over 16 cycles we
    // should see plenty of mixed cycles. Require a strong majority.
    expect(mixed).toBeGreaterThanOrEqual(10);
  });

  it("WITHOUT shuffleIndex: stays vanilla all-or-none (no _randSeed)", () => {
    const pat = (s(SRC) as any).sometimes((x: any) => x.speed(-1));
    let mixed = 0;
    for (let cyc = 0; cyc < 16; cyc++) if (isMixed(flagsAt(pat, cyc + 0.01))) mixed++;
    expect(mixed).toBe(0);
  });

  it("sometimes keeps ALL tiles (transforms some, drops none)", () => {
    const pat = (s(SRC) as any).shuffleIndex(rand.segment(1)).sometimes((x: any) => x.speed(-1));
    for (let cyc = 0; cyc < 8; cyc++) {
      expect(pat.queryArc(cyc + 0.01, cyc + 0.01).length).toBe(7);
    }
  });

  it("is deterministic — same query twice yields identical flags", () => {
    const pat = (s(SRC) as any).shuffleIndex(rand.segment(1)).sometimes((x: any) => x.speed(-1));
    expect(flagsAt(pat, 3.01)).toEqual(flagsAt(pat, 3.01));
  });

  it("roughly hits the requested probability across tiles×cycles", () => {
    const pat = (s(SRC) as any).shuffleIndex(rand.segment(1)).sometimesBy(0.5, (x: any) => x.speed(-1));
    let on = 0, total = 0;
    for (let cyc = 0; cyc < 40; cyc++) {
      const f = flagsAt(pat, cyc + 0.01);
      on += f.reduce((a, b) => a + b, 0);
      total += f.length;
    }
    const frac = on / total;
    expect(frac).toBeGreaterThan(0.35);
    expect(frac).toBeLessThan(0.65);
  });
});

describe("seeded degradeBy() decorrelates across stacked tiles", () => {
  it("WITH shuffleIndex: surviving count varies (not 0/all every cycle)", () => {
    const pat = (s(SRC) as any).shuffleIndex(rand.segment(1)).degradeBy(0.5);
    const counts = new Set<number>();
    for (let cyc = 0; cyc < 16; cyc++) counts.add(pat.queryArc(cyc + 0.01, cyc + 0.01).length);
    // decorrelated → we should see intermediate survivor counts, not just {0,7}
    const intermediate = [...counts].some((c) => c > 0 && c < 7);
    expect(intermediate).toBe(true);
  });

  it("WITHOUT shuffleIndex: all-or-none survivors (0 or 7)", () => {
    const pat = (s(SRC) as any).degradeBy(0.5);
    for (let cyc = 0; cyc < 16; cyc++) {
      const n = pat.queryArc(cyc + 0.01, cyc + 0.01).length;
      expect(n === 0 || n === 7).toBe(true);
    }
  });
});

// ─── Stack (draw) order preservation ────────────────────────────────────────
//
// sometimes/someCyclesBy are stack(unchanged, func(transformed)) under the hood,
// which concatenates the two partitions and so reorders co-active events. In a
// visual tool draw order = stack order (last drawn is on top), so a multiply
// overlay stacked over content must STAY on top even when the partition splits
// the two layers. The family must preserve the original stack order.

describe("sometimes/someCycles preserve stack (draw) order", () => {
  // video carries a _randSeed (from shuffleIndex); the scan overlay stacked
  // afterwards does not — so they get independent coin flips and can land in
  // different partitions. The scan must always remain the last-drawn (top) layer.
  function build(transform: (p: any) => any) {
    const video = (color("VIDEO") as any).shuffleIndex(rand.segment(1));
    const scan = (color("scan") as any).blend("multiply").alpha(0.4);
    return transform(video.stack(scan));
  }
  function topLayerEachCycle(pat: any, n = 16): string[] {
    const tops: string[] = [];
    for (let cyc = 0; cyc < n; cyc++) {
      const haps = pat.queryArc(cyc + 0.01, cyc + 0.01);
      tops.push(haps[haps.length - 1]?.value.color);
    }
    return tops;
  }

  it("sometimes: overlay stays on top every cycle", () => {
    const pat = build((p) => p.sometimes((x: any) => x.cropw(-1)));
    expect(topLayerEachCycle(pat).every((t) => t === "scan")).toBe(true);
  });

  it("sometimesBy / often / rarely / someCycles: overlay stays on top", () => {
    for (const mk of [
      (p: any) => p.sometimesBy(0.5, (x: any) => x.cropw(-1)),
      (p: any) => p.often((x: any) => x.cropw(-1)),
      (p: any) => p.rarely((x: any) => x.cropw(-1)),
      (p: any) => p.someCycles((x: any) => x.cropw(-1)),
    ]) {
      const pat = build(mk);
      expect(topLayerEachCycle(pat).every((t) => t === "scan")).toBe(true);
    }
  });

  it("does not leak the internal _stackOrder tag into output values", () => {
    const pat = build((p) => p.sometimes((x: any) => x.cropw(-1)));
    for (let cyc = 0; cyc < 8; cyc++) {
      for (const h of pat.queryArc(cyc + 0.01, cyc + 0.01)) {
        expect("_stackOrder" in h.value).toBe(false);
      }
    }
  });

  it("still decorrelates per tile (order preservation didn't undo seeding)", () => {
    const pat = build((p) => p.sometimes((x: any) => x.speed(-1)));
    // across cycles the video and scan should disagree at least sometimes
    let disagree = 0;
    for (let cyc = 0; cyc < 16; cyc++) {
      const haps = pat.queryArc(cyc + 0.01, cyc + 0.01);
      const vid = haps.find((h: any) => h.value.color === "VIDEO")?.value.speed === -1;
      const scn = haps.find((h: any) => h.value.color === "scan")?.value.speed === -1;
      if (vid !== scn) disagree++;
    }
    expect(disagree).toBeGreaterThan(0);
  });
});
