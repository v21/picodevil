/**
 * The ?pdsafeshader diagnostic swaps the full fragment shader for a minimal one
 * (no ops loop, no dynamic UBO indexing) to isolate whether that construct is what
 * crashes some Windows ANGLE→D3D11 drivers. Verify both variants actually compile
 * so a diagnostic build never wastes a Windows round-trip on a GLSL typo.
 */
import { describe, it, expect } from "vitest";
import { compileShader, buildFragSrc } from "./webgl-renderer";

describe("fragment shader variants compile", () => {
  const gl = () => document.createElement("canvas").getContext("webgl2")!;

  it("compiles the minimal safe shader (?pdsafeshader)", () => {
    const g = gl();
    expect(g, "test browser must provide a real WebGL2 context").toBeTruthy();
    expect(() => compileShader(g, g.FRAGMENT_SHADER, buildFragSrc(16, true))).not.toThrow();
  });

  it("still compiles the full shader", () => {
    const g = gl();
    expect(() => compileShader(g, g.FRAGMENT_SHADER, buildFragSrc(16, false))).not.toThrow();
  });
});
