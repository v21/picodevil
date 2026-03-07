import { describe, it, expect, vi } from "vitest";
import { setPlaybackRate } from "./playback-rate";

describe("setPlaybackRate", () => {
  it("sets a valid playback rate", () => {
    const el = document.createElement("video");
    setPlaybackRate(el, 2);
    expect(el.playbackRate).toBe(2);
  });

  it("catches NotSupportedError for invalid rates", () => {
    const el = document.createElement("video");
    // stub the setter to throw NotSupportedError
    Object.defineProperty(el, "playbackRate", {
      set() {
        const err = new DOMException("Invalid rate", "NotSupportedError");
        throw err;
      },
      get() { return 1; },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => setPlaybackRate(el, 0.01)).not.toThrow();
    expect(spy).toHaveBeenCalledWith("unsupported playback rate:", 0.01);
    spy.mockRestore();
  });

  it("rethrows non-NotSupportedError exceptions", () => {
    const el = document.createElement("video");
    Object.defineProperty(el, "playbackRate", {
      set() { throw new TypeError("something else"); },
      get() { return 1; },
    });
    expect(() => setPlaybackRate(el, 2)).toThrow(TypeError);
  });
});
