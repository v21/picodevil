import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { color } from "./color-pattern";
import { video } from "./video-pattern";
import { image } from "./image-pattern";
import { gridStack } from "./grid-stack";
import { cycle } from "./iterators";
import "./visual-controls";

function takeN(iter: Iterable<any>, n: number): any[] {
  const result: any[] = [];
  for (const item of iter) { result.push(item); if (result.length >= n) break; }
  return result;
}

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t).map((e: any) => e.value);
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

describe("gridStack single pattern", () => {
  it("accepts a single pattern (not wrapped in array)", () => {
    const pat = gridStack(color("red"), 2, 1);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
  });
});

describe("iteratorWith", () => {
  it("produces variants via the callback, pulled by gridStack", () => {
    const pat = gridStack(color("red").iteratorWith((x: any, i: number) => x.alpha(i * 0.5)), 3, 1);
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs).toHaveLength(3);
    expect(evs[0].alpha).toBe(0);
    expect(evs[1].alpha).toBe(0.5);
    expect(evs[2].alpha).toBe(1);
  });

  it("gridStack pulls exactly cols*rows items", () => {
    const pat = gridStack(color("red").iteratorWith((x: any, i: number) => x.alpha(i / 5)), 2, 2);
    expect(queryAll(pat, 0.1)).toHaveLength(4);
  });

  it("works with dynamic cols via Pattern", () => {
    const pat = gridStack(color("red").iteratorWith((x: any, i: number) => x.alpha(i / 5)), mini("2 3"), 1);
    expect(queryAll(pat, 0.1)).toHaveLength(2);
    expect(queryAll(pat, 0.6)).toHaveLength(3);
  });

  it("iterator() fills all cells with copies of the pattern", () => {
    const pat = gridStack(color("red").iterator(), 2, 2);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    evs.forEach((ev: any) => expect(ev.color).toBe("red"));
  });

  it("accepts any iterable — gridStack consumes cols*rows items", () => {
    function* variants() { yield color("red"); yield color("blue"); yield color("green"); yield color("yellow"); }
    const pat = gridStack(variants(), 2, 2);
    expect(queryAll(pat, 0.1)).toHaveLength(4);
  });
});

describe("cycle", () => {
  it("round-robins between args, cycling arrays independently", () => {
    const a = color("red"), b = color("blue"), c = color("green");
    const items = takeN(cycle([a, b], c), 6);
    expect(items[0]).toBe(a);
    expect(items[1]).toBe(c);
    expect(items[2]).toBe(b);
    expect(items[3]).toBe(c);
    expect(items[4]).toBe(a);
    expect(items[5]).toBe(c);
  });

  it("single patterns repeat", () => {
    const a = color("red"), b = color("blue");
    const items = takeN(cycle(a, b), 4);
    expect(items).toEqual([a, b, a, b]);
  });

  it("works with gridStack", () => {
    const pat = gridStack(cycle(color("red"), color("blue")), 2, 1);
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.x - b.x);
    expect(evs[0].color).toBe("red");
    expect(evs[1].color).toBe("blue");
  });
});

describe("gridStack default cols/rows", () => {
  it("defaults rows to cols when rows is omitted", () => {
    const pat = gridStack([color("red"), color("blue"), color("green"), color("yellow")], 2);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0]).toMatchObject({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(evs[3]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("defaults cols and rows both to 2 when omitted", () => {
    const pat = gridStack([color("red"), color("blue"), color("green"), color("yellow")]);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    evs.sort((a: any, b: any) => a.y * 10 + a.x - (b.y * 10 + b.x));
    expect(evs[0]).toMatchObject({ x: 0, y: 0, width: 0.5, height: 0.5 });
  });
});

