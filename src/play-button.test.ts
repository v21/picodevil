import { describe, it, expect, vi } from "vitest";
import { createPlayButton, keyboardInset } from "./play-button";

describe("keyboardInset", () => {
  it("is 0 when the visual viewport fills the layout viewport (no keyboard)", () => {
    expect(keyboardInset(800, 800, 0)).toBe(0);
  });

  it("equals the covered height when the keyboard shrinks the visual viewport", () => {
    // 800px layout, keyboard takes the bottom 300px → visual height 500, no shift
    expect(keyboardInset(800, 500, 0)).toBe(300);
  });

  it("accounts for a downward-shifted visual viewport", () => {
    // visual viewport pushed down 50px and 250px shorter
    expect(keyboardInset(800, 500, 50)).toBe(250);
  });

  it("never goes negative (e.g. URL bar collapse growing the visual viewport)", () => {
    expect(keyboardInset(800, 900, 0)).toBe(0);
  });
});

describe("createPlayButton", () => {
  it("appends a round button to the parent and starts clean", () => {
    const parent = document.createElement("div");
    const pb = createPlayButton(parent, () => {});
    expect(parent.contains(pb.el)).toBe(true);
    expect(pb.el.classList.contains("pd-play-button")).toBe(true);
    expect(pb.el.classList.contains("pd-play-clean")).toBe(true);
    expect(pb.el.classList.contains("pd-play-dirty")).toBe(false);
  });

  it("toggles between clean and dirty classes", () => {
    const pb = createPlayButton(document.createElement("div"), () => {});
    pb.setDirty(true);
    expect(pb.el.classList.contains("pd-play-dirty")).toBe(true);
    expect(pb.el.classList.contains("pd-play-clean")).toBe(false);
    pb.setDirty(false);
    expect(pb.el.classList.contains("pd-play-dirty")).toBe(false);
    expect(pb.el.classList.contains("pd-play-clean")).toBe(true);
  });

  it("calls onPlay when clicked", () => {
    const onPlay = vi.fn();
    const pb = createPlayButton(document.createElement("div"), onPlay);
    pb.el.click();
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
