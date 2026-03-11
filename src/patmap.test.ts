import { describe, it, expect } from "vitest";
import { stack } from "@strudel/core";
import { color } from "./color-pattern";
import { index } from "./index-patterns";
import "./visual-controls";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t + 0.001).map((e: any) => e.value);
}

describe(".mapWithVal()", () => {
  it("applies a transformer using the event value", () => {
    const pat = color("red").radius(0.1).mapWithVal((p: any, v: any) => p.radius(v.radius * 2));
    const ev = queryAll(pat, 0.1)[0];
    expect(ev.radius).toBeCloseTo(0.2);
  });

  it("allows setting radius from i value (primary use case)", () => {
    const pat = index(color("red"), color("blue"))
      .mapWithVal((p: any, v: any) => p.radius(v.i * 0.1 + 0.1));
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
    const sorted = [...evs].sort((a: any, b: any) => a.i - b.i);
    expect(sorted[0].radius).toBeCloseTo(0.1);
    expect(sorted[1].radius).toBeCloseTo(0.2);
  });

  it("preserves other event properties", () => {
    const pat = color("red").mapWithVal((p: any) => p.alpha(0.5));
    const ev = queryAll(pat, 0.1)[0];
    expect(ev.color).toBe("red");
    expect(ev.alpha).toBeCloseTo(0.5);
  });

  it("works with stack", () => {
    const pat = stack(color("red"), color("blue"))
      .mapWithVal((p: any) => p.alpha(0.3));
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
    evs.forEach((ev: any) => expect(ev.alpha).toBeCloseTo(0.3));
  });
});
