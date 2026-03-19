import { describe, it, expect } from "vitest";
import { transpile, type WidgetCallInfo } from "./transpiler";

/** Normalize quotes for comparison (escodegen uses single quotes). */
function norm(s: string): string {
  return s.replace(/"/g, "'");
}

describe("transpiler", () => {
  describe("labeled statements", () => {
    it("rewrites $: to .p('$')", () => {
      const { code } = transpile('$: color("red")');
      expect(norm(code)).toContain(".p('$')");
    });

    it("rewrites named labels like d1:", () => {
      const { code } = transpile('d1: video("clip.mp4")');
      expect(norm(code)).toContain(".p('d1')");
    });

    it("rewrites muted labels _$:", () => {
      const { code } = transpile('_$: color("red")');
      expect(norm(code)).toContain(".p('_$')");
    });

    it("rewrites muted labels with trailing underscore $_:", () => {
      const { code } = transpile('$_: color("red")');
      expect(norm(code)).toContain(".p('$_')");
    });

    it("rewrites soloed labels S$:", () => {
      const { code } = transpile('S$: color("red")');
      expect(norm(code)).toContain(".p('S$')");
    });

    it("preserves the expression body", () => {
      const { code } = transpile('$: video("clip.mp4").speed("0.5 1")');
      expect(norm(code)).toContain("video(mini('clip.mp4'))");
      expect(norm(code)).toContain(".speed(mini('0.5 1'))");
    });

    it("handles multiple labeled statements", () => {
      const src = `$: color("red")
$: video("clip.mp4")`;
      const { code } = transpile(src);
      expect(norm(code)).toContain("color(mini('red')).p('$')");
      expect(norm(code)).toContain("video(mini('clip.mp4')).p('$')");
    });

    it("passes through non-labeled statements", () => {
      const { code } = transpile('let x = 5');
      expect(code).toContain('x');
      expect(code).toContain('5');
      expect(code).not.toContain('.p(');
    });

    it("handles mixed labeled and non-labeled", () => {
      const src = `let x = 1
$: color("red")
let y = 2`;
      const { code } = transpile(src);
      expect(norm(code)).toContain(".p('$')");
      expect(norm(code)).toContain('x');
      expect(norm(code)).toContain('y');
    });
  });

  describe("double-quoted string rewriting", () => {
    it("rewrites double-quoted strings to mini() calls", () => {
      const { code } = transpile('color("red")');
      expect(norm(code)).toContain("color(mini('red'))");
    });

    it("leaves single-quoted strings as-is", () => {
      const { code } = transpile("color('red')");
      expect(norm(code)).toContain("color('red')");
      expect(norm(code)).not.toContain("mini(");
    });

    it("handles mixed quotes", () => {
      const { code } = transpile(`image("a.png").urlBase('https://x.com/')`);
      expect(norm(code)).toContain("image(mini('a.png'))");
      expect(norm(code)).toContain(".urlBase('https://x.com/')");
    });
  });

  describe("widget extraction", () => {
    it("extracts slider call positions", () => {
      const src = 'slider(0.5, 0, 1)';
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(1);
      expect(widgets[0].kind).toBe("slider");
      expect(widgets[0].args).toEqual([0.5, 0, 1]);
    });

    it("records correct source offsets for value argument", () => {
      const src = 'slider(0.5, 0, 1)';
      const { widgets } = transpile(src);
      expect(src.slice(widgets[0].valueArgStart, widgets[0].valueArgEnd)).toBe("0.5");
    });

    it("records correct source offsets for full call", () => {
      const src = 'slider(0.5, 0, 1)';
      const { widgets } = transpile(src);
      expect(src.slice(widgets[0].callStart, widgets[0].callEnd)).toBe("slider(0.5, 0, 1)");
    });

    it("extracts slider with default args", () => {
      const src = 'slider(0.5)';
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(1);
      expect(widgets[0].args).toEqual([0.5]);
    });

    it("extracts slider with step argument", () => {
      const src = 'slider(2, 1, 8, 1)';
      const { widgets } = transpile(src);
      expect(widgets[0].args).toEqual([2, 1, 8, 1]);
    });

    it("extracts multiple sliders in order", () => {
      const src = '$: color("red").alpha(slider(0.5, 0, 1)).speed(slider(1, -2, 2))';
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(2);
      expect(widgets[0].args[0]).toBe(0.5);
      expect(widgets[1].args[0]).toBe(1);
      // first slider appears before second in source
      expect(widgets[0].callStart).toBeLessThan(widgets[1].callStart);
    });

    it("handles slider embedded in expression", () => {
      const src = 'color("red").alpha(slider(0.7, 0, 1))';
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(1);
      expect(src.slice(widgets[0].callStart, widgets[0].callEnd)).toBe("slider(0.7, 0, 1)");
      expect(src.slice(widgets[0].valueArgStart, widgets[0].valueArgEnd)).toBe("0.7");
    });

    it("returns empty widgets array when no sliders", () => {
      const { widgets } = transpile('$: color("red")');
      expect(widgets).toEqual([]);
    });

    it("slider calls pass through to transpiled code", () => {
      const { code } = transpile('slider(0.5, 0, 1)');
      expect(code).toContain("slider(0.5, 0, 1)");
    });
  });

});
