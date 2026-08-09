/**
 * Tests for the pixel-effect controls registered on Pattern.prototype
 * (effects-controls.ts) that this change touches: `.dilate()`, `.smearop()`, and
 * the `smearModeCode` name→op-code map.
 *
 * These don't go through the transpiler, so mini() is called explicitly.
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { smearModeCode, normModSpace } from "./effects-controls";
import "./effects-controls";

function query(pat: any, t: number) {
  const evs = pat.queryArc(t, t);
  return evs.length ? evs[0].value : undefined;
}

/** Simulates what video("a.mp4") produces: an object-valued event. */
function src(pat: string) {
  return mini(pat).withValue((v: string) => ({ src: v }));
}

describe("dilate/erode aliases (circular smear + smearop)", () => {
  it(".dilate(amount) = a circular smear (negative radius) reduced with max", () => {
    const v = query(src("a.mp4").dilate(mini("4")), 0);
    expect(v.src).toBe("a.mp4");
    expect(v.smear).toBe(-4);        // negative radius = circular ring
    expect(v.smearMode).toBe("max"); // dilate = max reducer
    expect(v.smearJitter).toBeCloseTo(0.5);
  });

  it(".erode(amount) = a circular smear reduced with min", () => {
    const v = query(src("a.mp4").erode(mini("3"), mini("0.2")), 0);
    expect(v.smear).toBe(-3);
    expect(v.smearMode).toBe("min");
    expect(v.smearJitter).toBeCloseTo(0.2);
  });

  it("dilate radius is patternable and always circular (abs → negative)", () => {
    const pat = src("a.mp4").dilate(mini("2 8"));
    expect(query(pat, 0.1).smear).toBe(-2);
    expect(query(pat, 0.6).smear).toBe(-8);
    // a passed-negative amount is still a (circular) radius, not a re-flip
    expect(query(src("a.mp4").dilate(mini("-5")), 0).smear).toBe(-5);
  });

  it(".blur(amount) = a circular smear with the default (avg) reducer", () => {
    const v = query(src("a.mp4").blur(mini("8")), 0);
    expect(v.smear).toBe(-8);          // circular ring
    expect(v.smearMode).toBeUndefined(); // no smearop → avg
  });

  it("a later smear-family call overrides an earlier one (one sampling slot)", () => {
    const v = query(src("a.mp4").smear(mini("0"), mini("20")).dilate(mini("4")), 0);
    expect(v.smear).toBe(-4);          // dilate's circular radius wins
    expect(v.smearMode).toBe("max");
  });
});

describe("smearop control", () => {
  it(".smearop(mode) merges the mode string onto the value", () => {
    const v = query(src("a.mp4").smearop(mini("max")), 0);
    expect(v.src).toBe("a.mp4");
    expect(v.smearMode).toBe("max");
  });

  it("mode is patternable", () => {
    const pat = src("a.mp4").smearop(mini("avg range"));
    expect(query(pat, 0.1).smearMode).toBe("avg");
    expect(query(pat, 0.6).smearMode).toBe("range");
  });
});

describe("smearModeCode", () => {
  it("maps the base reducer names to their op codes", () => {
    expect(smearModeCode("avg")).toBe(0);
    expect(smearModeCode("avgl")).toBe(1);
    expect(smearModeCode("max")).toBe(2);
    expect(smearModeCode("min")).toBe(3);
    expect(smearModeCode("maxl")).toBe(4);
    expect(smearModeCode("minl")).toBe(5);
    expect(smearModeCode("range")).toBe(8);
    expect(smearModeCode("rangel")).toBe(9);
  });

  it("treats med/median and medl/medianl as synonyms", () => {
    expect(smearModeCode("median")).toBe(6);
    expect(smearModeCode("med")).toBe(6);
    expect(smearModeCode("medianl")).toBe(7);
    expect(smearModeCode("medl")).toBe(7);
  });

  it("accepts avg/edge/morphology synonyms", () => {
    for (const s of ["avg", "average", "ave", "mean"]) expect(smearModeCode(s)).toBe(0);
    expect(smearModeCode("edge")).toBe(8);    // = range
    expect(smearModeCode("edgel")).toBe(9);   // = rangel
    expect(smearModeCode("dilate")).toBe(2);  // = max
    expect(smearModeCode("erode")).toBe(3);   // = min
  });

  it("bare sharpen/sharp alias sharpen3; sharpenN and sharpN map to 10..18", () => {
    expect(smearModeCode("sharpen")).toBe(12);
    expect(smearModeCode("sharp")).toBe(12);
    expect(smearModeCode("sharpen3")).toBe(12);
    expect(smearModeCode("sharp3")).toBe(12);
    expect(smearModeCode("sharpen1")).toBe(10);
    expect(smearModeCode("sharp1")).toBe(10);
    expect(smearModeCode("sharpen9")).toBe(18);
    expect(smearModeCode("sharp9")).toBe(18);
  });

  it("is case/space-insensitive and falls back to avg (0) for unknown", () => {
    expect(smearModeCode(" MAX ")).toBe(2);
    expect(smearModeCode("nonsense")).toBe(0);
    expect(smearModeCode(undefined)).toBe(0);
    expect(smearModeCode("")).toBe(0);
  });

  it("passes through a raw numeric code", () => {
    expect(smearModeCode(6)).toBe(6);
    expect(smearModeCode(NaN)).toBe(0);
  });
});

describe("normModSpace", () => {
  it("normalises canonical tokens", () => {
    expect(normModSpace("uv")).toBe("uv");
    expect(normModSpace("tile")).toBe("tile");
    expect(normModSpace("screen")).toBe("screen");
  });

  it("is case/space-insensitive", () => {
    expect(normModSpace("Screen")).toBe("screen");
    expect(normModSpace(" TILE ")).toBe("tile");
    expect(normModSpace("UV")).toBe("uv");
  });

  it("falls back to 'uv' for unknown / non-string", () => {
    expect(normModSpace("world")).toBe("uv");
    expect(normModSpace(undefined)).toBe("uv");
    expect(normModSpace(3)).toBe("uv");
  });
});
