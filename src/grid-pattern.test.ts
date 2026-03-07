import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { reify } from "@strudel/core";
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
  it("stores source children and resolves grid size", () => {
    const c1 = color("red");
    const c2 = color("blue");
    const g = new GridPattern([c1, c2], 2, 1, mini);
    expect(g.resolveGrid(0)).toEqual({ cols: 2, rows: 1 });
    expect(g.children).toHaveLength(2);
  });

  it("children are source clones, cycled at render time via childAt", () => {
    const c1 = color("red");
    const c2 = color("blue");
    const g = new GridPattern([c1, c2], 3, 3, mini);
    // Source children stored as-is (2 sources)
    expect(g.children).toHaveLength(2);
    // childAt cycles through sources
    expect(g.childAt(0)).toBe(g.children[0]);
    expect(g.childAt(1)).toBe(g.children[1]);
    expect(g.childAt(2)).toBe(g.children[0]); // wraps
    expect(g.childAt(8)).toBe(g.children[0]); // 8 % 2 = 0
  });

  it("children are clones, not shared references", () => {
    const c1 = color("red");
    const g = new GridPattern([c1], 2, 2, mini);
    expect(g.children).toHaveLength(1);
    expect(g.children[0]).not.toBe(c1);
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
    expect(g2.resolveGrid(0)).toEqual({ cols: 2, rows: 1 });
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

  it("cellState starts empty and grows on demand", () => {
    const g = new GridPattern([color("red")], 3, 3, mini);
    expect(g.cellState).toHaveLength(0);
  });

  // --- setI (all overrides, resolved at query time) ---

  it("setI with number resolves at query time", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const g2 = g.setI(0, video("clip.mp4"));
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.1)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(2, 0.1)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(3, 0.1)).toBeInstanceOf(ColorPattern);
  });

  it("setI with mininotation '0,3' overrides indices 0 and 3", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const g2 = g.setI("0,3", video("clip.mp4"));
    expect(g2.resolveChild(0, 0.5)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.5)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(2, 0.5)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(3, 0.5)).toBeInstanceOf(VideoPattern);
  });

  it("setI is immutable", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.setI(0, video("clip.mp4"));
    // Original unchanged
    expect(g.resolveChild(0, 0.1)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
  });

  it("setI with mininotation '1' overrides only index 1", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.setI("1", image("pic.png"));
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(1, 0.1)).toBeInstanceOf(ImagePattern);
    expect(g2.resolveChild(2, 0.1)).toBeInstanceOf(ColorPattern);
  });

  it("setI preserves grid-level alpha and fit", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini)
      .alpha("0.5").fit("contain");
    const g2 = g.setI(0, video("clip.mp4"));
    expect(g2.queryArc(0, 1)[0].value.alpha).toBe(0.5);
    expect(g2.fitMode).toBe("contain");
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
  });

  it("setI with numeric index works", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.setI(2, image("pic.png"));
    expect(g2.resolveChild(2, 0.1)).toBeInstanceOf(ImagePattern);
  });

  it("setI with Pattern stores override", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const g2 = g.setI(mini("0"), video("clip.mp4"));
    expect(g2.overrides).toHaveLength(1);
    expect(g2.overrides[0].type).toBe("set");
  });

  it("setI with Pattern resolves index at query time", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const g2 = g.setI(mini("0 2"), video("clip.mp4"));
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.1)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(2, 0.6)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(0, 0.6)).toBeInstanceOf(ColorPattern);
  });

  it("setI with Pattern is immutable", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.setI(mini("0"), video("clip.mp4"));
    expect(g.overrides).toHaveLength(0);
    expect(g2.overrides).toHaveLength(1);
  });

  it("multiple setI overrides stack", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.setI(mini("0"), video("a.mp4")).setI(mini("2"), image("b.png"));
    expect(g2.overrides).toHaveLength(2);
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.1)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(2, 0.1)).toBeInstanceOf(ImagePattern);
  });

  it("setI with '0,3' (stack) overrides both simultaneously", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const g2 = g.setI(mini("0,3"), video("clip.mp4"));
    expect(g2.resolveChild(0, 0.5)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(3, 0.5)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.5)).toBeInstanceOf(ColorPattern);
  });

  // --- modI (all overrides, resolved at query time) ---

  it("modI with number resolves at query time", () => {
    const g = new GridPattern([video("a.mp4"), video("b.mp4"), video("c.mp4")], 3, 1, mini);
    const g2 = g.modI(0, s => s.alpha("0.5"));
    expect(g2.resolveChild(0, 0.1).queryArc(0, 1)[0].value.alpha).toBe(0.5);
    expect(g2.resolveChild(1, 0.1).queryArc(0, 1)[0].value.alpha).toBeUndefined();
  });

  it("modI with mininotation applies to multiple indices", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini);
    const g2 = g.modI("0,2", s => s.alpha("0.3"));
    expect(g2.resolveChild(0, 0.5).queryArc(0, 1)[0].value.alpha).toBe(0.3);
    expect(g2.resolveChild(1, 0.5).queryArc(0, 1)[0].value.alpha).toBeUndefined();
    expect(g2.resolveChild(2, 0.5).queryArc(0, 1)[0].value.alpha).toBe(0.3);
  });

  it("modI is immutable", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.modI(0, s => s.alpha("0.5"));
    expect(g.resolveChild(0, 0.1).queryArc(0, 1)[0].value.alpha).toBeUndefined();
    expect(g2.resolveChild(0, 0.1).queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });

  it("modI with Pattern stores override", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.modI(mini("0"), s => s.alpha("0.5"));
    expect(g2.overrides).toHaveLength(1);
    expect(g2.overrides[0].type).toBe("mod");
  });

  it("modI with Pattern resolves at query time", () => {
    const g = new GridPattern([video("a.mp4"), video("b.mp4"), video("c.mp4")], 3, 1, mini);
    const g2 = g.modI(mini("0 2"), s => s.alpha("0.7"));
    expect(g2.resolveChild(0, 0.1).queryArc(0, 1)[0].value.alpha).toBe(0.7);
    expect(g2.resolveChild(1, 0.1).queryArc(0, 1)[0].value.alpha).toBeUndefined();
    expect(g2.resolveChild(2, 0.6).queryArc(0, 1)[0].value.alpha).toBe(0.7);
  });

  it("modI and setI can be chained", () => {
    const g = new GridPattern([color("red"), color("blue"), color("green")], 3, 1, mini);
    const g2 = g.setI(mini("0"), video("clip.mp4")).modI(mini("1"), s => s.alpha("0.5"));
    expect(g2.overrides).toHaveLength(2);
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.1).queryArc(0, 1)[0].value.alpha).toBe(0.5);
  });

  it("modI with Pattern is immutable", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.modI(mini("0"), s => s.alpha("0.5"));
    expect(g.overrides).toHaveLength(0);
    expect(g2.overrides).toHaveLength(1);
  });

  it("setI then modI on same index: mod applies to the replaced screen", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.setI(mini("0"), video("clip.mp4")).modI(mini("0"), s => s.alpha("0.7"));
    const child = g2.resolveChild(0, 0.1);
    expect(child).toBeInstanceOf(VideoPattern);
    expect(child.queryArc(0, 1)[0].value.alpha).toBe(0.7);
  });

  it("multiple modI on same index stack", () => {
    const g = new GridPattern([color("red"), color("blue")], 2, 1, mini);
    const g2 = g.modI(mini("0"), s => s.alpha("0.5")).modI(mini("0"), s => s.scale("2"));
    const child = g2.resolveChild(0, 0.1);
    const ev = child.queryArc(0, 1)[0].value;
    expect(ev.alpha).toBe(0.5);
    expect(ev.scaleX).toBe(2);
    expect(ev.scaleY).toBe(2);
  });

  // --- dynamic cols/rows ---

  it("accepts mininotation string for cols", () => {
    const g = new GridPattern([color("red")], "2 3", 2, mini);
    expect(g.children).toHaveLength(1); // source children, not expanded
    expect(g.resolveGrid(0.1)).toEqual({ cols: 2, rows: 2 });
    expect(g.resolveGrid(0.6)).toEqual({ cols: 3, rows: 2 });
  });

  it("accepts mininotation string for rows", () => {
    const g = new GridPattern([color("red")], 2, "1 3", mini);
    expect(g.resolveGrid(0.1)).toEqual({ cols: 2, rows: 1 });
    expect(g.resolveGrid(0.6)).toEqual({ cols: 2, rows: 3 });
  });

  it("resolveGrid returns current cols/rows at time t", () => {
    const g = new GridPattern([color("red")], "2 3", "1 2", mini);
    expect(g.resolveGrid(0.1)).toEqual({ cols: 2, rows: 1 });
    expect(g.resolveGrid(0.6)).toEqual({ cols: 3, rows: 2 });
  });

  it("resolveGrid with fixed numbers returns constant values", () => {
    const g = new GridPattern([color("red")], 2, 2, mini);
    expect(g.resolveGrid(0.1)).toEqual({ cols: 2, rows: 2 });
    expect(g.resolveGrid(0.6)).toEqual({ cols: 2, rows: 2 });
  });

  it("accepts Pattern objects for cols/rows", () => {
    const g = new GridPattern([color("red")], mini("2 4"), mini("1 3"), mini);
    expect(g.resolveGrid(0.1)).toEqual({ cols: 2, rows: 1 });
    expect(g.resolveGrid(0.6)).toEqual({ cols: 4, rows: 3 });
  });

  it("dynamic cols/rows preserves through cloning (alpha etc.)", () => {
    const g = new GridPattern([color("red")], "2 3", 2, mini);
    const g2 = g.alpha("0.5");
    expect(g2.resolveGrid(0.1)).toEqual({ cols: 2, rows: 2 });
    expect(g2.resolveGrid(0.6)).toEqual({ cols: 3, rows: 2 });
  });

  it("dynamic cols/rows clamps to at least 1", () => {
    const g = new GridPattern([color("red")], "0 2", "0 2", mini);
    expect(g.resolveGrid(0.1)).toEqual({ cols: 1, rows: 1 });
    expect(g.resolveGrid(0.6)).toEqual({ cols: 2, rows: 2 });
  });

  // --- index wrapping ---

  it("resolveChild wraps cell index to current cell count", () => {
    // At t=0.1: 2x1 = 2 cells. Cell 2 wraps to 0, cell 3 wraps to 1.
    const g = new GridPattern(
      [color("red"), color("blue"), color("green"), color("yellow")], "2", "1 2", mini
    );
    const child0 = g.resolveChild(0, 0.1);
    const child2 = g.resolveChild(2, 0.1);
    expect(child2.queryArc(0, 1)[0].value.color).toBe(child0.queryArc(0, 1)[0].value.color);
  });

  it("setI index wraps to current cell count", () => {
    const g = new GridPattern(
      [color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini
    );
    const g2 = g.setI(mini("4"), video("clip.mp4"));
    // 4 wraps to 0 in a 4-cell grid
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.1)).toBeInstanceOf(ColorPattern);
  });

  it("modI index wraps to current cell count", () => {
    const g = new GridPattern(
      [color("red"), color("blue"), color("green"), color("yellow")], 2, 2, mini
    );
    const g2 = g.modI(mini("4"), s => s.alpha("0.5"));
    expect(g2.resolveChild(0, 0.1).queryArc(0, 1)[0].value.alpha).toBe(0.5);
    expect(g2.resolveChild(1, 0.1).queryArc(0, 1)[0].value.alpha).toBeUndefined();
  });

  it("setI wraps with dynamic grid size", () => {
    // Grid alternates between 2x1 (2 cells) and 2x2 (4 cells)
    const g = new GridPattern(
      [color("red"), color("blue"), color("green"), color("yellow")], 2, "1 2", mini
    );
    // Override index 3: in 2x2 (t=0.6), hits cell 3. In 2x1 (t=0.1), wraps 3 -> 1.
    const g2 = g.setI(mini("3"), video("clip.mp4"));
    expect(g2.resolveChild(3, 0.6)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(1, 0.6)).toBeInstanceOf(ColorPattern);
    expect(g2.resolveChild(1, 0.1)).toBeInstanceOf(VideoPattern);
    expect(g2.resolveChild(0, 0.1)).toBeInstanceOf(ColorPattern);
  });
});
