/**
 * Pure auto-modulator sizing maths: consumer footprints, required modulator
 * resolution per modspace, the allocation ladder, and the zero-footprint skip.
 */
import { describe, it, expect } from "vitest";
import { consumerFootprint, requiredModRes, ladderStep } from "./modulate-sizing";

const W = 1000, H = 800;

/** Minimal consumer event; fields mirror the raw pattern-event fields. */
function ev(overrides: Record<string, unknown> = {}): any {
  return { ...overrides };
}

describe("consumerFootprint", () => {
  it("default fullscreen tile covers the canvas", () => {
    const f = consumerFootprint(ev(), W, H);
    expect(f.visible).toBe(true);
    expect(f.wPx).toBeCloseTo(W);
    expect(f.hPx).toBeCloseTo(H);
  });

  it("half-size tile has half footprint", () => {
    const f = consumerFootprint(ev({ width: 0.5, height: 0.5 }), W, H);
    expect(f.wPx).toBeCloseTo(W / 2);
    expect(f.hPx).toBeCloseTo(H / 2);
  });

  it("scale multiplies the footprint", () => {
    const f = consumerFootprint(ev({ width: 0.5, height: 0.5, scaleX: 2, scaleY: 0.5 }), W, H);
    expect(f.wPx).toBeCloseTo(W);
    expect(f.hPx).toBeCloseTo(H / 4);
  });

  it("rotateZ expands to the rotated bounding box", () => {
    // Quarter turn on a wide flat tile swaps the box axes.
    const f = consumerFootprint(ev({ width: 0.8, height: 0.2, rotateZ: 0.25 }), W, H);
    expect(f.wPx).toBeCloseTo(0.2 * H, 0);
    expect(f.hPx).toBeCloseTo(0.8 * W, 0);
  });

  it("a fully offscreen tile is not visible", () => {
    expect(consumerFootprint(ev({ x: 2 }), W, H).visible).toBe(false);
    expect(consumerFootprint(ev({ x: -1.5, y: 0.5 }), W, H).visible).toBe(false);
    expect(consumerFootprint(ev({ y: 1.8, width: 0.5, height: 0.5 }), W, H).visible).toBe(false);
  });

  it("a partially offscreen tile is visible", () => {
    expect(consumerFootprint(ev({ x: 0.95, width: 0.5 }), W, H).visible).toBe(true);
  });

  it("zero-area tiles are not visible", () => {
    expect(consumerFootprint(ev({ width: 0 }), W, H).visible).toBe(false);
    expect(consumerFootprint(ev({ scaleY: 0 }), W, H).visible).toBe(false);
  });
});

describe("requiredModRes", () => {
  it("no consumers → skip", () => {
    expect(requiredModRes([], W, H).skip).toBe(true);
  });

  it("all consumers offscreen → skip", () => {
    const r = requiredModRes([ev({ x: 3 }), ev({ y: -2 })], W, H);
    expect(r.skip).toBe(true);
  });

  it("'screen' space needs the full canvas", () => {
    const r = requiredModRes([ev({ width: 0.25, height: 0.25, modSpace: 'screen' })], W, H);
    expect(r.skip).toBe(false);
    expect(r.reqW).toBe(W);
    expect(r.reqH).toBe(H);
  });

  it("'tile' space needs the tile footprint", () => {
    const r = requiredModRes([ev({ width: 0.25, height: 0.5, modSpace: 'tile' })], W, H);
    expect(r.reqW).toBeCloseTo(W / 4);
    expect(r.reqH).toBeCloseTo(H / 2);
  });

  it("'uv' (default) at full crop needs tile density — the stackN grid case shrinks", () => {
    const r = requiredModRes([ev({ width: 0.2, height: 0.2 })], W, H);
    expect(r.reqW).toBeCloseTo(W / 5);
    expect(r.reqH).toBeCloseTo(H / 5);
  });

  it("'uv' with crop zoom magnifies the need, clamped to canvas", () => {
    // cropw 0.5 → lookup magnified 2× → footprint × 2.
    const zoom = requiredModRes([ev({ width: 0.25, height: 0.25, cropw: 0.5, croph: 0.5 })], W, H);
    expect(zoom.reqW).toBeCloseTo(W / 2);
    expect(zoom.reqH).toBeCloseTo(H / 2);
    // Extreme zoom clamps at canvas size.
    const extreme = requiredModRes([ev({ cropw: 0.01, croph: 0.01 })], W, H);
    expect(extreme.reqW).toBe(W);
    expect(extreme.reqH).toBe(H);
  });

  it("takes the max over consumers, ignoring offscreen ones", () => {
    const r = requiredModRes([
      ev({ width: 0.1, height: 0.1 }),
      ev({ width: 0.5, height: 0.25 }),
      ev({ x: 5 }), // offscreen: ignored
    ], W, H);
    expect(r.reqW).toBeCloseTo(W / 2);
    expect(r.reqH).toBeCloseTo(H / 4);
  });

  it("applies the 16px floor for tiny visible consumers", () => {
    const r = requiredModRes([ev({ width: 0.001, height: 0.001 })], W, H);
    expect(r.skip).toBe(false);
    expect(r.reqW).toBe(16);
    expect(r.reqH).toBe(16);
  });
});

describe("ladderStep", () => {
  it("quantises to {1/8, 1/4, 1/2, 1} × full", () => {
    expect(ladderStep(100, 1000)).toBe(125);
    expect(ladderStep(125, 1000)).toBe(125);
    expect(ladderStep(126, 1000)).toBe(250);
    expect(ladderStep(400, 1000)).toBe(500);
    expect(ladderStep(600, 1000)).toBe(1000);
    expect(ladderStep(1000, 1000)).toBe(1000);
  });

  it("clamps to full for oversized requests", () => {
    expect(ladderStep(5000, 1000)).toBe(1000);
  });
});
