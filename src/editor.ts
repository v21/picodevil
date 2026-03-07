import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";

declare global {
  interface Window {
    uzuEval: (code: string) => string | null;
    uzuSetCode: (code: string) => void;
  }
}

const STORAGE_KEY = "uzuvid:code";
const defaultCode = `video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1").out()`;
const savedCode = localStorage.getItem(STORAGE_KEY);

export function setupEditor(parent: HTMLElement): EditorView {
  const errorEl = document.createElement("div");
  errorEl.className = "uzu-error";
  parent.appendChild(errorEl);

  function showError(msg: string | null) {
    if (msg) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    } else {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  const evalKeymap = Prec.highest(keymap.of([
    {
      key: "Ctrl-Enter",
      run(view: EditorView) {
        const code = view.state.doc.toString();
        localStorage.setItem(STORAGE_KEY, code);
        const err = window.uzuEval(code);
        showError(err);
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
  showError(window.uzuEval(savedCode ?? defaultCode));

  return view;
}
