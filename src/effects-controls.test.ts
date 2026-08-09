/**
 * Tests for the pixel-effect controls registered on Pattern.prototype
 * (effects-controls.ts) that this change touches: `.dilate()`, `.smearop()`, and
 * the `smearModeCode` name→op-code map.
 *
 * These don't go through the transpiler, so mini() is called explicitly.
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { smearModeCode } from "./effects-controls";
import "./effects-controls";

function query(pat: any, t: number) {
  const evs = pat.queryArc(t, t);
  return evs.length ? evs[0].value : undefined;
}

/** Simulates what video("a.mp4") produces: an object-valued event. */
function src(pat: string) {
  return mini(pat).withValue((v: string) => ({ src: v }));
}

describe("dilate control", () => {
  it(".dilate(amount) merges dilate + default jitter onto the value", () => {
    const v = query(src("a.mp4").dilate(mini("4")), 0);
    expect(v.src).toBe("a.mp4");
    expect(v.dilate).toBe(4);
    expect(v.dilateJitter).toBe(0.5); // method default
  });

  it(".dilate(amount, jitter) sets both", () => {
    const v = query(src("a.mp4").dilate(mini("-3"), mini("0.2")), 0);
    expect(v.dilate).toBe(-3); // negative = erode
    expect(v.dilateJitter).toBeCloseTo(0.2);
  });

  it("dilate amount is patternable", () => {
    const pat = src("a.mp4").dilate(mini("2 8"));
    expect(query(pat, 0.1).dilate).toBe(2);
    expect(query(pat, 0.6).dilate).toBe(8);
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

  it("accepts avg/edge synonyms", () => {
    for (const s of ["avg", "average", "ave", "mean"]) expect(smearModeCode(s)).toBe(0);
    expect(smearModeCode("edge")).toBe(8);   // = range
    expect(smearModeCode("edgel")).toBe(9);  // = rangel
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
