/**
 * Tests for the .p() label system: anonymous stacking, named overrides, muting, soloing.
 * These test the runtime behavior independent of the transpiler.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mini } from "@strudel/mini";
import { reify } from "@strudel/core";
import { color } from "./color-pattern";

// Mirror the .p() / collectScreens() logic from main.ts for isolated testing
type Screen = { queryArc(begin: number, end: number): any[] };
let pPatterns: Record<string, Screen> = {};
let anonymousIndex = 0;

function resetP() {
  pPatterns = {};
  anonymousIndex = 0;
}

// Install .p() on Pattern.prototype
const PatternProto = Object.getPrototypeOf(reify(0));
PatternProto.p = function (id: string) {
  if (id.startsWith('_') || id.endsWith('_')) return this;
  if (id.includes('$')) {
    id = `${id}${anonymousIndex}`;
    anonymousIndex++;
  }
  pPatterns[id] = this;
  return this;
};

function collectScreens(): Screen[] {
  const patterns: Screen[] = [];
  let soloActive = false;

  for (const [key, pat] of Object.entries(pPatterns)) {
    const isSoloed = key.length > 1 && key.startsWith('S');
    if (isSoloed && !soloActive) {
      patterns.length = 0;
      soloActive = true;
    }
    if (!soloActive || isSoloed) {
      patterns.push(pat);
    }
  }

  return patterns;
}

describe(".p() label system", () => {
  beforeEach(() => resetP());

  describe("anonymous $: stacking", () => {
    it("single $: registers one pattern", () => {
      color("red").p("$");
      expect(collectScreens()).toHaveLength(1);
    });

    it("multiple $: stack in order", () => {
      color("red").p("$");
      color("blue").p("$");
      color("green").p("$");
      const screens = collectScreens();
      expect(screens).toHaveLength(3);
      expect(screens[0].queryArc(0, 1)[0].value.color).toBe("red");
      expect(screens[1].queryArc(0, 1)[0].value.color).toBe("blue");
      expect(screens[2].queryArc(0, 1)[0].value.color).toBe("green");
    });

    it("each $: gets a unique key ($0, $1, ...)", () => {
      color("red").p("$");
      color("blue").p("$");
      expect(Object.keys(pPatterns)).toEqual(["$0", "$1"]);
    });
  });

  describe("named labels", () => {
    it("named label registers with exact key", () => {
      color("red").p("d1");
      expect(Object.keys(pPatterns)).toEqual(["d1"]);
    });

    it("same named label overwrites (last write wins)", () => {
      color("red").p("d1");
      color("blue").p("d1");
      const screens = collectScreens();
      expect(screens).toHaveLength(1);
      expect(screens[0].queryArc(0, 1)[0].value.color).toBe("blue");
    });

    it("different named labels coexist", () => {
      color("red").p("d1");
      color("blue").p("d2");
      expect(collectScreens()).toHaveLength(2);
    });

    it("named and anonymous mix", () => {
      color("red").p("$");
      color("blue").p("d1");
      color("green").p("$");
      expect(collectScreens()).toHaveLength(3);
    });
  });

  describe("muting", () => {
    it("_$ prefix mutes (not registered)", () => {
      color("red").p("_$");
      expect(collectScreens()).toHaveLength(0);
    });

    it("trailing underscore mutes", () => {
      color("red").p("$_");
      expect(collectScreens()).toHaveLength(0);
    });

    it("_d1 mutes a named pattern", () => {
      color("red").p("_d1");
      expect(collectScreens()).toHaveLength(0);
    });

    it("muted patterns don't appear alongside non-muted", () => {
      color("red").p("$");
      color("blue").p("_$");
      color("green").p("$");
      const screens = collectScreens();
      expect(screens).toHaveLength(2);
      expect(screens[0].queryArc(0, 1)[0].value.color).toBe("red");
      expect(screens[1].queryArc(0, 1)[0].value.color).toBe("green");
    });
  });

  describe("soloing", () => {
    it("S prefix solos — only soloed patterns survive", () => {
      color("red").p("$");
      color("blue").p("S$");
      color("green").p("$");
      const screens = collectScreens();
      expect(screens).toHaveLength(1);
      expect(screens[0].queryArc(0, 1)[0].value.color).toBe("blue");
    });

    it("multiple solos all play", () => {
      color("red").p("$");
      color("blue").p("S$");
      color("green").p("S$");
      const screens = collectScreens();
      expect(screens).toHaveLength(2);
      expect(screens[0].queryArc(0, 1)[0].value.color).toBe("blue");
      expect(screens[1].queryArc(0, 1)[0].value.color).toBe("green");
    });

    it("solo named pattern works", () => {
      color("red").p("d1");
      color("blue").p("Sd2");
      const screens = collectScreens();
      expect(screens).toHaveLength(1);
      expect(screens[0].queryArc(0, 1)[0].value.color).toBe("blue");
    });
  });

  describe("returns this for chaining", () => {
    it(".p() returns the screen pattern", () => {
      const c = color("red");
      const result = c.p("$");
      expect(result).toBe(c);
    });

    it("muted .p() still returns the pattern", () => {
      const c = color("red");
      const result = c.p("_$");
      expect(result).toBe(c);
    });
  });
});
