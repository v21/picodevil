import { describe, it, expect, beforeEach } from "vitest";
import { color } from "./color-pattern";
import {
  initRegistry,
  resetRegistry,
  collectScreens,
  getNamedScreenIndices,
  isNamedPattern,
} from "./pattern-registry";
import "./visual-controls";

beforeEach(() => {
  resetRegistry();
  initRegistry();
});

describe("isNamedPattern()", () => {
  it("returns false for unregistered names", () => {
    expect(isNamedPattern("foo")).toBe(false);
  });

  it("returns true for a registered named pattern", () => {
    color("red").p("mycomp");
    expect(isNamedPattern("mycomp")).toBe(true);
  });

  it("returns false for anonymous patterns", () => {
    color("red").p("$");
    expect(isNamedPattern("$")).toBe(false);
    // $0 is the auto-indexed form; user never references these
    expect(isNamedPattern("$0")).toBe(false);
    expect(isNamedPattern("foo$bar")).toBe(false);
  });

  it("returns true for solo (S-prefixed) patterns by stripped name", () => {
    color("red").p("Smycomp");
    expect(isNamedPattern("mycomp")).toBe(true);
  });

  it("returns true for H-prefixed patterns by stripped name", () => {
    color("red").p("Hmycomp");
    expect(isNamedPattern("mycomp")).toBe(true);
  });

  it("always returns true for 'all' (reserved)", () => {
    expect(isNamedPattern("all")).toBe(true);
  });

  it("always returns true for 'prev' (reserved)", () => {
    expect(isNamedPattern("prev")).toBe(true);
  });
});

describe("collectScreens() with H prefix", () => {
  it("includes H-prefixed patterns in the screens array", () => {
    color("red").p("Hmycomp");
    const screens = collectScreens();
    expect(screens).toHaveLength(1);
  });

  it("injects _fboOnly:true into events for H-prefixed patterns", () => {
    color("red").p("Hmycomp");
    const screens = collectScreens();
    const evs = screens[0].queryArc(0, 1);
    expect(evs[0].value._fboOnly).toBe(true);
  });

  it("does not inject _fboOnly for normal named patterns", () => {
    color("red").p("mycomp");
    const screens = collectScreens();
    const evs = screens[0].queryArc(0, 1);
    expect(evs[0].value._fboOnly).toBeFalsy();
  });
});

describe(".hide() method", () => {
  it("sets _fboOnly:true on event values", () => {
    color("red").hide().p("mycomp");
    const screens = collectScreens();
    const evs = screens[0].queryArc(0, 1);
    expect(evs[0].value._fboOnly).toBe(true);
  });

  it("does not prevent pattern from being registered", () => {
    color("red").hide().p("mycomp");
    expect(isNamedPattern("mycomp")).toBe(true);
  });
});

describe("getNamedScreenIndices()", () => {
  it("is empty before collectScreens()", () => {
    color("red").p("mycomp");
    expect(getNamedScreenIndices()).toHaveLength(0);
  });

  it("returns named screens with correct indices after collectScreens()", () => {
    color("red").p("$");
    color("blue").p("mycomp");
    color("green").p("other");
    collectScreens();
    const indices = getNamedScreenIndices();
    expect(indices).toHaveLength(2);
    const names = indices.map(i => i.name);
    expect(names).toContain("mycomp");
    expect(names).toContain("other");
  });

  it("includes H-prefixed patterns with stripped name", () => {
    color("red").p("Hmycomp");
    collectScreens();
    const indices = getNamedScreenIndices();
    expect(indices[0].name).toBe("mycomp");
  });

  it("does not include anonymous patterns", () => {
    color("red").p("$");
    color("blue").p("$");
    collectScreens();
    expect(getNamedScreenIndices()).toHaveLength(0);
  });

  it("screenIndex matches the position in the screens array", () => {
    color("red").p("$");       // screenIndex 0 — anonymous, not in namedIndices
    color("blue").p("mycomp"); // screenIndex 1
    const screens = collectScreens();
    const indices = getNamedScreenIndices();
    const entry = indices.find(i => i.name === "mycomp")!;
    expect(entry.screenIndex).toBe(1);
    // Verify the screen at that index produces events for the right color
    const evs = screens[entry.screenIndex].queryArc(0, 1);
    expect(evs[0].value.color).toBe("blue");
  });
});
