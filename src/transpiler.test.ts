import { describe, it, expect } from "vitest";
import { transpile } from "./transpiler";

/** Normalize quotes for comparison (escodegen uses single quotes). */
function norm(s: string): string {
  return s.replace(/"/g, "'");
}

describe("transpiler", () => {
  describe("labeled statements", () => {
    it("rewrites $: to .p('$')", () => {
      const result = transpile('$: color("red")');
      expect(norm(result)).toContain(".p('$')");
    });

    it("rewrites named labels like d1:", () => {
      const result = transpile('d1: video("clip.mp4")');
      expect(norm(result)).toContain(".p('d1')");
    });

    it("rewrites muted labels _$:", () => {
      const result = transpile('_$: color("red")');
      expect(norm(result)).toContain(".p('_$')");
    });

    it("rewrites muted labels with trailing underscore $_:", () => {
      const result = transpile('$_: color("red")');
      expect(norm(result)).toContain(".p('$_')");
    });

    it("rewrites soloed labels S$:", () => {
      const result = transpile('S$: color("red")');
      expect(norm(result)).toContain(".p('S$')");
    });

    it("preserves the expression body", () => {
      const result = transpile('$: video("clip.mp4").speed("0.5 1")');
      expect(norm(result)).toContain("video(mini('clip.mp4'))");
      expect(norm(result)).toContain(".speed(mini('0.5 1'))");
    });

    it("handles multiple labeled statements", () => {
      const code = `$: color("red")
$: video("clip.mp4")`;
      const result = norm(transpile(code));
      expect(result).toContain("color(mini('red')).p('$')");
      expect(result).toContain("video(mini('clip.mp4')).p('$')");
    });

    it("passes through non-labeled statements", () => {
      const result = transpile('let x = 5');
      expect(result).toContain('x');
      expect(result).toContain('5');
      expect(result).not.toContain('.p(');
    });

    it("handles mixed labeled and non-labeled", () => {
      const code = `let x = 1
$: color("red")
let y = 2`;
      const result = norm(transpile(code));
      expect(result).toContain(".p('$')");
      expect(result).toContain('x');
      expect(result).toContain('y');
    });
  });

  describe("double-quoted string rewriting", () => {
    it("rewrites double-quoted strings to mini() calls", () => {
      const result = norm(transpile('color("red")'));
      expect(result).toContain("color(mini('red'))");
    });

    it("leaves single-quoted strings as-is", () => {
      const result = transpile("color('red')");
      expect(norm(result)).toContain("color('red')");
      expect(norm(result)).not.toContain("mini(");
    });

    it("handles mixed quotes", () => {
      const result = norm(transpile(`image("a.png").urlBase('https://x.com/')`));
      expect(result).toContain("image(mini('a.png'))");
      expect(result).toContain(".urlBase('https://x.com/')");
    });
  });

});
