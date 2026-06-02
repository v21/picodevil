import { describe, it, expect } from "vitest";
import { renderReferenceMarkdown } from "./reference-markdown";

describe("renderReferenceMarkdown", () => {
  it("wraps a single line in a paragraph", () => {
    expect(renderReferenceMarkdown("Sets the blend mode.")).toBe("<p>Sets the blend mode.</p>");
  });

  it("soft-wraps flush lines within a paragraph (joined by a space)", () => {
    expect(renderReferenceMarkdown("Crops the source to a rectangle\nall in normalised coordinates.")).toBe(
      "<p>Crops the source to a rectangle all in normalised coordinates.</p>"
    );
  });

  it("treats a blank line as a paragraph break", () => {
    expect(renderReferenceMarkdown("First paragraph.\n\nSecond paragraph.")).toBe(
      "<p>First paragraph.</p><p>Second paragraph.</p>"
    );
  });

  it("renders inline `code` spans", () => {
    expect(renderReferenceMarkdown("Use `blend` mode.")).toBe("<p>Use <code>blend</code> mode.</p>");
  });

  it("renders bullet lists, with code inside items", () => {
    const input = '- `"add"` — additive\n- `"multiply"` — darkens';
    expect(renderReferenceMarkdown(input)).toBe(
      '<ul><li><code>"add"</code> — additive</li><li><code>"multiply"</code> — darkens</li></ul>'
    );
  });

  it("handles a lead-in line followed by a bullet list", () => {
    const input = "Supported modes:\n- `add`\n- `multiply`";
    expect(renderReferenceMarkdown(input)).toBe(
      "<p>Supported modes:</p><ul><li><code>add</code></li><li><code>multiply</code></li></ul>"
    );
  });

  it("keeps a hard break before an indented line", () => {
    const input = "Modes:\n  cover fills the cell\n  contain fits inside";
    expect(renderReferenceMarkdown(input)).toBe("<p>Modes:<br>cover fills the cell<br>contain fits inside</p>");
  });

  it("escapes HTML special characters", () => {
    expect(renderReferenceMarkdown("a < b & c > d")).toBe("<p>a &lt; b &amp; c &gt; d</p>");
    expect(renderReferenceMarkdown("`<script>`")).toBe("<p><code>&lt;script&gt;</code></p>");
  });

  it("returns empty string for empty input", () => {
    expect(renderReferenceMarkdown("")).toBe("");
  });
});
