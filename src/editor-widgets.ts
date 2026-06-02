import { EditorView, WidgetType, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import type { WidgetCallInfo, SliderCallInfo, FontPickerCallInfo } from "./transpiler";
import { setWidgetValue, setFontPickerValue } from "./widgets";
import { requestLocalFonts, FONT_AXES } from "./font-list";
import type { FontEntry } from "./font-list";

/** Effect to push new widget metadata after eval. */
export const setWidgetMeta = StateEffect.define<WidgetCallInfo[]>();

/** Round a number to 3 significant figures, preserving trailing zeros. */
function toSigFigs(n: number, figs = 3): string {
  if (n === 0) return "0.00";
  return n.toPrecision(figs);
}

/** Live-tracked positions for each widget's value argument, updated through doc changes. */
interface WidgetPosition {
  valueArgStart: number;
  valueArgEnd: number;
}

/** State field tracking current widget value-arg positions, mapped through edits. */
export const widgetPositions = StateField.define<WidgetPosition[]>({
  create() { return []; },
  update(positions, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setWidgetMeta)) {
        // Fresh positions from eval
        return effect.value.map(w => ({
          valueArgStart: w.valueArgStart,
          valueArgEnd: w.valueArgEnd,
        }));
      }
    }
    if (!tr.docChanged) return positions;
    // Map positions through document changes
    return positions.map(pos => ({
      valueArgStart: tr.changes.mapPos(pos.valueArgStart),
      valueArgEnd: tr.changes.mapPos(pos.valueArgEnd),
    }));
  },
});

type SliderChangeHandler = (view: EditorView, index: number, newValue: number, addToHistory: boolean) => void;
type FontPickerChangeHandler = (view: EditorView, index: number, newValue: string, addToHistory: boolean) => void;

class SliderWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly info: SliderCallInfo,
    readonly onChange: SliderChangeHandler,
  ) {
    super();
  }

  eq(other: SliderWidget): boolean {
    return this.index === other.index &&
      this.info.args[0] === other.info.args[0] &&
      this.info.args[1] === other.info.args[1] &&
      this.info.args[2] === other.info.args[2] &&
      this.info.args[3] === other.info.args[3];
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "pd-widget-slider";
    input.min = String(this.info.args[1] ?? 0);
    input.max = String(this.info.args[2] ?? 1);
    input.step = String(this.info.args[3] ?? 0.001);
    input.value = String(this.info.args[0]);

    const index = this.index;
    const onChange = this.onChange;

    input.addEventListener("input", () => {
      const newValue = parseFloat(input.value);
      // Update in-memory value store immediately for instant visual feedback
      setWidgetValue(index, newValue);
      // Rewrite the code for persistence — skip history during drag
      onChange(view, index, newValue, false);
    });

    input.addEventListener("change", () => {
      const newValue = parseFloat(input.value);
      setWidgetValue(index, newValue);
      // Final value on mouseup — add to history as one undo step
      onChange(view, index, newValue, true);
    });

    return input;
  }

  ignoreEvent(event: Event): boolean {
    // Return true = editor ignores this event, letting the slider widget handle it
    return true;
  }
}

// ---------------------------------------------------------------------------
// Shared datalist for font pickers — created lazily, lives on document.body
// ---------------------------------------------------------------------------

let fontDatalist: HTMLDataListElement | null = null;

function getOrCreateDatalist(): HTMLDataListElement {
  if (!fontDatalist) {
    fontDatalist = document.createElement("datalist");
    fontDatalist.id = "pd-font-list";
    document.body.appendChild(fontDatalist);
  }
  return fontDatalist;
}

/** Populate (or repopulate) the shared font datalist. Called from main.ts via initFontList callback. */
export function repopulateFontDatalist(fonts: FontEntry[]): void {
  const dl = getOrCreateDatalist();
  dl.innerHTML = "";
  for (const f of fonts) {
    const opt = document.createElement("option");
    opt.value = f.family;
    const axes = FONT_AXES[f.family];
    if (axes) {
      const axisStr = axes.map(a => `${a.tag} ${a.min}–${a.max}`).join('  ');
      opt.label = axisStr;
    } else if (f.source === "local") {
      opt.label = "(local)";
    }
    dl.appendChild(opt);
  }
}

class FontPickerWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly info: FontPickerCallInfo,
    readonly onChange: FontPickerChangeHandler,
  ) {
    super();
  }

  eq(other: FontPickerWidget): boolean {
    return this.index === other.index && this.info.fontName === other.info.fontName;
  }

  toDOM(view: EditorView): HTMLElement {
    // Ensure datalist exists even if initFontList hasn't been called yet
    getOrCreateDatalist();

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("list", "pd-font-list");
    input.className = "pd-widget-fontpicker";
    input.value = this.info.fontName;

    const index = this.index;
    const onChange = this.onChange;

    let savedValue = this.info.fontName;

    input.addEventListener("focus", () => {
      requestLocalFonts();
      savedValue = input.value;
      input.value = "";
    });

    input.addEventListener("blur", () => {
      if (!input.value.trim()) input.value = savedValue;
    });

    input.addEventListener("change", () => {
      const newFont = input.value.trim();
      if (!newFont) return;
      savedValue = newFont;
      setFontPickerValue(index, newFont);
      onChange(view, index, newFont, true);
    });

    return input;
  }

  ignoreEvent(event: Event): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

/** Build decoration set from widget metadata. */
function buildDecorations(
  widgets: WidgetCallInfo[],
  onSliderChange: SliderChangeHandler,
  onFontPickerChange: FontPickerChangeHandler,
): DecorationSet {
  const decorations = widgets.map((info, index) => {
    if (info.kind === "slider") {
      const widget = new SliderWidget(index, info, onSliderChange);
      return Decoration.widget({ widget, side: -1 }).range(info.valueArgStart);
    } else {
      const widget = new FontPickerWidget(index, info, onFontPickerChange);
      if (info.valueArgStart === info.valueArgEnd) {
        // No arg case: insert widget without replacing any text
        return Decoration.widget({ widget, side: 1 }).range(info.valueArgStart);
      }
      // Replace the string literal with the widget so the font name isn't shown twice
      return Decoration.replace({ widget }).range(info.valueArgStart, info.valueArgEnd);
    }
  });
  return Decoration.set(decorations, true);
}

/**
 * Create the widget extensions for the editor.
 * @param handlers Change handlers for each widget type.
 * Returns an array of extensions to install.
 */
export function widgetExtension(handlers: {
  slider: SliderChangeHandler;
  fontPicker: FontPickerChangeHandler;
}) {
  const decoField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decos, tr) {
      // Map decorations through document changes
      decos = decos.map(tr.changes);
      // Apply new widget metadata if present
      for (const effect of tr.effects) {
        if (effect.is(setWidgetMeta)) {
          decos = buildDecorations(effect.value, handlers.slider, handlers.fontPicker);
        }
      }
      return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [decoField, widgetPositions];
}

export { toSigFigs };
export type { SliderChangeHandler, FontPickerChangeHandler };
