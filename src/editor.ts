import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
} from "@codemirror/view";
import { EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";

// Reconstruction of codemirror's `basicSetup` WITHOUT code folding — picodevil
// has no fold support, so foldGutter()/foldKeymap are dropped (the fold gutter
// otherwise adds an unused, distracting column). Everything else matches the
// upstream `basicSetup` (codemirror 6.0.2).
const basicSetup: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];
import { onWarnings, warn } from "./warnings";
import { pdHighlight } from "./highlight";
import { widgetExtension, setWidgetMeta, toSigFigs, widgetPositions } from "./editor-widgets";
import type { WidgetCallInfo, FontPickerCallInfo } from "./transpiler";
import { createPlayButton, type PlayButton } from "./play-button";

declare global {
  interface Window {
    pdEval: (code: string) => { error: string | null; widgets: WidgetCallInfo[] };
    pdSetCode: (code: string, evaluate?: boolean) => void;
  }
}

export const defaultCode = ``;

export function setupEditor(
  parent: HTMLElement,
  initialCode: string = defaultCode,
  onCodeChange?: (code: string) => void,
): EditorView {
  const errorEl = document.createElement("div");
  errorEl.className = "pd-error";
  parent.appendChild(errorEl);

  const warnEl = document.createElement("div");
  warnEl.className = "pd-warning";
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

  /** Handle font picker selection: rewrite string literal in source code. */
  function handleFontPickerChange(editorView: EditorView, index: number, newFont: string, addToHistory: boolean) {
    // Value store already updated by editor-widgets.ts (setFontPickerValue call)
    const positions = editorView.state.field(widgetPositions);
    const pos = positions[index];
    if (!pos) return;
    // Replace the full string literal (including quotes) with the new font name
    editorView.dispatch({
      changes: { from: pos.valueArgStart, to: pos.valueArgEnd, insert: `'${newFont}'` },
      annotations: Transaction.addToHistory.of(addToHistory),
    });
    onCodeChange?.(editorView.state.doc.toString());
  }

  const widgets = widgetExtension({ slider: handleSliderChange, fontPicker: handleFontPickerChange });

  // The round "evaluate" button at the bottom-left. It lights up whenever the
  // editor text differs from what was last evaluated, so touch users (who can't
  // press Ctrl/Cmd-Enter) have a way to re-eval. Created below once the view
  // exists; tracked here so evalAndDecorate can clear the dirty flag.
  let playButton: PlayButton | null = null;
  let lastEvaluatedCode = initialCode;

  /** Light the play button iff the current doc differs from the last eval. */
  function refreshDirty(code: string) {
    playButton?.setDirty(code !== lastEvaluatedCode);
  }

  /** Record the code that was just evaluated and clear the dirty indicator. */
  function markEvaluated(editorView: EditorView) {
    lastEvaluatedCode = editorView.state.doc.toString();
    playButton?.setDirty(false);
  }

  const changeListener: Extension = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const code = update.state.doc.toString();
      onCodeChange?.(code);
      refreshDirty(code);
    }
  });

  /** Eval code and push widget decorations into the editor. */
  function evalAndDecorate(editorView: EditorView, code: string) {
    const result = window.pdEval(code);
    showError(result.error);

    const noArgPickers = result.widgets.filter(
      (w): w is FontPickerCallInfo => w.kind === "fontPicker" && w.valueArgStart === w.valueArgEnd
    );

    if (noArgPickers.length === 0) {
      editorView.dispatch({ effects: setWidgetMeta.of(result.widgets) });
      markEvaluated(editorView);
      return;
    }

    // Insert the default font name string into source for each no-arg fontPicker().
    // Process in source order; track cumulative offset as we insert text.
    const changes = noArgPickers.map((picker, i) => {
      const priorLen = noArgPickers.slice(0, i).reduce((acc, p) => acc + `'${p.fontName}'`.length, 0);
      const pos = picker.valueArgStart + priorLen;
      return { from: pos, to: pos, insert: `'${picker.fontName}'` };
    });

    // Adjust all widget positions to account for the inserted text.
    const adjustedWidgets: WidgetCallInfo[] = result.widgets.map(w => {
      const shift = noArgPickers
        .filter(p => p.valueArgStart <= w.valueArgStart)
        .reduce((acc, p) => acc + `'${p.fontName}'`.length, 0);
      if (noArgPickers.includes(w as FontPickerCallInfo)) {
        const insertLen = `'${(w as FontPickerCallInfo).fontName}'`.length;
        return { ...w, valueArgStart: w.valueArgStart + shift - insertLen, valueArgEnd: w.valueArgEnd + shift };
      }
      return { ...w, valueArgStart: w.valueArgStart + shift, valueArgEnd: w.valueArgEnd + shift };
    });

    editorView.dispatch({
      changes,
      effects: setWidgetMeta.of(adjustedWidgets),
      annotations: Transaction.addToHistory.of(true),
    });
    onCodeChange?.(editorView.state.doc.toString());
    markEvaluated(editorView);
  }

  const runEval = (view: EditorView) => {
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
  };

  // Bind both Ctrl-Enter and Mod-Enter. On Mac, Mod = Cmd, so Cmd-Enter works
  // (and avoids the Ctrl=right-click collision that eats Ctrl-Enter in Firefox);
  // on Win/Linux, Mod = Ctrl so the two coincide harmlessly.
  const evalKeymap = Prec.highest(keymap.of([
    { key: "Ctrl-Enter", run: runEval },
    { key: "Mod-Enter", run: runEval },
  ]));

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialCode,
      // lineWrapping: long lines flow onto the next visual line instead of
      // scrolling sideways (which is awkward on touch / narrow screens).
      extensions: [basicSetup, EditorView.lineWrapping, javascriptLanguage, pdHighlight, evalKeymap, widgets, changeListener],
    }),
  });

  // Round evaluate button (bottom-left). Lives on <body> so it isn't clipped by
  // editor-wrap's overflow:hidden, and is visible on desktop + touch alike.
  playButton = createPlayButton(document.body, () => runEval(view));

  window.pdSetCode = (code: string, evaluate = false) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
    if (evaluate) {
      onCodeChange?.(code);
      evalAndDecorate(view, code);
    }
  };

  // evaluate initial code at startup
  evalAndDecorate(view, initialCode);

  // default focus to the editor so typing/eval works without a click
  view.focus();

  return view;
}
