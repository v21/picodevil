import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";

declare global {
  interface Window {
    uzuEval: (code: string) => void;
    uzuSetCode: (code: string) => void;
  }
}

const STORAGE_KEY = "uzuvid:code";
const defaultCode = `video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1").out()`;
const savedCode = localStorage.getItem(STORAGE_KEY);

export function setupEditor(parent: HTMLElement): EditorView {
  const evalKeymap = Prec.highest(keymap.of([
    {
      key: "Ctrl-Enter",
      run(view: EditorView) {
        const code = view.state.doc.toString();
        localStorage.setItem(STORAGE_KEY, code);
        window.uzuEval(code);
        // flash effect
        const lines = view.dom.querySelectorAll(".cm-line");
        lines.forEach((el) => {
          el.classList.remove("cm-evaluated");
          if (el.textContent?.trim()) {
            void (el as HTMLElement).offsetWidth;
            el.classList.add("cm-evaluated");
          }
        });
        return true;
      },
    },
  ]));

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: savedCode ?? defaultCode,
      extensions: [basicSetup, javascript(), evalKeymap],
    }),
  });

  window.uzuSetCode = (code: string) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  };

  // evaluate initial code at startup
  window.uzuEval(savedCode ?? defaultCode);

  return view;
}
