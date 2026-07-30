/**
 * WebGL2 context *creation* failure diagnostics.
 *
 * When getContext('webgl2') returns null we previously logged a static list of
 * guesses. The browser actually tells us why, via the 'webglcontextcreationerror'
 * event's statusMessage — but only if a listener is attached *before* the
 * getContext call. These tests pin the message-building logic that turns that
 * status (plus a WebGL1 probe) into an actionable diagnostic.
 */
import { describe, it, expect } from "vitest";
import { describeContextCreationFailure, MAX_TEX_UNITS } from "./webgl-renderer";

describe("sampler slot cap (ANGLE/D3D11 context-loss workaround)", () => {
  // Raising this back to the device maximum reintroduces a hard crash on every
  // Windows/D3D11 machine — see the comment at the constant. 15 is not arbitrary.
  it("never declares more than 15 fragment samplers", () => {
    expect(MAX_TEX_UNITS).toBeLessThanOrEqual(15);
  });

  it("still allows enough units to be worth batching", () => {
    expect(MAX_TEX_UNITS).toBeGreaterThanOrEqual(8);
  });
});

describe("describeContextCreationFailure", () => {
  it("quotes the browser's own statusMessage when there is one", () => {
    const msg = describeContextCreationFailure("Passthrough is not supported", false);
    expect(msg).toContain("Passthrough is not supported");
  });

  it("says the reason was unavailable when the browser gave no statusMessage", () => {
    const msg = describeContextCreationFailure("", false);
    expect(msg).toContain("(none)");
  });

  it("distinguishes 'GPU off entirely' from 'WebGL1 but not WebGL2'", () => {
    // WebGL1 also dead => acceleration is off / GPU process unusable, not an old GPU.
    const noGL = describeContextCreationFailure("", false);
    expect(noGL).toMatch(/hardware acceleration|GPU process/i);

    // WebGL1 alive but WebGL2 refused => the GPU is there and WebGL2 was refused
    // specifically (in practice: Chrome disabled it after repeated GPU crashes).
    const gl1Only = describeContextCreationFailure("", true);
    expect(gl1Only).toMatch(/WebGL1 still works/i);
    expect(gl1Only).toMatch(/restart/i);
    expect(gl1Only).not.toBe(noGL);
  });

  it("always points at the platform GPU diagnostics page", () => {
    expect(describeContextCreationFailure("x", true)).toContain("chrome://gpu");
  });
});

describe("context creation on a canvas that already has a 2D context", () => {
  // Real-world footgun this guards: you cannot get a WebGL context from a canvas
  // that already handed out a 2D one. If that ever happened in main.ts, the
  // symptom would be an identical "returned null" with a healthy GPU — exactly
  // the confusing case we're trying to tell apart.
  it("returns null, proving null != 'no WebGL2 support'", () => {
    const canvas = document.createElement("canvas");
    expect(canvas.getContext("2d")).toBeTruthy();
    expect(canvas.getContext("webgl2")).toBeNull();

    // ...while a fresh canvas on the same machine is fine.
    expect(document.createElement("canvas").getContext("webgl2")).toBeTruthy();
  });
});
