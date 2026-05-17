import { describe, it, expect } from "vitest";
import { color } from "./color-pattern";
import "./visual-controls"; // side-effect: registers .echo() override on Pattern.prototype

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t).map((e: any) => e.value);
}

describe("echo (alpha-based override)", () => {
  it("produces the correct number of simultaneous copies", () => {
    const pat = color("red").echo(3, 0.125, 0.5);
    const evs = queryAll(pat, 0.5);
    expect(evs.length).toBe(3);
  });

  it("all copies share the source color", () => {
    const pat = color("red").echo(3, 0.125, 0.5);
    const evs = queryAll(pat, 0.5);
    for (const ev of evs) {
      expect(ev.color).toBe("red");
    }
  });

  it("alpha decays geometrically: 1, feedback, feedback^2", () => {
    const feedback = 0.5;
    const pat = color("red").echo(3, 0.125, feedback);
    const evs = queryAll(pat, 0.5);
    const alphas = evs.map((ev: any) => ev.alpha).sort((a: number, b: number) => b - a);
    expect(alphas[0]).toBeCloseTo(1, 5);
    expect(alphas[1]).toBeCloseTo(feedback, 5);
    expect(alphas[2]).toBeCloseTo(feedback * feedback, 5);
  });

  it("echo(1, ...) produces a single copy with alpha=1", () => {
    const pat = color("red").echo(1, 0.125, 0.7);
    const evs = queryAll(pat, 0.5);
    expect(evs.length).toBe(1);
    expect(evs[0].alpha).toBeCloseTo(1, 5);
  });

  it("does not call .gain() (no gain field in output)", () => {
    const pat = color("red").echo(3, 0.125, 0.5);
    const evs = queryAll(pat, 0.5);
    for (const ev of evs) {
      expect(ev.gain).toBeUndefined();
    }
  });
});
