import { describe, it, expect } from "vitest";
import { stack } from "@strudel/core";
import { mini } from "@strudel/mini";
import { color } from "./color-pattern";
import "./visual-controls";
import { index, indexCycle, indexWith, indexCycleWith } from "./index-patterns";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t).map((e: any) => e.value);
}

// ─── value setters ────────────────────────────────────────────────────────────

describe(".i()", () => {
  it("sets i on the event value", () => {
    const evs = queryAll(color("red").i(3), 0);
    expect(evs[0].i).toBe(3);
  });

  it("accepts a pattern", () => {
    const evs0 = queryAll(color("red").i(mini("0 1")), 0.1);
    const evs1 = queryAll(color("red").i(mini("0 1")), 0.6);
    expect(evs0[0].i).toBe(0);
    expect(evs1[0].i).toBe(1);
  });
});

describe(".count()", () => {
  it("sets count on the event value", () => {
    const evs = queryAll(color("red").count(4), 0);
    expect(evs[0].count).toBe(4);
  });
});

describe(".rows() / .cols() / .rowscols()", () => {
  it(".rows() sets rows", () => {
    expect(queryAll(color("red").rows(3), 0)[0].rows).toBe(3);
  });

  it(".cols() sets cols", () => {
    expect(queryAll(color("red").cols(4), 0)[0].cols).toBe(4);
  });

  it(".rowscols() sets both rows and cols", () => {
    const ev = queryAll(color("red").rowscols(3), 0)[0];
    expect(ev.rows).toBe(3);
    expect(ev.cols).toBe(3);
  });

  it(".rowscols() accepts a pattern", () => {
    const ev0 = queryAll(color("red").rowscols(mini("2 4")), 0.1)[0];
    const ev1 = queryAll(color("red").rowscols(mini("2 4")), 0.6)[0];
    expect(ev0.rows).toBe(2);
    expect(ev0.cols).toBe(2);
    expect(ev1.rows).toBe(4);
    expect(ev1.cols).toBe(4);
  });
});

// ─── indexCycle ───────────────────────────────────────────────────────────────

describe("indexCycle()", () => {
  it("labels haps in cycle order with i and count", () => {
    const pat = indexCycle(color("red"), color("blue"));
    // query across whole cycle to see both
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    const red = evs.find((v: any) => v.color === "red");
    const blue = evs.find((v: any) => v.color === "blue");
    expect(red.i).toBe(0);
    expect(blue.i).toBe(1);
    expect(red.count).toBe(2);
    expect(blue.count).toBe(2);
  });

  it("method form: stack(a, b).indexCycle()", () => {
    const pat = stack(color("red"), color("blue")).indexCycle();
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    const red = evs.find((v: any) => v.color === "red");
    const blue = evs.find((v: any) => v.color === "blue");
    expect(red.i).toBe(0);
    expect(blue.i).toBe(1);
    expect(red.count).toBe(2);
  });

  it("flattens array args", () => {
    const pat = indexCycle([color("red"), color("blue")], color("green"));
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    expect(evs.find((v: any) => v.color === "green").i).toBe(2);
    expect(evs[0].count).toBe(3);
  });

  it("labels haps in temporal order within a cycle", () => {
    // "a b" has two haps: a at 0-0.5, b at 0.5-1 — they get i:0, i:1
    const pat = indexCycle(color("red blue"));
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    evs.sort((a: any, b: any) => a.i - b.i);
    expect(evs[0].color).toBe("red");
    expect(evs[0].i).toBe(0);
    expect(evs[1].color).toBe("blue");
    expect(evs[1].i).toBe(1);
    expect(evs[0].count).toBe(2);
  });
});

describe("indexCycleWith()", () => {
  it("uses custom labels instead of i and count", () => {
    const pat = indexCycleWith("slot", "total", color("red"), color("blue"));
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    const red = evs.find((v: any) => v.color === "red");
    expect(red.slot).toBe(0);
    expect(red.total).toBe(2);
    expect(red.i).toBeUndefined();
  });
});

// ─── index ────────────────────────────────────────────────────────────────────

describe("index()", () => {
  it("labels co-active haps at query time", () => {
    // stack("a", "b") — both active simultaneously
    const pat = index(color("red"), color("blue"));
    const evs = queryAll(pat, 0.1);
    evs.sort((a: any, b: any) => a.i - b.i);
    expect(evs).toHaveLength(2);
    expect(evs[0].i).toBe(0);
    expect(evs[1].i).toBe(1);
    expect(evs[0].count).toBe(2);
  });

  it("i resets per query — sequential haps get i:0 when alone", () => {
    // "a b" — at t=0.1 only "a" is active, at t=0.6 only "b" is active
    const pat = index(color("red blue"));
    const early = queryAll(pat, 0.1);
    const late = queryAll(pat, 0.6);
    expect(early[0].i).toBe(0);
    expect(early[0].count).toBe(1);
    expect(late[0].i).toBe(0);
    expect(late[0].count).toBe(1);
  });

  it("two stacked patterns: i stays stable across queries", () => {
    // stack("a b", "c") — a/c both active at 0.1, b/c both active at 0.6
    const pat = index(color("red blue"), color("green"));
    const early = queryAll(pat, 0.1);
    const late = queryAll(pat, 0.6);
    expect(early).toHaveLength(2);
    expect(late).toHaveLength(2);
    expect(early.map((v: any) => v.count)).toEqual([2, 2]);
    expect(late.map((v: any) => v.count)).toEqual([2, 2]);
  });

  it("method form: stack(a,b).index()", () => {
    const pat = stack(color("red"), color("blue")).index();
    const evs = queryAll(pat, 0.1);
    expect(evs.map((v: any) => v.i).sort()).toEqual([0, 1]);
  });

  it("flattens array args", () => {
    const pat = index([color("red"), color("blue")], color("green"));
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(3);
    expect(evs.map((v: any) => v.count)).toEqual([3, 3, 3]);
  });
});

describe("indexWith()", () => {
  it("uses custom labels", () => {
    const pat = indexWith("slot", "total", color("red"), color("blue"));
    const evs = queryAll(pat, 0.1);
    expect(evs.every((v: any) => v.slot !== undefined)).toBe(true);
    expect(evs.every((v: any) => v.i === undefined)).toBe(true);
  });
});

// ─── .grid() new signature ────────────────────────────────────────────────────

describe(".grid() reading from values", () => {
  it("no args: reads i, rows, cols from value", () => {
    const pat = color("red").i(1).rows(2).cols(2).grid();
    const evs = queryAll(pat, 0.1);
    expect(evs[0]).toMatchObject({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it("explicit rows/cols args override value", () => {
    const pat = color("red").i(2).grid(2, 2);
    const evs = queryAll(pat, 0.1);
    // i=2 from value, rows=2 cols=2 from args → cell 2 = bottom-left
    expect(evs[0]).toMatchObject({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
  });

  it("explicit rows/cols/i args, fully explicit", () => {
    const pat = color("red").grid(2, 2, 3);
    const evs = queryAll(pat, 0.1);
    expect(evs[0]).toMatchObject({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it("only rows set: cols defaults to 1", () => {
    const pat = color("red").i(1).grid(2);
    const evs = queryAll(pat, 0.1);
    // rows=2, cols=1, i=1 from value → cell 1 = bottom (x:0, y:0.5, w:1, h:0.5)
    expect(evs[0]).toMatchObject({ x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it("no args, no values: defaults to 2x2, i:0", () => {
    const pat = color("red").grid();
    const evs = queryAll(pat, 0.1);
    expect(evs[0]).toMatchObject({ x: 0, y: 0, width: 0.5, height: 0.5 });
  });

  it("composes with existing position (nested grids)", () => {
    const pat = color("red").i(0).rows(2).cols(2).grid().i(0).rows(2).cols(2).grid();
    const evs = queryAll(pat, 0.1);
    // cell 0 of a 2x2, then cell 0 of a 2x2 within that → top-left quarter of top-left quarter
    expect(evs[0]).toMatchObject({ x: 0, y: 0, width: 0.25, height: 0.25 });
  });
});

// ─── .gridMod() ───────────────────────────────────────────────────────────────

describe(".gridMod()", () => {
  it("positions pattern across cells based on i, count, cols, rows from values", () => {
    // 2 patterns in a 2x2 grid: i:0 gets cells 0,2; i:1 gets cells 1,3
    const a = color("red").i(0).count(2).rows(2).cols(2).gridMod();
    const b = color("blue").i(1).count(2).rows(2).cols(2).gridMod();
    const pat = stack(a, b);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    const reds = evs.filter((v: any) => v.color === "red");
    const blues = evs.filter((v: any) => v.color === "blue");
    expect(reds).toHaveLength(2);
    expect(blues).toHaveLength(2);
    reds.sort((a: any, b: any) => a.y - b.y);
    expect(reds[0]).toMatchObject({ x: 0, y: 0 });
    expect(reds[1]).toMatchObject({ x: 0, y: 0.5 });
  });

  it("explicit args override values", () => {
    const pat = color("red").i(0).count(2).gridMod(2, 2);
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(2);
  });

  it("no cells produced if i >= cols*rows", () => {
    const pat = color("red").i(5).count(2).rows(2).cols(2).gridMod();
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(0);
  });

  it("full chain: stack.index().rowscols().gridMod()", () => {
    const pat = stack(color("red"), color("blue"))
      .index()
      .rowscols(2)
      .gridMod();
    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    const reds = evs.filter((v: any) => v.color === "red");
    const blues = evs.filter((v: any) => v.color === "blue");
    expect(reds).toHaveLength(2);
    expect(blues).toHaveLength(2);
  });
});
