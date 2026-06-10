import { describe, it, expect } from "vitest";
import { describeMediaError, isPermissionDenied } from "./media-errors";

describe("describeMediaError", () => {
  it("maps permission denial to a clear message", () => {
    expect(describeMediaError({ name: "NotAllowedError" }, "Camera")).toMatch(/permission denied/i);
    expect(describeMediaError({ name: "SecurityError" }, "Microphone")).toMatch(/permission denied/i);
  });

  it("maps device errors distinctly", () => {
    expect(describeMediaError({ name: "NotFoundError" }, "Camera")).toMatch(/no matching device/i);
    expect(describeMediaError({ name: "NotReadableError" }, "Camera")).toMatch(/in use by another/i);
    expect(describeMediaError({ name: "AbortError" }, "Screen capture")).toMatch(/cancelled/i);
  });

  it("falls back to the raw message for unknown errors, prefixed by the label", () => {
    const out = describeMediaError({ name: "WeirdError", message: "boom" }, "System audio");
    expect(out).toMatch(/^System audio/);
    expect(out).toContain("boom");
  });

  it("isPermissionDenied distinguishes denial from other failures", () => {
    expect(isPermissionDenied({ name: "NotAllowedError" })).toBe(true);
    expect(isPermissionDenied({ name: "SecurityError" })).toBe(true);
    expect(isPermissionDenied({ name: "NotFoundError" })).toBe(false);
    expect(isPermissionDenied(new Error("x"))).toBe(false);
  });
});
