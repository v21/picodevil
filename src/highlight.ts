import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Token colours live as CSS custom properties (`--hl-*`) in src/style.css — the
// single source of truth shared with the rest of the UI. CodeMirror reads them
// via var(): the generated highlight rules are injected as real CSS (editor
// StyleModule + injectHighlightCss for the reference tab), so the vars resolve
// against :root like any other rule.
export const highlightStyle = HighlightStyle.define([
  { tag: tags.meta,                                    color: "var(--hl-meta)" },
  { tag: tags.link,                                    textDecoration: "underline" },
  { tag: tags.heading,                                 textDecoration: "underline", fontWeight: "bold" },
  { tag: tags.emphasis,                                fontStyle: "italic" },
  { tag: tags.strong,                                  fontWeight: "bold" },
  { tag: tags.strikethrough,                           textDecoration: "line-through" },
  { tag: tags.keyword,                                 color: "var(--hl-keyword)" },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: "var(--hl-keyword)" },
  { tag: [tags.literal, tags.inserted],                color: "var(--hl-literal)" },
  { tag: [tags.string, tags.deleted],                  color: "var(--hl-string)", fontStyle: "italic" },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "var(--hl-regexp)" },
  { tag: tags.definition(tags.variableName),           color: "var(--hl-variable)" },
  { tag: tags.local(tags.variableName),                color: "var(--hl-variable)" },
  { tag: [tags.typeName, tags.namespace],              color: "var(--hl-type)" },
  { tag: tags.className,                               color: "var(--hl-class)" },
  { tag: [tags.special(tags.variableName), tags.macroName], color: "var(--hl-literal)" },
  { tag: tags.definition(tags.propertyName),           color: "var(--hl-class)" },
  { tag: tags.comment,                                 color: "var(--hl-comment)" },
  { tag: tags.invalid,                                 color: "var(--hl-invalid)" },
]);

export const pdHighlight = syntaxHighlighting(highlightStyle);
