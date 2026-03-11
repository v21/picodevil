import { describe, it, expect } from "vitest";
import { stack } from "@strudel/core";
import { color } from "./color-pattern";
import { autoseed } from "./index-patterns";
import "./visual-controls";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t + 0.001).map((e: any) => e.value);
}

describe("autoseed()", () => {
  it("sets a numeric seed on each event", () => {
    const pat = autoseed(color("red"), color("blue"));
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    expect(evs.every((v: any) => typeof v.seed === "number")).toBe(true);
  });

  it("different patterns in the same cycle get different seeds", () => {
    const pat = autoseed(color("red"), color("blue"));
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    const seeds = evs.map((v: any) => v.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("same position in different cycles gets different seeds", () => {
    const pat = autoseed(color("red"), color("blue"));
    const cycle0 = queryAll(pat, 0.1);
    const cycle1 = queryAll(pat, 1.1);
    expect(cycle0[0].seed).not.toBe(cycle1[0].seed);
  });

  it("is deterministic — same query always returns same seed", () => {
    const pat = autoseed(color("red"), color("blue"));
    const a = queryAll(pat, 0.1);
    const b = queryAll(pat, 0.1);
    expect(a[0].seed).toBe(b[0].seed);
  });

  it("different event values produce different seeds (at same position)", () => {
    const patRed = autoseed(color("red"), color("blue"));
    const patGreen = autoseed(color("green"), color("blue"));
    const redSeed = queryAll(patRed, 0.1)[0].seed;
    const greenSeed = queryAll(patGreen, 0.1)[0].seed;
    expect(redSeed).not.toBe(greenSeed);
  });

  it("method form: stack(a, b).autoseed()", () => {
    const pat = stack(color("red"), color("blue")).autoseed();
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    expect(evs.every((v: any) => typeof v.seed === "number")).toBe(true);
  });

  it("flattens array args", () => {
    const pat = autoseed([color("red"), color("blue")], color("green"));
    const evs = pat.queryArc(0, 1).map((e: any) => e.value);
    expect(evs).toHaveLength(3);
  });
});
