import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, historyField, undoDepth } from "@codemirror/commands";
import { buildInitialState, canRestoreSession, type PersistedSession } from "./editor";

// A saved session with a one-edit undo history, doc = "hello world".
function makeSaved(scrollTop = 120): { saved: PersistedSession; depth: number } {
  let s = EditorState.create({ doc: "hello", extensions: [history()] });
  s = s.update({ changes: { from: 5, insert: " world" } }).state;
  return { saved: { state: s.toJSON({ history: historyField }), scrollTop }, depth: undoDepth(s) };
}

describe("canRestoreSession", () => {
  it("is false with no saved session", () => {
    expect(canRestoreSession("x", null)).toBe(false);
  });
  it("is true only when the saved doc is byte-identical to the code we're loading", () => {
    const { saved } = makeSaved();
    expect(canRestoreSession("hello world", saved)).toBe(true);
    expect(canRestoreSession("hello  world", saved)).toBe(false); // differs by a space
    expect(canRestoreSession("", saved)).toBe(false);
  });
});

describe("buildInitialState", () => {
  it("starts clean (no history) when there is no saved session", () => {
    const state = buildInitialState("fresh code", null, [history()]);
    expect(state.doc.toString()).toBe("fresh code");
    expect(undoDepth(state)).toBe(0);
  });

  it("restores doc + undo history when the saved doc matches", () => {
    const { saved, depth } = makeSaved();
    expect(depth).toBeGreaterThan(0);
    const state = buildInitialState("hello world", saved, [history()]);
    expect(state.doc.toString()).toBe("hello world");
    expect(undoDepth(state)).toBe(depth); // history survived the reload
  });

  it("ignores the saved history when the doc differs (shared link / new example)", () => {
    const { saved } = makeSaved();
    const state = buildInitialState("someone else's code", saved, [history()]);
    expect(state.doc.toString()).toBe("someone else's code");
    expect(undoDepth(state)).toBe(0); // no mismatched history grafted on
  });

  it("falls back to a clean doc if the persisted state is corrupt", () => {
    // doc matches (so canRestoreSession is true) but the payload can't deserialize.
    const bad: PersistedSession = { state: { doc: "hello world" }, scrollTop: 0 };
    const state = buildInitialState("hello world", bad, [history()]);
    expect(state.doc.toString()).toBe("hello world");
    expect(undoDepth(state)).toBe(0);
  });
});
