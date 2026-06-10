import { describe, it, expect } from "vitest";
import { describeMediaError, isPermissionDenied, describeMediaLoadError, shortenUrl } from "./media-errors";

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

describe("describeMediaLoadError", () => {
  it("reports a video 404 by filename when there is a real MediaError", () => {
    const msg = describeMediaLoadError("video", "https://cdn.example.com/clips/foo.mp4", true);
    expect(msg).toBe("Video failed to load: foo.mp4");
  });

  it("reports an image failure", () => {
    expect(describeMediaLoadError("image", "https://x/y/pic.png", true)).toBe("Image failed to load: pic.png");
  });

  it("ignores a spurious video error with no MediaError (pool recycle / cleared src)", () => {
    expect(describeMediaLoadError("video", "https://x/foo.mp4", false)).toBeNull();
  });

  it("ignores an empty src", () => {
    expect(describeMediaLoadError("video", "", true)).toBeNull();
    expect(describeMediaLoadError("image", null, true)).toBeNull();
  });

  it("shortenUrl returns the filename, or the input if unparseable", () => {
    expect(shortenUrl("https://cdn.example.com/a/b/clip.mp4")).toBe("clip.mp4");
    expect(shortenUrl("/videos/local.mp4")).toBe("local.mp4");
  });
});
