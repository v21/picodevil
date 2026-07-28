import { describe, it, expect, afterEach, vi } from "vitest";
import { showFatalOverlay, rendererFailureMessage } from "./fatal-overlay";
import {
  WebGLRenderer,
  WebGL2UnavailableError,
  ShaderError,
  compileShader,
} from "./webgl-renderer";

afterEach(() => {
  document.getElementById("pd-fatal")?.remove();
  vi.restoreAllMocks();
});

describe("showFatalOverlay", () => {
  it("inserts a visible overlay carrying the title and message", () => {
    showFatalOverlay("No WebGL2", "Use a recent browser.");
    const el = document.getElementById("pd-fatal")!;
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toContain("No WebGL2");
    expect(el.textContent).toContain("Use a recent browser.");
  });

  it("is idempotent — a second call replaces rather than stacks", () => {
    showFatalOverlay("First", "a");
    showFatalOverlay("Second", "b");
    expect(document.querySelectorAll("#pd-fatal").length).toBe(1);
    expect(document.getElementById("pd-fatal")!.textContent).toContain("Second");
  });
});

// The renderer can die at startup in two distinct ways. Each throws a typed error
// AND logs the specifics to the console — the console log is the diagnostic that
// survives even if the overlay itself never renders.
describe("renderer startup failure classification", () => {
  it("throws WebGL2UnavailableError and logs when no WebGL2 context is available", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A canvas whose getContext returns null == no WebGL2 (hw accel off / blocklisted).
    const deadCanvas = {
      getContext: () => null,
      addEventListener: () => {},
    } as unknown as HTMLCanvasElement;

    expect(() => new WebGLRenderer(deadCanvas)).toThrow(WebGL2UnavailableError);
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/WebGL2/i);
  });

  it("throws ShaderError and logs when a shader fails to compile", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gl = document.createElement("canvas").getContext("webgl2");
    expect(gl, "test browser must provide a real WebGL2 context").toBeTruthy();

    expect(() =>
      compileShader(gl!, gl!.FRAGMENT_SHADER, "this is definitely not valid glsl"),
    ).toThrow(ShaderError);
    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls.flat().join(" ")).toMatch(/shader/i);
  });
});

// Each failure mode must map to DIFFERENT user-facing advice.
describe("rendererFailureMessage", () => {
  it("gives hardware-acceleration advice for a missing WebGL2 context", () => {
    const { title, message } = rendererFailureMessage(new WebGL2UnavailableError());
    expect(message).toMatch(/hardware acceleration/i);
    expect(message).not.toMatch(/shader/i);
    expect(title).toBeTruthy();
  });

  it("gives shader/GPU advice (distinct from the WebGL2 message) for a ShaderError", () => {
    const shader = rendererFailureMessage(new ShaderError("fragment shader compile error:\n…"));
    const noWebgl = rendererFailureMessage(new WebGL2UnavailableError());
    expect(shader.message).toMatch(/shader/i);
    expect(shader.title).not.toBe(noWebgl.title);
    expect(shader.message).not.toBe(noWebgl.message);
  });

  it("falls back to the WebGL2 message for an unrecognised error", () => {
    expect(rendererFailureMessage(new Error("boom")).message).toMatch(/hardware acceleration/i);
    expect(rendererFailureMessage("weird").message).toMatch(/hardware acceleration/i);
    expect(rendererFailureMessage(null).message).toMatch(/hardware acceleration/i);
  });
});

// End-to-end: the overlay actually shows the right message for each failure.
describe("fatal overlay shows the failure-specific message", () => {
  it("shows the hardware-acceleration message for a missing WebGL2 context", () => {
    const { title, message } = rendererFailureMessage(new WebGL2UnavailableError());
    showFatalOverlay(title, message);
    const overlay = document.getElementById("pd-fatal")!;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain(title);
    expect(overlay.textContent).toMatch(/hardware acceleration/i);
  });

  it("shows the shader message for a ShaderError", () => {
    const { title, message } = rendererFailureMessage(new ShaderError("link error"));
    showFatalOverlay(title, message);
    const overlay = document.getElementById("pd-fatal")!;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain(title);
    expect(overlay.textContent).toMatch(/shader/i);
  });
});
