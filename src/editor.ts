import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import { onWarnings, warn } from "./warnings";

declare global {
  interface Window {
    uzuEval: (code: string) => string | null;
    uzuSetCode: (code: string) => void;
  }
}

const STORAGE_KEY = "uzuvid:code";
const defaultCode = `$: video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1")`;
const savedCode = localStorage.getItem(STORAGE_KEY);

export function setupEditor(parent: HTMLElement): EditorView {
  const errorEl = document.createElement("div");
  errorEl.className = "uzu-error";
  parent.appendChild(errorEl);

  const warnEl = document.createElement("div");
  warnEl.className = "uzu-warning";
  parent.appendChild(warnEl);

  function showError(msg: string | null) {
    if (msg) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    } else {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  // Pipe Strudel's internal query errors (caught by queryArc) into the warning system
  document.addEventListener("strudel.log", (e: Event) => {
    const msg = (e as CustomEvent).detail?.message;
    if (msg) warn(msg);
  });

  // Show runtime warnings (deduped, auto-clear on next eval)
  let warnTimeout: ReturnType<typeof setTimeout> | null = null;
  onWarnings((msgs) => {
    warnEl.textContent = msgs.join("\n");
    warnEl.style.display = "block";
    // Auto-hide after 5s if no new warnings
    if (warnTimeout) clearTimeout(warnTimeout);
    warnTimeout = setTimeout(() => {
      warnEl.style.display = "none";
    }, 5000);
  });

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
