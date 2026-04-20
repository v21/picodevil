import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import { onWarnings, warn } from "./warnings";
import { widgetExtension, setWidgetMeta, toSigFigs, widgetPositions } from "./editor-widgets";

declare global {
  interface Window {
    uzuEval: (code: string) => { error: string | null; widgets: WidgetCallInfo[] };
    uzuSetCode: (code: string) => void;
  }
}

export const defaultCode = `$: video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1")`;

export function setupEditor(
  parent: HTMLElement,
  initialCode: string = defaultCode,
  onCodeChange?: (code: string) => void,
): EditorView {
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

  /** Handle slider drag: update value store + rewrite code for persistence. */
  function handleSliderChange(editorView: EditorView, index: number, newValue: number, addToHistory: boolean) {
    // Value store already updated by editor-widgets.ts (setWidgetValue call)
    // Read live positions (mapped through all prior doc changes)
    const positions = editorView.state.field(widgetPositions);
    const pos = positions[index];
    if (!pos) return;
    // Rewrite the value argument in the source code
    const newText = toSigFigs(newValue);
    editorView.dispatch({
      changes: { from: pos.valueArgStart, to: pos.valueArgEnd, insert: newText },
      annotations: Transaction.addToHistory.of(addToHistory),
    });
    onCodeChange?.(editorView.state.doc.toString());
  }

  const widgets = widgetExtension(handleSliderChange);

  const changeListener: Extension = onCodeChange
    ? EditorView.updateListener.of((update) => {
        if (update.docChanged) onCodeChange(update.state.doc.toString());
      })
    : [];

  /** Eval code and push widget decorations into the editor. */
  function evalAndDecorate(editorView: EditorView, code: string) {
    const result = window.uzuEval(code);
    showError(result.error);
    // Push widget metadata into the editor for decoration
    editorView.dispatch({
      effects: setWidgetMeta.of(result.widgets),
    });
  }

  const evalKeymap = Prec.highest(keymap.of([
    {
      key: "Ctrl-Enter",
      run(view: EditorView) {
        const code = view.state.doc.toString();
        onCodeChange?.(code);
        evalAndDecorate(view, code);
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
      doc: initialCode,
      extensions: [basicSetup, javascript(), evalKeymap, widgets, changeListener],
    }),
  });

  window.uzuSetCode = (code: string) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  };

  // evaluate initial code at startup
  evalAndDecorate(view, initialCode);

  return view;
}
