import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import { tabIndentsOrInserts, padInsert } from "./editor";

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mkView(doc: string, selection: EditorSelection): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc, selection }), parent });
  return view;
}

describe("padInsert", () => {
  it("pads both sides when the caret sits between non-space chars", () => {
    expect(padInsert("ducks", ")", "(")).toBe(" ducks ");
  });
  it("adds no padding next to double quotes (inside s(\"\"))", () => {
    // caret inside s("|") → s("ducks"), not s(" ducks ")
    expect(padInsert("ducks", '"', '"')).toBe("ducks");
  });
  it("pads only the non-quote side", () => {
    expect(padInsert("ducks", "s", '"')).toBe(" ducks");
  });
  it("adds no padding when both neighbours are already spaces", () => {
    expect(padInsert("ducks", " ", " ")).toBe("ducks");
  });
  it("adds no padding at a document boundary (null neighbours)", () => {
    expect(padInsert("ducks", null, null)).toBe("ducks");
  });
  it("leads only when there's non-space before but a space after", () => {
    expect(padInsert("ducks", ")", " ")).toBe(" ducks");
  });
  it("trails only when there's a space before but non-space after", () => {
    expect(padInsert("ducks", " ", "s")).toBe("ducks ");
  });
  it("treats a newline/tab as an existing space (no padding added)", () => {
    expect(padInsert("ducks", "\n", "\t")).toBe("ducks");
  });
});

describe("tabIndentsOrInserts", () => {
  it("inserts a literal tab at the caret when there is no selection", () => {
    const v = mkView("abcdef", EditorSelection.cursor(3));
    tabIndentsOrInserts(v);
    expect(v.state.doc.toString()).toBe("abc\tdef");
    expect(v.state.selection.main.head).toBe(4); // caret sits after the tab
  });

  it("replaces a single-line selection with a tab", () => {
    const v = mkView("abcdef", EditorSelection.single(2, 4)); // selects "cd"
    tabIndentsOrInserts(v);
    expect(v.state.doc.toString()).toBe("ab\tef");
  });

  it("block-indents when the selection spans multiple lines", () => {
    const v = mkView("aa\nbb", EditorSelection.single(0, 5)); // spans both lines
    tabIndentsOrInserts(v);
    const out = v.state.doc.toString();
    // both lines gain leading indentation; the text is preserved, not replaced
    const [l1, l2] = out.split("\n");
    expect(l1).toMatch(/^\s+aa$/);
    expect(l2).toMatch(/^\s+bb$/);
  });
});
