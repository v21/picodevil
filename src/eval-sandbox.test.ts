import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { video } from "./video-pattern";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import { echo } from "./visual-controls"; // side effect: registers all Pattern.prototype controls
import "./pattern-extensions";            // side effect: registers lerp, spline, chopStack, etc.
import { getPatternGlobals } from "./eval-sandbox";

function query(pat: any, t = 0.1) {
  return pat.queryArc(t, t).map((e: any) => e.value);
}

describe("getPatternGlobals curried method wrappers", () => {
  it("ply is a curried wrapper producing a Pattern", () => {
    const globals = getPatternGlobals();
    expect(typeof globals.ply).toBe("function");
    const transform = (globals.ply as any)(2);
    expect(typeof transform).toBe("function");
    const result = transform(mini("a b"));
    expect(query(result).length).toBeGreaterThan(0);
  });

  it("rev is a curried wrapper that reverses events", () => {
    const globals = getPatternGlobals();
    expect(typeof globals.rev).toBe("function");
    const result = (globals.rev as any)()(mini("a b"));
    expect(query(result).length).toBeGreaterThan(0);
  });

  it("speed is a curried wrapper setting speed on video events", () => {
    const globals = getPatternGlobals();
    expect(typeof globals.speed).toBe("function");
    const result = (globals.speed as any)(2)(video("x.mp4"));
    const evs = query(result);
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].speed).toBe(2);
  });

  it("grey is a curried wrapper setting grey on events", () => {
    const globals = getPatternGlobals();
    expect(typeof globals.grey).toBe("function");
    const result = (globals.grey as any)(-1)(color("red"));
    const evs = query(result);
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].grey).toBe(-1);
  });

  it("explicit globals are not overridden by method wrappers", () => {
    const globals = getPatternGlobals();
    expect(globals.color).toBe(color);
    expect(globals.screen).toBe(screen);
    expect(globals.echo).toBe(echo);
    expect(globals.mini).toBe(mini);
  });

  it("internal methods are not exposed", () => {
    const globals = getPatternGlobals();
    expect(globals.queryArc).toBeUndefined();
    expect(globals.fmap).toBeUndefined();
    expect(globals.withValue).toBeUndefined();
    expect(globals.p).toBeUndefined();
  });
});

// Strudel exposes zero-argument transforms as `rev(pat)`, so `.sometimes(rev)` and
// `.every(4, palindrome)` pass them bare. Ours must apply too, not return a factory.
describe("bare zero-argument transforms", () => {
  const srcs = (pat: any, t = 0.1) => query(pat, t).map((v: any) => v.src);

  it("rev applied to a pattern reverses it", () => {
    const g: any = getPatternGlobals();
    const result = g.rev(mini("a b"));
    expect(typeof result.query).toBe("function");
    expect(query(result)).toEqual(["b"]);
  });

  it("sometimesBy(1, rev) reverses every event instead of replacing it", () => {
    const g: any = getPatternGlobals();
    const pat = video(mini("a.mp4 b.mp4"));
    expect(srcs(pat.sometimesBy(1, g.rev))).toEqual(srcs(pat.rev()));
  });

  it("inside(2, rev) works bare", () => {
    const g: any = getPatternGlobals();
    const pat = video(mini("a.mp4 b.mp4 c.mp4 d.mp4"));
    expect(srcs(pat.inside(2, g.rev))).toEqual(srcs(pat.inside(2, (x: any) => x.rev())));
  });

  it("picodevil's own zero-arg methods (tile) work bare", () => {
    const g: any = getPatternGlobals();
    const result = g.tile(color(mini("red")));
    expect(typeof result.query).toBe("function");
    expect(query(result)[0].width).toBe(1);
  });

  it("methods that take arguments stay factories, even when given a pattern", () => {
    const g: any = getPatternGlobals();
    expect(typeof g.fast(mini("2"))).toBe("function");
    expect(typeof g.fit(mini("contain"))).toBe("function"); // optional arg: ambiguous, so factory
  });

  it("an unapplied wrapper that ends up as an event value is tagged with its method name", () => {
    const g: any = getPatternGlobals();
    const evs = query(video(mini("a.mp4")).sometimesBy(1, g.fast));
    expect(evs).toHaveLength(1);
    expect(evs[0]._type).toBeUndefined();
    expect(evs[0]._pdMethod).toBe("fast");
  });
});
