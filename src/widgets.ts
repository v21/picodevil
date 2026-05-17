import { signal, Pattern } from "@strudel/core";

/** In-memory value store: maps sequential widget index → current numeric value. */
const widgetValues = new Map<number, number>();

/** In-memory value store: maps sequential widget index → current font family string. */
const fontPickerValues = new Map<number, string>();

/** Counter assigned sequentially during eval; reset each eval cycle. Shared by all widget types. */
let widgetCounter = 0;

/** Reset widget counter at the start of each eval. */
export function resetWidgetCounter(): void {
  widgetCounter = 0;
}

/**
 * Set a slider widget's value (called by the editor widget on drag).
 * Updates the in-memory store so the pattern sees the new value next frame.
 */
export function setWidgetValue(index: number, value: number): void {
  widgetValues.set(index, value);
}

/**
 * Set a fontPicker widget's value (called by the editor widget on selection change).
 * Updates the in-memory store so the pattern sees the new font next frame.
 */
export function setFontPickerValue(index: number, value: string): void {
  fontPickerValues.set(index, value);
}

/**
 * Create a slider signal pattern.
 * Returns a continuous signal (like mouseX) whose value is controlled
 * by an inline slider widget in the editor.
 */
export function slider(value: number, min = 0, max = 1, step = 0.001): Pattern {
  const index = widgetCounter++;
  widgetValues.set(index, value);
  return signal(() => widgetValues.get(index) ?? value);
}

/**
 * Create a font-picker signal pattern.
 * Returns a continuous signal whose value is the currently selected font family name,
 * controlled by an inline typeahead widget in the editor.
 * @param initialFont CSS font-family name (default: 'sans-serif')
 * @example
 * $: text('Hello').font(fontPicker('Gluten')).fontSize(120)
 */
export function fontPicker(initialFont: string = 'sans-serif'): Pattern {
  const index = widgetCounter++;
  fontPickerValues.set(index, initialFont);
  return signal(() => fontPickerValues.get(index) ?? initialFont);
}

const PatternProto = Pattern.prototype as any;

/**
 * Shorthand for `.font(fontPicker(initialFont))`.
 * Renders an inline font-picker widget in the editor.
 * @param initialFont CSS font-family name (default: 'sans-serif')
 * @example
 * $: text('Hello').fontPicker('Gluten').fontSize(120)
 */
PatternProto.fontPicker = function(initialFont: string = 'sans-serif') {
  return this.font(fontPicker(initialFont));
};
