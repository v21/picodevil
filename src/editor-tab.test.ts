import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import { tabIndentsOrInserts } from "./editor";

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mkView(doc: string, selection: EditorSelection): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc, selection }), parent });
  return view;
}

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
