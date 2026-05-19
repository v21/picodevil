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

  describe("fontPicker widget extraction", () => {
    it("extracts fontPicker call with string arg", () => {
      const src = "fontPicker('sans-serif')";
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(1);
      expect(widgets[0].kind).toBe("fontPicker");
    });

    it("captures fontName from string literal", () => {
      const src = "fontPicker('Gluten')";
      const { widgets } = transpile(src);
      expect(widgets[0].kind).toBe("fontPicker");
      if (widgets[0].kind === "fontPicker") {
        expect(widgets[0].fontName).toBe("Gluten");
      }
    });

    it("records correct source offsets spanning the full string literal", () => {
      const src = "fontPicker('Nyght Serif')";
      const { widgets } = transpile(src);
      expect(src.slice(widgets[0].valueArgStart, widgets[0].valueArgEnd)).toBe("'Nyght Serif'");
    });

    it("does not wrap fontPicker string arg in mini()", () => {
      const { code } = transpile('fontPicker(\'sans-serif\')');
      expect(code).toContain("fontPicker('sans-serif')");
      expect(code).not.toContain("mini(");
    });

    it("prevents double-quoted fontPicker arg from being wrapped in mini()", () => {
      const { code } = transpile('fontPicker("Gluten")');
      expect(code).toContain("fontPicker('Gluten')");
      expect(code).not.toContain("mini(");
    });

    it("extracts mixed slider and fontPicker widgets in order", () => {
      const src = "slider(0.5).alpha(); fontPicker('serif').font()";
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(2);
      expect(widgets[0].kind).toBe("slider");
      expect(widgets[1].kind).toBe("fontPicker");
    });

    it("extracts fontPicker widget with default fontName when arg is missing", () => {
      const { widgets } = transpile("fontPicker()");
      expect(widgets).toHaveLength(1);
      expect(widgets[0].kind).toBe("fontPicker");
      if (widgets[0].kind === "fontPicker") {
        expect(widgets[0].fontName).toBe("sans-serif");
        // Zero-width: both positions point just before the closing )
        expect(widgets[0].valueArgStart).toBe(widgets[0].valueArgEnd);
      }
    });
  });

  describe("method-style .fontPicker() widget extraction", () => {
    it("detects .fontPicker() method call", () => {
      const { widgets } = transpile("text('hi').fontPicker('Gluten')");
      expect(widgets).toHaveLength(1);
      expect(widgets[0].kind).toBe("fontPicker");
    });

    it("captures fontName from method-style call", () => {
      const src = "text('hi').fontPicker('Nunito')";
      const { widgets } = transpile(src);
      expect(widgets[0].kind).toBe("fontPicker");
      if (widgets[0].kind === "fontPicker") {
        expect(widgets[0].fontName).toBe("Nunito");
      }
    });

    it("records correct source offsets for method-style call", () => {
      const src = "text('hi').fontPicker('EB Garamond')";
      const { widgets } = transpile(src);
      expect(src.slice(widgets[0].valueArgStart, widgets[0].valueArgEnd)).toBe("'EB Garamond'");
    });

    it("does not wrap method-style double-quoted arg in mini()", () => {
      // text('hi') uses single-quotes so only fontPicker's arg-handling is tested
      const { code } = transpile("text('hi').fontPicker(\"Gluten\")");
      expect(code).toContain("fontPicker('Gluten')");
      expect(code).not.toContain("mini('Gluten')");
    });

    it("extracts widget with default fontName when method call has no arg", () => {
      const { widgets } = transpile("text('hi').fontPicker()");
      expect(widgets).toHaveLength(1);
      expect(widgets[0].kind).toBe("fontPicker");
      if (widgets[0].kind === "fontPicker") {
        expect(widgets[0].fontName).toBe("sans-serif");
        expect(widgets[0].valueArgStart).toBe(widgets[0].valueArgEnd);
      }
    });

    it("orders method-style and function-style widgets together", () => {
      const src = "fontPicker('serif'); text('hi').fontPicker('Gluten')";
      const { widgets } = transpile(src);
      expect(widgets).toHaveLength(2);
      expect(widgets[0].kind).toBe("fontPicker");
      expect(widgets[1].kind).toBe("fontPicker");
      if (widgets[0].kind === "fontPicker") expect(widgets[0].fontName).toBe("serif");
      if (widgets[1].kind === "fontPicker") expect(widgets[1].fontName).toBe("Gluten");
    });
  });

});
