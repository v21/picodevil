/**
 * Pattern-side `.modulate()`: auto-FBO registration, mix params, argument
 * validation (teaching error), solo retention, and per-eval counter reset.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mini } from "@strudel/mini";
import { silence } from "@strudel/core";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import {
  initRegistry, resetRegistry, collectScreens, getNamedScreenIndices,
} from "./pattern-registry";
import { AUTO_MOD_PREFIX } from "./renderer-interface";
import "./visual-controls";

beforeEach(() => {
  resetRegistry();
  initRegistry();
});

describe(".modulate() event stamping", () => {
  it("stamps modSrc (auto name) and default modAmt 0.1 on consumer events", () => {
    const p = (color("red") as any).modulate(screen("blue"));
    const evs = p.queryArc(0, 1);
    expect(evs[0].value.modSrc).toBe(`${AUTO_MOD_PREFIX}0`);
    expect(Number(evs[0].value.modAmt)).toBeCloseTo(0.1);
  });

  it("passes an explicit amt through (patternable)", () => {
    const p = (color("red") as any).modulate(screen("blue"), 0.4);
    expect(Number(p.queryArc(0, 1)[0].value.modAmt)).toBeCloseTo(0.4);
  });

  it("each call site gets its own auto name", () => {
    const a = (color("red") as any).modulate(screen("blue"));
    const b = (color("green") as any).modulate(screen("cyan"));
    expect(a.queryArc(0, 1)[0].value.modSrc).toBe(`${AUTO_MOD_PREFIX}0`);
    expect(b.queryArc(0, 1)[0].value.modSrc).toBe(`${AUTO_MOD_PREFIX}1`);
  });

  it(".modspace() stamps ev.modSpace", () => {
    const p = (color("red") as any).modulate(screen("blue")).modspace('screen');
    expect(p.queryArc(0, 1)[0].value.modSpace).toBe('screen');
  });

  it("counter resets with the registry (stable names across re-evals)", () => {
    (color("red") as any).modulate(screen("blue"));
    resetRegistry();
    const p = (color("red") as any).modulate(screen("blue"));
    expect(p.queryArc(0, 1)[0].value.modSrc).toBe(`${AUTO_MOD_PREFIX}0`);
  });
});

describe(".modulate() auto-FBO registration", () => {
  it("registers a hidden (_fboOnly) screen producing the modulator's events", () => {
    (color("red") as any).modulate(screen("blue"), 0.2).p("$");
    const screens = collectScreens();
    expect(screens).toHaveLength(2);
    const indices = getNamedScreenIndices();
    const auto = indices.find(i => i.name === `${AUTO_MOD_PREFIX}0`)!;
    expect(auto).toBeDefined();
    const evs = screens[auto.screenIndex].queryArc(0, 1);
    expect(evs[0].value._fboOnly).toBe(true);
    expect(evs[0].value._type).toBe('color');
    expect(evs[0].value.color).toBe('blue');
  });

  it("auto layer renders before its consumer (earlier screenIndex)", () => {
    (color("red") as any).modulate(screen("blue")).p("$");
    collectScreens();
    const auto = getNamedScreenIndices().find(i => i.name === `${AUTO_MOD_PREFIX}0`)!;
    // Consumer is the anonymous screen; the auto layer must come first.
    expect(auto.screenIndex).toBe(0);
  });

  it("nested modulates register innermost-first", () => {
    const inner = (screen("blue") as any).modulate(screen("cyan"), 0.2);
    (color("red") as any).modulate(inner, 0.1).p("$");
    collectScreens();
    const names = getNamedScreenIndices().map(i => i.name);
    expect(names.indexOf(`${AUTO_MOD_PREFIX}0`)).toBeLessThan(names.indexOf(`${AUTO_MOD_PREFIX}1`));
    // The outer auto layer's events carry the inner's modSrc.
    const screens = collectScreens();
    const outer = getNamedScreenIndices().find(i => i.name === `${AUTO_MOD_PREFIX}1`)!;
    const evs = screens[outer.screenIndex].queryArc(0, 1);
    expect(evs[0].value.modSrc).toBe(`${AUTO_MOD_PREFIX}0`);
  });

  it("solo (S-prefix) retains auto-mod layers", () => {
    (color("red") as any).modulate(screen("blue")).p("Sfoo");
    color("green").p("other");
    const screens = collectScreens();
    // Soloing "foo" keeps its modulator layer alive, drops "other".
    const names = getNamedScreenIndices().map(i => i.name);
    expect(names).toContain(`${AUTO_MOD_PREFIX}0`);
    expect(names).toContain("foo");
    expect(names).not.toContain("other");
    expect(screens).toHaveLength(2);
  });
});

describe(".modulate() argument validation (teaching error)", () => {
  it("throws on a JS string argument", () => {
    expect(() => (color("red") as any).modulate('mylayer'))
      .toThrow(/wrap the name/);
  });

  it("throws on a string-valued pattern (the double-quote mini() mistake)", () => {
    expect(() => (color("red") as any).modulate(mini("mylayer")))
      .toThrow(/wrap the name/);
  });

  it("throws on a non-pattern argument", () => {
    expect(() => (color("red") as any).modulate(42))
      .toThrow(/wrap the name/);
  });

  it("accepts a screen-event pattern", () => {
    expect(() => (color("red") as any).modulate(screen("blue"))).not.toThrow();
  });

  it("accepts an empty/unprobeable pattern (fails soft later)", () => {
    expect(() => (color("red") as any).modulate(silence)).not.toThrow();
  });
});
