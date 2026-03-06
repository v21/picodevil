import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";

declare global {
  interface Window {
    uzuEval: (code: string) => void;
  }
}

const defaultCode = `return video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1")`;

export function setupEditor(parent: HTMLElement): EditorView {
  const evalKeymap = Prec.highest(keymap.of([
    {
      key: "Ctrl-Enter",
      run(view: EditorView) {
        const code = view.state.doc.toString();
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
      doc: defaultCode,
      extensions: [basicSetup, javascript(), evalKeymap],
    }),
  });

  // evaluate default code at startup
  window.uzuEval(defaultCode);

  return view;
}
