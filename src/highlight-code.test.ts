import { describe, it, expect } from "vitest";
import { highlightJsToHtml } from "./highlight-code";

// Strip tags to recover the plain text that will be visible to the user.
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

describe("highlightJsToHtml", () => {
  it("preserves the exact source text (no characters lost or added)", () => {
    const code = '$: video("clip.mp4").blend("multiply")';
    expect(text(highlightJsToHtml(code))).toBe(code);
  });

  it("wraps tokens in styled spans", () => {
    const html = highlightJsToHtml('video("x")');
    expect(html).toContain("<span");
    expect(html).toContain('"x"');
  });

  it("preserves newlines and comments across multiple example lines", () => {
    const code = '$: color("red").blend("screen")  // alternates per cycle\n$: video("a.mp4")';
    expect(text(highlightJsToHtml(code))).toBe(code);
    expect(highlightJsToHtml(code)).toContain("\n");
  });

  it("escapes HTML special characters in code", () => {
    const code = "a < b && c > d";
    const html = highlightJsToHtml(code);
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).toContain("&amp;");
    expect(text(html)).toBe(code);
  });

  it("does not throw on empty input", () => {
    expect(highlightJsToHtml("")).toBe("");
  });
});
