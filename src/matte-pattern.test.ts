/**
 * Pattern-side `.matte()`: auto-FBO registration, mix params, argument
 * validation (teaching error), solo retention, and per-eval counter reset.
 *
 * Shares the `__auto_mod_*` auto-FBO lifecycle with `.modulate()`, so the
 * registration/ordering/solo behaviour is deliberately identical — see
 * modulate-pattern.test.ts for the modulate-side twin.
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

describe(".matte() event stamping", () => {
  it("stamps matteSrc (auto name) and default matteAmt 1 on consumer events", () => {
    const p = (color("red") as any).matte(screen("blue"));
    const evs = p.queryArc(0, 1);
    expect(evs[0].value.matteSrc).toBe(`${AUTO_MOD_PREFIX}0`);
    expect(Number(evs[0].value.matteAmt)).toBeCloseTo(1);
  });

  it("passes an explicit amt through (patternable)", () => {
    const p = (color("red") as any).matte(screen("blue"), 0.4);
    expect(Number(p.queryArc(0, 1)[0].value.matteAmt)).toBeCloseTo(0.4);
  });

  it("each call site gets its own auto name", () => {
    const a = (color("red") as any).matte(screen("blue"));
    const b = (color("green") as any).matte(screen("cyan"));
    expect(a.queryArc(0, 1)[0].value.matteSrc).toBe(`${AUTO_MOD_PREFIX}0`);
    expect(b.queryArc(0, 1)[0].value.matteSrc).toBe(`${AUTO_MOD_PREFIX}1`);
  });

  it("shares the auto-name counter with .modulate()", () => {
    const a = (color("red") as any).modulate(screen("blue"));
    const b = (color("green") as any).matte(screen("cyan"));
    expect(a.queryArc(0, 1)[0].value.modSrc).toBe(`${AUTO_MOD_PREFIX}0`);
    expect(b.queryArc(0, 1)[0].value.matteSrc).toBe(`${AUTO_MOD_PREFIX}1`);
  });

  it(".mattespace() stamps ev.matteSpace", () => {
    const p = (color("red") as any).matte(screen("blue")).mattespace('screen');
    expect(p.queryArc(0, 1)[0].value.matteSpace).toBe('screen');
  });

  it("matte and modulate coexist on one chain with independent spaces", () => {
    const p = (color("red") as any)
      .modulate(screen("blue"), 0.2).modspace('tile')
      .matte(screen("cyan"), 0.5).mattespace('screen');
    const v = p.queryArc(0, 1)[0].value;
    expect(v.modSrc).toBe(`${AUTO_MOD_PREFIX}0`);
    expect(v.matteSrc).toBe(`${AUTO_MOD_PREFIX}1`);
    expect(v.modSpace).toBe('tile');
    expect(v.matteSpace).toBe('screen');
  });

  it("counter resets with the registry (stable names across re-evals)", () => {
    (color("red") as any).matte(screen("blue"));
    resetRegistry();
    const p = (color("red") as any).matte(screen("blue"));
    expect(p.queryArc(0, 1)[0].value.matteSrc).toBe(`${AUTO_MOD_PREFIX}0`);
  });
});

describe(".matte() auto-FBO registration", () => {
  it("registers a hidden (_fboOnly) screen producing the matte's events", () => {
    (color("red") as any).matte(screen("blue"), 0.2).p("$");
    const screens = collectScreens();
    expect(screens).toHaveLength(2);
    const auto = getNamedScreenIndices().find(i => i.name === `${AUTO_MOD_PREFIX}0`)!;
    expect(auto).toBeDefined();
    const evs = screens[auto.screenIndex].queryArc(0, 1);
    expect(evs[0].value._fboOnly).toBe(true);
    expect(evs[0].value._type).toBe('color');
    expect(evs[0].value.color).toBe('blue');
  });

  it("auto layer renders before its consumer (earlier screenIndex)", () => {
    (color("red") as any).matte(screen("blue")).p("$");
    collectScreens();
    const auto = getNamedScreenIndices().find(i => i.name === `${AUTO_MOD_PREFIX}0`)!;
    expect(auto.screenIndex).toBe(0);
  });

  it("solo (S-prefix) retains the matte's auto layer", () => {
    (color("red") as any).matte(screen("blue")).p("Sfoo");
    color("green").p("other");
    const screens = collectScreens();
    const names = getNamedScreenIndices().map(i => i.name);
    expect(names).toContain(`${AUTO_MOD_PREFIX}0`);
    expect(names).toContain("foo");
    expect(names).not.toContain("other");
    expect(screens).toHaveLength(2);
  });
});

describe(".matte() argument validation (teaching error)", () => {
  it("throws on a JS string argument", () => {
    expect(() => (color("red") as any).matte('mylayer')).toThrow(/wrap the name/);
  });

  it("names itself in the teaching error", () => {
    expect(() => (color("red") as any).matte('mylayer')).toThrow(/\.matte\(/);
  });

  it("throws on a string-valued pattern (the double-quote mini() mistake)", () => {
    expect(() => (color("red") as any).matte(mini("mylayer"))).toThrow(/wrap the name/);
  });

  it("throws on a non-pattern argument", () => {
    expect(() => (color("red") as any).matte(42)).toThrow(/wrap the name/);
  });

  it("accepts a screen-event pattern", () => {
    expect(() => (color("red") as any).matte(screen("blue"))).not.toThrow();
  });

  it("accepts an empty/unprobeable pattern (fails soft later)", () => {
    expect(() => (color("red") as any).matte(silence)).not.toThrow();
  });
});
