import { describe, it, expect } from "vitest";
import {
  compile,
  OP_SAMPLE, OP_BARREL, OP_PIXELATE, OP_WRAP,
  OP_CONTRAST, OP_BRIGHTNESS, OP_COLOR_OKLAB, OP_ALPHA,
  OP_FLOATS,
  type EffectInputs,
} from "./effect-compiler";

/** Default inputs for a no-effects tile (color/image with no controls applied). */
function defaults(): EffectInputs {
  return {
    texIndex: 0,
    alpha: 1,
    grey: 0,
    hueRot: 0,
    pixUVStepX: 0, pixUVStepY: 0,
    contrast: 1,
    brightness: 0,
    tintHue: 0, tintStrength: 0,
    barrel: 0,
    cropOffX: 0, cropOffY: 0,
    cropSizeX: 1, cropSizeY: 1,
    tileMode: 0,
  };
}

/** Extract op kinds from a compiled ops buffer. */
function kinds(ops: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < ops.length; i += OP_FLOATS) out.push(ops[i]);
  return out;
}

describe("effect-compiler", () => {
  describe("minimal chains", () => {
    it("no-effects tile produces WRAP + SAMPLE + ALPHA", () => {
      expect(kinds(compile(defaults()))).toEqual([OP_WRAP, OP_SAMPLE, OP_ALPHA]);
    });

    it("ALPHA always emitted even when alpha=1", () => {
      const e = defaults();
      const ops = compile(e);
      const lastOpStart = ops.length - OP_FLOATS;
      expect(ops[lastOpStart]).toBe(OP_ALPHA);
      expect(ops[lastOpStart + 1]).toBe(1);
    });

    it("SAMPLE carries texIndex", () => {
      const e = { ...defaults(), texIndex: 3 };
      const ops = compile(e);
      // SAMPLE is the second op (after WRAP); kind at offset OP_FLOATS, texIdx at OP_FLOATS+1
      expect(ops[OP_FLOATS]).toBe(OP_SAMPLE);
      expect(ops[OP_FLOATS + 1]).toBe(3);
    });
  });

  describe("canonical op order", () => {
    it("fully-loaded chain emits 8 ops in canonical order", () => {
      const e: EffectInputs = {
        texIndex: 2,
        alpha: 0.5,
        grey: 0.4,
        hueRot: 0.2,
        pixUVStepX: 0.1, pixUVStepY: 0.1,
        contrast: 1.5,
        brightness: 0.2,
        tintHue: 0.3, tintStrength: 0.6,
        barrel: 0.2,
        cropOffX: 0.1, cropOffY: 0.1,
        cropSizeX: 0.8, cropSizeY: 0.8,
        tileMode: 1,
      };
      expect(kinds(compile(e))).toEqual([
        OP_BARREL, OP_PIXELATE, OP_WRAP, OP_SAMPLE,
        OP_CONTRAST, OP_BRIGHTNESS, OP_COLOR_OKLAB, OP_ALPHA,
      ]);
    });

    it("UV-stage ops always precede SAMPLE", () => {
      const e = { ...defaults(), barrel: 0.1, pixUVStepX: 0.05, pixUVStepY: 0.05 };
      const ks = kinds(compile(e));
      const sampleIdx = ks.indexOf(OP_SAMPLE);
      expect(ks.slice(0, sampleIdx)).toEqual([OP_BARREL, OP_PIXELATE, OP_WRAP]);
    });

    it("color-stage ops always follow SAMPLE", () => {
      const e = { ...defaults(), contrast: 1.2, brightness: 0.1, grey: 0.3 };
      const ks = kinds(compile(e));
      const sampleIdx = ks.indexOf(OP_SAMPLE);
      expect(ks.slice(sampleIdx + 1)).toEqual([OP_CONTRAST, OP_BRIGHTNESS, OP_COLOR_OKLAB, OP_ALPHA]);
    });
  });

  describe("optional emission", () => {
    it("BARREL omitted when barrel=0", () => {
      expect(kinds(compile(defaults()))).not.toContain(OP_BARREL);
    });

    it("BARREL emitted when barrel != 0 (even negative)", () => {
      expect(kinds(compile({ ...defaults(), barrel: -0.3 }))).toContain(OP_BARREL);
    });

    it("PIXELATE emitted when stepX or stepY > 0", () => {
      expect(kinds(compile({ ...defaults(), pixUVStepX: 0.1, pixUVStepY: 0 }))).toContain(OP_PIXELATE);
      expect(kinds(compile({ ...defaults(), pixUVStepX: 0, pixUVStepY: 0.1 }))).toContain(OP_PIXELATE);
    });

    it("PIXELATE clamp mode is 1 when not tiling, 0 when tiling", () => {
      const notTile = compile({ ...defaults(), pixUVStepX: 0.1, pixUVStepY: 0.1, tileMode: 0 });
      const tile    = compile({ ...defaults(), pixUVStepX: 0.1, pixUVStepY: 0.1, tileMode: 1 });
      // PIXELATE op is at position OP_FLOATS*0 (it's the first op when no BARREL).
      expect(notTile[3]).toBe(1);
      expect(tile[3]).toBe(0);
    });

    it("CONTRAST emitted only when != 1", () => {
      expect(kinds(compile({ ...defaults(), contrast: 1 }))).not.toContain(OP_CONTRAST);
      expect(kinds(compile({ ...defaults(), contrast: 1.5 }))).toContain(OP_CONTRAST);
      expect(kinds(compile({ ...defaults(), contrast: 0 }))).toContain(OP_CONTRAST);
    });

    it("BRIGHTNESS emitted only when != 0", () => {
      expect(kinds(compile({ ...defaults(), brightness: 0 }))).not.toContain(OP_BRIGHTNESS);
      expect(kinds(compile({ ...defaults(), brightness: 0.1 }))).toContain(OP_BRIGHTNESS);
    });

    it("COLOR_OKLAB emitted when any of grey/tintStrength/hueRot is non-zero", () => {
      expect(kinds(compile({ ...defaults(), grey: 0.5 }))).toContain(OP_COLOR_OKLAB);
      expect(kinds(compile({ ...defaults(), tintStrength: 0.5 }))).toContain(OP_COLOR_OKLAB);
      expect(kinds(compile({ ...defaults(), hueRot: 0.5 }))).toContain(OP_COLOR_OKLAB);
      expect(kinds(compile({ ...defaults() }))).not.toContain(OP_COLOR_OKLAB);
    });

    it("COLOR_OKLAB packs all four params (grey, tintHue, tintStrength, hueRot)", () => {
      const e = { ...defaults(), grey: 0.4, tintHue: 0.6, tintStrength: 0.7, hueRot: 0.3 };
      const ops = compile(e);
      // OKLAB is the last op before ALPHA; find it.
      let oklabIdx = -1;
      for (let i = 0; i < ops.length; i += OP_FLOATS) {
        if (ops[i] === OP_COLOR_OKLAB) { oklabIdx = i; break; }
      }
      expect(oklabIdx).toBeGreaterThan(-1);
      expect(ops[oklabIdx + 1]).toBeCloseTo(0.4);
      expect(ops[oklabIdx + 2]).toBeCloseTo(0.6);
      expect(ops[oklabIdx + 3]).toBeCloseTo(0.7);
      expect(ops[oklabIdx + 4]).toBeCloseTo(0.3);
    });
  });

  describe("WRAP packing", () => {
    it("packs cropOff, cropSize, tileMode in the right slots", () => {
      const e = { ...defaults(), cropOffX: 0.1, cropOffY: 0.2, cropSizeX: 0.5, cropSizeY: 0.6, tileMode: 1 };
      const ops = compile(e);
      // WRAP is the first op when no BARREL/PIXELATE.
      expect(ops[0]).toBe(OP_WRAP);
      expect(ops[1]).toBeCloseTo(0.1);
      expect(ops[2]).toBeCloseTo(0.2);
      expect(ops[3]).toBeCloseTo(0.5);
      expect(ops[4]).toBeCloseTo(0.6);
      expect(ops[5]).toBe(1);
    });
  });
});
