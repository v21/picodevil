/**
 * Renders the small markdown subset used in JSDoc descriptions (shown in the
 * sidebar reference tab) to an HTML string.
 *
 * Supported syntax:
 * - **Paragraphs** — blank line separates paragraphs (`<p>`).
 * - **Soft wrap** — a single newline between flush (non-indented) lines is a
 *   soft break: the lines are joined with a space, so prose wrapped across
 *   several source lines reflows as one paragraph.
 * - **Hard break** — a line that starts with leading whitespace keeps its break
 *   (`<br>`), so manually-aligned/indented lines stay on separate lines.
 * - **Bullet lists** — lines starting with `-` or `*` become `<ul><li>` items.
 * - **Inline code** — `` `text` `` becomes `<code>text</code>`.
 *
 * The input is our own build-time JSDoc (not user input), but we still escape
 * HTML so the output is safe to assign via innerHTML.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Escape, then turn `code` spans into <code>. Backticks survive escaping, and
// the code content is escaped before being wrapped, so it stays safe.
function renderInline(s: string): string {
  return escapeHtml(s).replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
}

export function renderReferenceMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  let para: { indented: boolean; text: string }[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const html = para
      .map((l, i) => {
        if (i === 0) return renderInline(l.text);
        return (l.indented ? "<br>" : " ") + renderInline(l.text);
      })
      .join("");
    out.push(`<p>${html}</p>`);
    para = [];
  };

  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const raw of lines) {
    if (raw.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else {
      flushList();
      para.push({ indented: /^\s/.test(raw), text: raw.trim() });
    }
  }
  flushPara();
  flushList();

  return out.join("");
}
