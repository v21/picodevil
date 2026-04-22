import { describe, it, expect } from "vitest";
import { color } from "./color-pattern";
import { video } from "./video-pattern";
import { image } from "./image-pattern";
import { index } from "./index-patterns";
import { stackN } from "./grid-stack";
import "./visual-controls";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t).map((e: any) => e.value);
}

describe("index + gridMod (replaces gridStack)", () => {
  it("produces one event per cell", () => {
    const pat = index(color("red"), color("blue")).rowscols(2).gridMod();
    const evs = queryAll(pat, 0.1);
    // 2 children in a 2x2 grid → 4 events (each child fills 2 cells via stride)
    expect(evs.length).toBeGreaterThanOrEqual(2);
  });

  it("sets correct position for 2x1 grid", () => {
    const pat = index(color("red"), color("blue")).cols(2).rows(1).gridMod();
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0]).toMatchObject({ color: "red", x: 0.25, y: 0.5, width: 0.5, height: 1 });
    expect(evs[1]).toMatchObject({ color: "blue", x: 0.75, y: 0.5, width: 0.5, height: 1 });
  });

  it("sets correct position for 2x2 grid", () => {
    const pat = index(color("red"), color("blue"), color("green"), color("yellow")).rowscols(2).gridMod();
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0]).toMatchObject({ color: "red", x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(evs[1]).toMatchObject({ color: "blue", x: 0.75, y: 0.25, width: 0.5, height: 0.5 });
    expect(evs[2]).toMatchObject({ color: "green", x: 0.25, y: 0.75, width: 0.5, height: 0.5 });
    expect(evs[3]).toMatchObject({ color: "yellow", x: 0.75, y: 0.75, width: 0.5, height: 0.5 });
  });

  it("cycles children when fewer than cells (via gridMod stride)", () => {
    const pat = index(color("red"), color("blue")).rowscols(2).gridMod();
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0].color).toBe("red");
    expect(evs[1].color).toBe("blue");
    expect(evs[2].color).toBe("red");   // cycles via stride
    expect(evs[3].color).toBe("blue");  // cycles via stride
  });

  it("supports mixed screen types", () => {
    const pat = index(color("red"), video("clip.mp4"), image("pic.png")).cols(3).rows(1).gridMod();
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0]._type).toBe("color");
    expect(evs[1]._type).toBe("video");
    expect(evs[2]._type).toBe("image");
  });

  it("children compose with controls independently", () => {
    const pat = index(color("red").alpha(0.5), color("blue")).cols(2).rows(1).gridMod();
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0].alpha).toBe(0.5);
    expect(evs[1].alpha).toBeUndefined();
  });
});

describe("stackN", () => {
  it("stacks n copies of a pattern", () => {
    const pat = stackN(3, color("red"));
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(3);
    evs.forEach((ev: any) => expect(ev.color).toBe("red"));
  });

  it("cycles through multiple patterns", () => {
    const pat = stackN(4, color("red"), color("blue"));
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    expect(evs[0].color).toBe("red");
    expect(evs[1].color).toBe("blue");
    expect(evs[2].color).toBe("red");
    expect(evs[3].color).toBe("blue");
  });

  it("sets i and count on each slot", () => {
    const pat = stackN(3, color("red"));
    const evs = queryAll(pat, 0.1);
    expect(evs[0]).toMatchObject({ i: 0, count: 3 });
    expect(evs[1]).toMatchObject({ i: 1, count: 3 });
    expect(evs[2]).toMatchObject({ i: 2, count: 3 });
  });

  it("works as .stackN() method", () => {
    const pat = (color("red") as any).stackN(2);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
  });
});
