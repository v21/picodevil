import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { color } from "./color-pattern";
import { video } from "./video-pattern";
import { image } from "./image-pattern";
import { gridStack, four } from "./grid-stack";
import "./visual-controls";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t + 0.001).map((e: any) => e.value);
}

describe("gridStack", () => {
  it("produces one event per cell", () => {
    const pat = gridStack([color("red"), color("blue")], 2, 1);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
  });

  it("sets correct position for 2x1 grid", () => {
    const pat = gridStack([color("red"), color("blue")], 2, 1);
    const evs = queryAll(pat, 0.1);
    // Sort by x position for deterministic order
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0]).toMatchObject({ color: "red", x: 0, y: 0, width: 0.5, height: 1 });
    expect(evs[1]).toMatchObject({ color: "blue", x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it("sets correct position for 2x2 grid", () => {
    const pat = gridStack([color("red"), color("blue"), color("green"), color("yellow")], 2, 2);
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0]).toMatchObject({ color: "red", x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(evs[1]).toMatchObject({ color: "blue", x: 0.5, y: 0, width: 0.5, height: 0.5 });
    expect(evs[2]).toMatchObject({ color: "green", x: 0, y: 0.5, width: 0.5, height: 0.5 });
    expect(evs[3]).toMatchObject({ color: "yellow", x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it("cycles children when fewer than cells", () => {
    const pat = gridStack([color("red"), color("blue")], 2, 2);
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0].color).toBe("red");
    expect(evs[1].color).toBe("blue");
    expect(evs[2].color).toBe("red");   // cycles
    expect(evs[3].color).toBe("blue");  // cycles
  });

  it("supports mixed screen types", () => {
    const pat = gridStack([color("red"), video("clip.mp4"), image("pic.png")], 3, 1);
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0]._type).toBe("color");
    expect(evs[1]._type).toBe("video");
    expect(evs[2]._type).toBe("image");
  });

  it("children compose with controls independently", () => {
    const pat = gridStack([color("red").alpha(0.5), color("blue")], 2, 1);
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0].alpha).toBe(0.5);
    expect(evs[1].alpha).toBeUndefined();
  });

  it("accepts Pattern for cols (dynamic grid)", () => {
    const pat = gridStack([color("red")], mini("2 4"), 1);
    expect(queryAll(pat, 0.1)).toHaveLength(2);
    expect(queryAll(pat, 0.6)).toHaveLength(4);
  });

  it("accepts Pattern for rows (dynamic grid)", () => {
    const pat = gridStack([color("red")], 1, mini("2 3"));
    expect(queryAll(pat, 0.1)).toHaveLength(2);
    expect(queryAll(pat, 0.6)).toHaveLength(3);
  });
});

describe("four", () => {
  it("is gridStack with 2x2", () => {
    const pat = four([color("red"), color("blue"), color("green"), color("yellow")]);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0]).toMatchObject({ color: "red", width: 0.5, height: 0.5 });
    expect(evs[3]).toMatchObject({ color: "yellow", x: 0.5, y: 0.5 });
  });
});

