/**
 * Tests for vignette() — the radial-fade *source*. It used to be `.vignette(n)`,
 * a pixel effect on the tile; it is now a white-fading-to-transparent tile you
 * feed to `.matte()`, so `.matte(vignette(1))` is the old `.vignette(1)`.
 *
 * These don't go through the transpiler, so mini() is called explicitly.
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { Pattern } from "@strudel/core";
import { vignette } from "./vignette-pattern";
import { splitEffects } from "./effect-fields";
import "./visual-controls";

function query(pat: any, t: number) {
  const evs = pat.queryArc(t, t);
  return evs[0]?.value;
}

describe("vignette()", () => {
  it("is a source — a vignette-typed event carrying the amount", () => {
    const v = query(vignette(1.5), 0);
    expect(v._type).toBe("vignette");
    expect(Number(v.vignette)).toBeCloseTo(1.5);
  });

  it("defaults to 1 — the corners-transparent oval", () => {
    expect(Number(query(vignette(), 0).vignette)).toBe(1);
  });

  it("amount is patternable, including negatives", () => {
    const pat = vignette(mini("1 -2"));
    expect(Number(query(pat, 0.1).vignette)).toBe(1);
    expect(Number(query(pat, 0.6).vignette)).toBe(-2);
  });

  it("takes the universal controls like any other source", () => {
    const v = query(vignette(1).width(0.5).tint(0.6, 1).blend("screen"), 0);
    expect(v._type).toBe("vignette");
    expect(Number(v.width)).toBeCloseTo(0.5);
    expect(v.blend).toBe("screen");
  });

  it("is a pattern, so .matte() accepts it directly", () => {
    const pat = (vignette(1) as any);
    expect(pat).toBeInstanceOf(Pattern);
    const v = query((mini("a.mp4") as any).withValue((s: string) => ({ _type: "video", src: s })).matte(vignette(1)), 0);
    expect(typeof v.matteSrc).toBe("string");
    expect(v.matteSrc.startsWith("__auto_mod_")).toBe(true);
  });

  it("the falloff rides with the source at a .render() boundary", () => {
    // `vignette` is still an EFFECT_FIELD, so a .render() splits it into the bake
    // segment while `_type` stays on the tile — pass 0 draws white + the fade.
    const { effects, rest } = splitEffects(query(vignette(1), 0));
    expect(Number(effects.vignette)).toBe(1);
    expect(rest._type).toBe("vignette");
  });

  it("a non-numeric amount degrades to no fade rather than NaN", () => {
    expect(Number(query(vignette(mini("wat")), 0).vignette)).toBe(0);
  });
});
