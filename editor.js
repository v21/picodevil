import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";

const defaultCode = `return color("red blue [green yellow] purple")`;

export function setupEditor(parent) {
  const evalKeymap = Prec.highest(keymap.of([
    {
      key: "Ctrl-Enter",
      run(view) {
        const code = view.state.doc.toString();
        window.uzuEval(code);
        // flash effect
        const lines = view.dom.querySelectorAll(".cm-line");
        lines.forEach((el) => {
          el.classList.remove("cm-evaluated");
          if (el.textContent.trim()) {
            void el.offsetWidth;
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

  return view;
}
