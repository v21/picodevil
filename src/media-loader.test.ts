import { describe, it, expect } from "vitest";
import { shouldAutoloadDefaults } from "./media-loader";

describe("defaults auto-load policy", () => {
  it("auto-loads on a fresh session with an empty registry", () => {
    expect(shouldAutoloadDefaults(true, 0)).toBe(true);
  });

  it("skips for a returning user, even when their registry is empty", () => {
    // A returning user who cleared all media still has a URL hash, so the
    // session isn't fresh — we must not re-inject defaults over that choice.
    expect(shouldAutoloadDefaults(false, 0)).toBe(false);
  });

  it("skips on a fresh session that already has media loaded", () => {
    expect(shouldAutoloadDefaults(true, 3)).toBe(false);
  });
});
