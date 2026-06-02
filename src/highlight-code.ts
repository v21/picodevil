/**
 * Statically syntax-highlights a snippet of JavaScript to an HTML string,
 * reusing the *exact* highlight style the live editor uses (src/highlight.ts).
 * Used to render the reference tab's @example code blocks the same way the
 * editor renders code.
 *
 * The class names emitted are CodeMirror's generated highlight classes; their
 * CSS lives in the same HighlightStyle's StyleModule. Call injectHighlightCss()
 * once so those classes are styled even before/without the editor on the page.
 */
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { highlightTree } from "@lezer/highlight";
import { highlightStyle } from "./highlight";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightJsToHtml(code: string): string {
  const tree = javascriptLanguage.parser.parse(code);
  let html = "";
  let pos = 0;

  highlightTree(tree, highlightStyle, (from, to, classes) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from)); // unstyled gap
    html += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });
  if (pos < code.length) html += escapeHtml(code.slice(pos)); // trailing unstyled text

  return html;
}

let injected = false;

/** Inject the editor highlight style's CSS rules once, so the classes emitted
 *  by highlightJsToHtml render with the editor's colors. Idempotent. */
export function injectHighlightCss(): void {
  if (injected) return;
  injected = true;
  const rules = highlightStyle.module?.getRules();
  if (!rules) return;
  const styleEl = document.createElement("style");
  styleEl.dataset.pdHighlight = "";
  styleEl.textContent = rules;
  document.head.appendChild(styleEl);
}
