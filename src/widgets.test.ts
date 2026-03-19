import { describe, it, expect, beforeEach } from "vitest";
import { slider, resetWidgetCounter, setWidgetValue } from "./widgets";
import { Fraction } from "@strudel/core";

describe("slider", () => {
  beforeEach(() => {
    resetWidgetCounter();
  });

  it("returns a pattern that resolves to the given value", () => {
    const pat = slider(0.5, 0, 1);
    const haps = pat.queryArc(0, 0);
    expect(haps.length).toBeGreaterThan(0);
    expect(haps[0].value).toBe(0.5);
  });

  it("responds to setWidgetValue", () => {
    const pat = slider(0.5, 0, 1);
    // Widget index 0 (first slider in this eval cycle)
    setWidgetValue(0, 0.8);
    const haps = pat.queryArc(0, 0);
    expect(haps[0].value).toBe(0.8);
  });

  it("assigns sequential indices", () => {
    const pat1 = slider(0.1);
    const pat2 = slider(0.2);

    // Update second slider only
    setWidgetValue(1, 0.9);

    const haps1 = pat1.queryArc(0, 0);
    const haps2 = pat2.queryArc(0, 0);
    expect(haps1[0].value).toBe(0.1);
    expect(haps2[0].value).toBe(0.9);
  });

  it("resets counter between eval cycles", () => {
    slider(0.1);
    slider(0.2);

    resetWidgetCounter();
    const pat = slider(0.5);
    // After reset, first slider gets index 0 again
    setWidgetValue(0, 0.7);
    const haps = pat.queryArc(0, 0);
    expect(haps[0].value).toBe(0.7);
  });
});
