/**
 * The generated fragment shader must actually compile. buildFragSrc() splices in a
 * per-texture-unit if/else chain, so a GLSL typo only shows up at the unit count it
 * is built with — cheap to catch here rather than as a black canvas on someone's
 * machine.
 */
import { describe, it, expect } from "vitest";
import { compileShader, buildFragSrc, MAX_TEX_UNITS } from "./webgl-renderer";

describe("fragment shader compiles", () => {
  const gl = () => document.createElement("canvas").getContext("webgl2")!;

  it("compiles at the unit count we actually ship", () => {
    const g = gl();
    expect(g, "test browser must provide a real WebGL2 context").toBeTruthy();
    expect(() => compileShader(g, g.FRAGMENT_SHADER, buildFragSrc(MAX_TEX_UNITS))).not.toThrow();
  });

  it("compiles across the range of unit counts a device might report", () => {
    const g = gl();
    for (const n of [1, 4, 8, MAX_TEX_UNITS]) {
      expect(() => compileShader(g, g.FRAGMENT_SHADER, buildFragSrc(n)), `n=${n}`).not.toThrow();
    }
  });
});
