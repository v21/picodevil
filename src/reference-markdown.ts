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
 * - **Bold** — `**text**` becomes `<strong>text</strong>`.
 *
 * The input is our own build-time JSDoc (not user input), but we still escape
 * HTML so the output is safe to assign via innerHTML.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Inserts `<wbr>` (zero-width line-break opportunities) into already-escaped
 * code so long method chains can wrap at natural boundaries when the container
 * is narrow — before a `.` that follows a call/identifier/bracket/string, and
 * after commas. The char-before-dot is restricted to non-digits so decimals
 * like `0.35` are never split. Looks identical to a single line when wide.
 */
export function insertCodeBreaks(escaped: string): string {
  return escaped.replace(/([)\]A-Za-z_$"'])\./g, "$1<wbr>.").replace(/,/g, ",<wbr>");
}

// Escape, then turn `code` spans into <code> and **text** into <strong>.
// Backticks/asterisks survive escaping; code is matched first so **markers**
// inside a code span stay literal, while a code span inside **bold** still works.
function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, (_, code) => `<code>${insertCodeBreaks(code)}</code>`)
    .replace(/\*\*([^*]+?)\*\*/g, (_, t) => `<strong>${t}</strong>`);
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
