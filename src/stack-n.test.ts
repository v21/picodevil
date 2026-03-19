import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { color } from "./color-pattern";
import { stackN } from "./grid-stack";
import "./index-patterns";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t).map((e: any) => e.value);
}

describe("stackN()", () => {
  it("stacks a single pattern n times", () => {
    const evs = queryAll(stackN(4, color("red")), 0.1);
    expect(evs).toHaveLength(4);
    evs.forEach((ev: any) => expect(ev.color).toBe("red"));
  });

  it("cycles through multiple patterns to fill n slots", () => {
    const evs = queryAll(stackN(4, color("red"), color("blue")), 0.1);
    expect(evs).toHaveLength(4);
    const colors = evs.map((ev: any) => ev.color);
    expect(colors.filter((c: string) => c === "red")).toHaveLength(2);
    expect(colors.filter((c: string) => c === "blue")).toHaveLength(2);
  });

  it("accepts an array of patterns", () => {
    const evs = queryAll(stackN(3, [color("red"), color("blue")]), 0.1);
    expect(evs).toHaveLength(3);
  });

  it("n=1 produces a single event", () => {
    const evs = queryAll(stackN(1, color("red")), 0.1);
    expect(evs).toHaveLength(1);
  });

  it("n fewer than pattern count still cycles correctly", () => {
    const evs = queryAll(stackN(2, color("red"), color("blue"), color("green")), 0.1);
    expect(evs).toHaveLength(2);
  });

  it("variable n within a cycle produces the right total hap count", () => {
    // mini("1 2") → n=1 for [0,0.5), n=2 for [0.5,1): 1+2=3 haps over the cycle
    const pat = color("red").stackN(mini("1 2")).indexCycle();
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    expect(evs).toHaveLength(3);
    const sorted = [...evs].sort((a: any, b: any) => a.i - b.i);
    expect(sorted.map((e: any) => e.i)).toEqual([0, 1, 2]);
    expect(sorted.every((e: any) => e.count === 3)).toBe(true);
  });

  it("method form: pat.stackN(n)", () => {
    const evs = queryAll(color("red").stackN(3), 0.1);
    expect(evs).toHaveLength(3);
    evs.forEach((ev: any) => expect(ev.color).toBe("red"));
  });
});
