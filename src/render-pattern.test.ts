/**
 * Pattern-side `.render()` — Phase 1: the value-level effect split.
 *
 * `.render()` is a meta-effect: it snapshots the effect fields accumulated so
 * far into a bake segment and clears them, leaving non-effect fields (source,
 * playback, geometry) on the one value. Boundaries chain. This file tests the
 * value shape; the FBO-chain expansion is tested at the renderer level.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { stack } from "@strudel/core";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import { AUTO_RENDER_PREFIX } from "./renderer-interface";
import { resetRegistry, initRegistry } from "./pattern-registry";
import "./visual-controls";

const R0 = `${AUTO_RENDER_PREFIX}0`;
const R1 = `${AUTO_RENDER_PREFIX}1`;

const val = (p: any) => p.queryArc(0, 1)[0].value;

beforeEach(() => {
  resetRegistry();
  initRegistry();
});

describe(".render() effect split", () => {
  it("moves the pre-boundary effect fields into a bake segment", () => {
    const v = val((color("red") as any).grey(1).barrel(0.3).render());
    expect(v._bakeSegments).toHaveLength(1);
    const seg = v._bakeSegments[0];
    expect(seg.name).toBe(R0);
    expect(Number(seg.effects.grey)).toBe(1);
    expect(Number(seg.effects.barrel)).toBeCloseTo(0.3);
    // effect fields are cleared off the top-level value
    expect(v.grey).toBeUndefined();
    expect(v.barrel).toBeUndefined();
  });

  it("keeps non-effect fields (source, playback, geometry) on the value", () => {
    const v = val((screen("clip.mp4") as any).speed(2).width(0.5).render());
    expect(v._type).toBe('video'); // .mp4 → video source, preserved through render
    expect(v.src).toBe('clip.mp4');
    expect(Number(v.speed)).toBe(2);
    expect(Number(v.width)).toBe(0.5);
  });

  it("effects after render start fresh — two smears do not collide", () => {
    const v = val((color("red") as any).brightness(0.3).render().brightness(0.5));
    // pre-boundary brightness is in the segment; post-boundary is on the value
    expect(Number(v._bakeSegments[0].effects.brightness)).toBeCloseTo(0.3);
    expect(Number(v.brightness)).toBeCloseTo(0.5);
  });

  it("smear(.5).render().smear(0): both angles survive (the collapse case)", () => {
    // Without the boundary these would collapse to one smearAngle (last wins).
    // .smear sets smear=pixels, smearAngle=angle, smearJitter=jitter.
    const v = val((screen("clip.mp4") as any).smear(0.5).render().smear(0));
    expect(Number(v._bakeSegments[0].effects.smearAngle)).toBeCloseTo(0.5); // baked pass
    expect(Number(v.smearAngle)).toBe(0);                                    // top pass
    // both passes carry a real radius (default 20px), so both actually smear
    expect(Number(v._bakeSegments[0].effects.smear)).toBe(20);
    expect(Number(v.smear)).toBe(20);
  });

  it("chains — each render() appends a segment", () => {
    const v = val((color("red") as any).grey(1).render().barrel(0.3).render().contrast(2));
    expect(v._bakeSegments).toHaveLength(2);
    expect(v._bakeSegments[0].name).toBe(R0);
    expect(v._bakeSegments[1].name).toBe(R1);
    expect(Number(v._bakeSegments[0].effects.grey)).toBe(1);
    expect(Number(v._bakeSegments[1].effects.barrel)).toBeCloseTo(0.3);
    // top effects remain on the value
    expect(Number(v.contrast)).toBe(2);
  });

  it("playback/geometry are transparent to render ordering", () => {
    const before = val((screen("clip.mp4") as any).speed(2).width(0.5).grey(1).render());
    const after  = val((screen("clip.mp4") as any).grey(1).render().speed(2).width(0.5));
    // both: grey baked in seg0, speed 2 + width .5 on the value
    for (const v of [before, after]) {
      expect(Number(v._bakeSegments[0].effects.grey)).toBe(1);
      expect(Number(v.speed)).toBe(2);
      expect(Number(v.width)).toBe(0.5);
    }
  });

  it("a render() with no prior effects makes an empty segment", () => {
    const v = val((color("red") as any).render());
    expect(v._bakeSegments).toHaveLength(1);
    expect(v._bakeSegments[0].effects).toEqual({});
  });

  it("names are stable per call site across re-evals", () => {
    val((color("red") as any).grey(1).render());
    resetRegistry();
    const v = val((color("blue") as any).grey(1).render());
    expect(v._bakeSegments[0].name).toBe(R0);
  });

  it("alpha and blend stay on the value (compositing, not baked)", () => {
    const v = val((color("red") as any).grey(1).render().alpha(0.5).blend("lighter"));
    expect(v._bakeSegments[0].effects.grey).toBeDefined();
    expect(v._bakeSegments[0].effects.alpha).toBeUndefined();
    expect(Number(v.alpha)).toBe(0.5);
    expect(v.blend).toBe('lighter');
  });

  it("flattening a stack: each tile carries its own segment", () => {
    const p = (stack(color("red"), color("blue")) as any).grey(1).render();
    const haps = p.queryArc(0, 1);
    expect(haps.length).toBe(2);
    for (const h of haps) {
      expect(h.value._bakeSegments).toHaveLength(1);
      expect(Number(h.value._bakeSegments[0].effects.grey)).toBe(1);
    }
  });
});
