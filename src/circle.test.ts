import { describe, it, expect } from "vitest";
import { stack } from "@strudel/core";
import { color } from "./color-pattern";
import { index } from "./index-patterns";
import "./visual-controls";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t + 0.001).map((e: any) => e.value);
}

function approx(a: number, b: number, tol = 1e-9) {
  return Math.abs(a - b) < tol;
}

function circleElementSize(n: number, r: number) {
  return 2 * r * Math.sin(Math.PI / Math.max(n, 2));
}

function circleX(i: number, circleCount: number, radius: number, startOffset: number, w: number) {
  const angle = Math.PI * 2 * (i / circleCount + startOffset) - Math.PI / 2;
  return 0.5 + radius * Math.cos(angle) - w / 2;
}
function circleY(i: number, circleCount: number, radius: number, startOffset: number, h: number) {
  const angle = Math.PI * 2 * (i / circleCount + startOffset) - Math.PI / 2;
  return 0.5 + radius * Math.sin(angle) - h / 2;
}

// ─── value setters ────────────────────────────────────────────────────────────

describe("circle value setters", () => {
  it(".radius() sets radius on event value", () => {
    const ev = queryAll(color("red").radius(0.4), 0.1)[0];
    expect(ev.radius).toBe(0.4);
  });

  it(".startOffset() sets startOffset", () => {
    const ev = queryAll(color("red").startOffset(0.25), 0.1)[0];
    expect(ev.startOffset).toBe(0.25);
  });

  it(".circleCount() sets circleCount", () => {
    const ev = queryAll(color("red").circleCount(6), 0.1)[0];
    expect(ev.circleCount).toBe(6);
  });
});

// ─── .circle() ───────────────────────────────────────────────────────────────

describe(".circle()", () => {
  it("places element at top of circle by default (i=0, circleCount=1)", () => {
    const pat = color("red").i(0).circleCount(1).circle(0.3);
    const ev = queryAll(pat, 0.1)[0];
    const s = circleElementSize(1, 0.3); // = 2*0.3 = 0.6
    expect(approx(ev.x, 0.5 - s / 2)).toBe(true);
    expect(approx(ev.y, 0.2 - s / 2)).toBe(true);
  });

  it("sets width and height from geometry (no-overlap sizing)", () => {
    const pat = color("red").i(0).circleCount(4).circle(0.4);
    const ev = queryAll(pat, 0.1)[0];
    const s = circleElementSize(4, 0.4);
    expect(approx(ev.width, s)).toBe(true);
    expect(approx(ev.height, s)).toBe(true);
  });

  it("places 4 elements evenly around a circle", () => {
    const pat = stack(
      color("red").i(0).circleCount(4).circle(0.4),
      color("blue").i(1).circleCount(4).circle(0.4),
      color("green").i(2).circleCount(4).circle(0.4),
      color("yellow").i(3).circleCount(4).circle(0.4),
    );
    const evs = queryAll(pat, 0.1);
    const s = circleElementSize(4, 0.4);
    for (const ev of evs) {
      const expected = {
        x: circleX(ev.i, 4, 0.4, 0, s),
        y: circleY(ev.i, 4, 0.4, 0, s),
      };
      expect(approx(ev.x, expected.x)).toBe(true);
      expect(approx(ev.y, expected.y)).toBe(true);
    }
  });

  it("startOffset rotates elements", () => {
    const pat0 = color("red").i(0).circleCount(4).circle(0.3, 0);
    const pat1 = color("red").i(0).circleCount(4).circle(0.3, 0.25);
    const ev0 = queryAll(pat0, 0.1)[0];
    const ev1 = queryAll(pat1, 0.1)[0];
    expect(ev0.x).not.toBeCloseTo(ev1.x, 5);
  });

  it("falls back to count when circleCount not set", () => {
    const pat = color("red").i(0).count(4).radius(0.3).startOffset(0).circle();
    const ev = queryAll(pat, 0.1)[0];
    const s = circleElementSize(4, 0.3);
    expect(approx(ev.x, circleX(0, 4, 0.3, 0, s))).toBe(true);
  });

  it("reads from value setters when args omitted", () => {
    const pat = color("red").i(1).radius(0.3).startOffset(0).circleCount(4).circle();
    const ev = queryAll(pat, 0.1)[0];
    const s = circleElementSize(4, 0.3);
    expect(approx(ev.x, circleX(1, 4, 0.3, 0, s))).toBe(true);
    expect(approx(ev.y, circleY(1, 4, 0.3, 0, s))).toBe(true);
  });

  it("uses event width/height to center element on circle point", () => {
    const pat = color("red").i(0).circleCount(1).width(0.4).height(0.4).circle(0.3);
    const ev = queryAll(pat, 0.1)[0];
    // cx=0.5, cy=0.2; centered: x=0.5-0.2=0.3, y=0.2-0.2=0
    expect(approx(ev.x, 0.5 - 0.4 / 2)).toBe(true);
    expect(approx(ev.y, 0.2 - 0.4 / 2)).toBe(true);
  });

  it("all args explicit: circle(radius, startOffset, circleCount, i)", () => {
    const pat = color("red").circle(0.3, 0, 4, 2);
    const ev = queryAll(pat, 0.1)[0];
    const s = circleElementSize(4, 0.3);
    expect(approx(ev.x, circleX(2, 4, 0.3, 0, s))).toBe(true);
    expect(approx(ev.y, circleY(2, 4, 0.3, 0, s))).toBe(true);
  });
});

// ─── .circleMod() ────────────────────────────────────────────────────────────

describe(".circleMod()", () => {
  it("distributes across circle positions using count as stride", () => {
    // i=0, count=2, circleCount=4 → positions 0 and 2
    const pat = color("red").i(0).count(2).circleCount(4).circleMod(0.3);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
    evs.sort((a: any, b: any) => a.x - b.x);
    const s = circleElementSize(4, 0.3);
    expect(approx(evs[0].x, circleX(0, 4, 0.3, 0, s))).toBe(true);
    expect(approx(evs[1].x, circleX(2, 4, 0.3, 0, s))).toBe(true);
  });

  it("no elements if i >= circleCount", () => {
    const pat = color("red").i(5).count(2).circleCount(4).circleMod(0.3);
    expect(queryAll(pat, 0.1)).toHaveLength(0);
  });

  it("all args explicit: circleMod(radius, startOffset, circleCount)", () => {
    const pat = color("red").i(1).count(2).circleMod(0.3, 0, 6);
    const evs = queryAll(pat, 0.1);
    // stride=2, circleCount=6, i=1 → slots 1, 3, 5
    expect(evs).toHaveLength(3);
  });

  it("reads all values from event properties when no args given", () => {
    const pat = color("red").i(0).count(2).radius(0.3).startOffset(0).circleCount(4).circleMod();
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
  });

  it("works with index() to distribute patterns around a circle", () => {
    const pat = index(color("red"), color("blue")).circleCount(2).circleMod(0.3);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
    evs.forEach((ev: any) => {
      expect(typeof ev.x).toBe("number");
      expect(typeof ev.y).toBe("number");
    });
  });

  it("index() with circleMod() — circleCount from values, stride from count", () => {
    // index labels 2 patterns with i:0/count:2 i:1/count:2; circleCount=4 → 4 total slots
    const pat = index(color("red"), color("blue")).circleCount(4).circleMod(0.3);
    const evs = queryAll(pat, 0.1);
    // red: i=0, count=2, circleCount=4 → slots 0, 2; blue: i=1, count=2 → slots 1, 3
    expect(evs).toHaveLength(4);
  });
});
