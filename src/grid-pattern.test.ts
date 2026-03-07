import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { GridPattern } from "./grid-pattern";
import { ColorPattern } from "./color-pattern";
import { VideoPattern } from "./video-pattern";
import { ImagePattern } from "./image-pattern";

function color(pat: string) {
  return ColorPattern.fromMini(mini(pat), mini);
}

function video(pat: string) {
  return VideoPattern.fromSrc(mini(pat), mini);
}

function image(pat: string) {
  return ImagePattern.fromSrc(mini(pat), mini);
}

describe("GridPattern", () => {
  it("stores children, cols, and rows", () => {
    const c1 = color("red");
    const c2 = color("blue");
    const g = new GridPattern([c1, c2], 2, 1, mini);
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(1);
    expect(g.children).toHaveLength(2);
  });

  it("cycles children when fewer than cols*rows", () => {
    const c1 = color("red");
    const c2 = color("blue");
    const g = new GridPattern([c1, c2], 3, 3, mini); // 9 cells, 2 children
    expect(g.children).toHaveLength(9);
    // pattern: c1, c2, c1, c2, c1, c2, c1, c2, c1
    expect(g.children[0]).not.toBe(g.children[1]); // different children
    expect(g.children[2]).not.toBe(g.children[0]); // cloned, not same instance
  });

  it("children are clones, not shared references", () => {
    const c1 = color("red");
    const g = new GridPattern([c1], 2, 2, mini);
    // Each cell should be a distinct instance
    const unique = new Set(g.children);
    expect(unique.size).toBe(4);
  });

  it("supports mixed screen types as children", () => {
    const c = color("red");
    const v = video("clip.mp4");
    const img = image("pic.png");
    const g = new GridPattern([c, v, img], 3, 1, mini);
    expect(g.children[0]).toBeInstanceOf(ColorPattern);
    expect(g.children[1]).toBeInstanceOf(VideoPattern);
    expect(g.children[2]).toBeInstanceOf(ImagePattern);
  });

  it("inherits ScreenPattern methods (alpha, fit, scale)", () => {
    const g = new GridPattern([color("red")], 2, 2, mini);
    const g2 = g.alpha("0.5").fit("contain").scale("2");
    const evs = g2.queryArc(0, 1);
    expect(evs[0].value.alpha).toBe(0.5);
    expect(g2.fitMode).toBe("contain");
    expect(evs[0].value.scaleX).toBe(2);
    expect(evs[0].value.scaleY).toBe(2);
  });

  it("cloning preserves grid properties", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.alpha("0.5");
    expect(g2.cols).toBe(2);
    expect(g2.rows).toBe(1);
    expect(g2.children).toHaveLength(2);
  });

  it("nesting: a grid can contain another grid", () => {
    const inner = new GridPattern([color("red")], 2, 2, mini);
    const outer = new GridPattern([inner, color("blue")], 2, 1, mini);
    expect(outer.children[0]).toBeInstanceOf(GridPattern);
    expect(outer.children[1]).toBeInstanceOf(ColorPattern);
  });

  it("calls onOut when out() is called", () => {
    let called = false;
    const g = new GridPattern([color("red")], 2, 2, mini, (s) => { called = true; });
    g.out();
    expect(called).toBe(true);
  });

  it("cellState array has correct length", () => {
    const g = new GridPattern([color("red")], 3, 3, mini);
    expect(g.cellState).toHaveLength(9);
    expect(g.cellState.every(v => v === null)).toBe(true);
  });

  // --- setI ---

  it("setI replaces child at a single index", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const replacement = video("clip.mp4");
    const g2 = g.setI(0, replacement);
    expect(g2.children[0]).toBeInstanceOf(VideoPattern);
    expect(g2.children[1]).toBeInstanceOf(ColorPattern);
    expect(g2.children[2]).toBeInstanceOf(ColorPattern);
    expect(g2.children[3]).toBeInstanceOf(ColorPattern);
  });

  it("setI with mininotation '0,3' replaces indices 0 and 3", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const replacement = video("clip.mp4");
    const g2 = g.setI("0,3", replacement);
    expect(g2.children[0]).toBeInstanceOf(VideoPattern);
    expect(g2.children[1]).toBeInstanceOf(ColorPattern);
    expect(g2.children[2]).toBeInstanceOf(ColorPattern);
    expect(g2.children[3]).toBeInstanceOf(VideoPattern);
  });

  it("setI is immutable", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.setI(0, video("clip.mp4"));
    expect(g.children[0]).toBeInstanceOf(ColorPattern);
    expect(g2.children[0]).toBeInstanceOf(VideoPattern);
  });

  it("setI with mininotation '1' replaces only index 1", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.setI("1", image("pic.png"));
    expect(g2.children[0]).toBeInstanceOf(ColorPattern);
    expect(g2.children[1]).toBeInstanceOf(ImagePattern);
    expect(g2.children[2]).toBeInstanceOf(ColorPattern);
  });

  it("setI preserves grid-level alpha and fit", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini)
      .alpha("0.5").fit("contain");
    const g2 = g.setI(0, video("clip.mp4"));
    expect(g2.queryArc(0, 1)[0].value.alpha).toBe(0.5);
    expect(g2.fitMode).toBe("contain");
    expect(g2.children[0]).toBeInstanceOf(VideoPattern);
  });

  it("setI clones the replacement screen", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const replacement = video("clip.mp4");
    const g2 = g.setI("0,1", replacement);
    // Each cell should be a distinct clone
    expect(g2.children[0]).not.toBe(g2.children[1]);
    expect(g2.children[0]).not.toBe(replacement);
  });

  it("setI with numeric index works", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.setI(2, image("pic.png"));
    expect(g2.children[2]).toBeInstanceOf(ImagePattern);
  });
});
