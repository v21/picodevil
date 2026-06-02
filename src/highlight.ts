import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const highlightStyle = HighlightStyle.define([
  { tag: tags.meta,                                    color: "#404740" },
  { tag: tags.link,                                    textDecoration: "underline" },
  { tag: tags.heading,                                 textDecoration: "underline", fontWeight: "bold" },
  { tag: tags.emphasis,                                fontStyle: "italic" },
  { tag: tags.strong,                                  fontWeight: "bold" },
  { tag: tags.strikethrough,                           textDecoration: "line-through" },
  { tag: tags.keyword,                                 color: "#FFCA9C" },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: "#ffca9c" },
  { tag: [tags.literal, tags.inserted],                color: "#FFF352" },
  { tag: [tags.string, tags.deleted],                  color: "#d7ffaf",fontStyle: "italic" },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "#C5A3FF" },
  { tag: tags.definition(tags.variableName),           color: "#FF857F" },
  { tag: tags.local(tags.variableName),                color: "#FF857F" },
  { tag: [tags.typeName, tags.namespace],              color: "#C2FFDF" },
  { tag: tags.className,                               color: "#5EB58A" },
  { tag: [tags.special(tags.variableName), tags.macroName], color: "#FFF352" },
  { tag: tags.definition(tags.propertyName),           color: "#5EB58A" },
  { tag: tags.comment,                                 color: "#FFC400" },
  { tag: tags.invalid,                                 color: "#F92672" },
]);

export const pdHighlight = syntaxHighlighting(highlightStyle);
