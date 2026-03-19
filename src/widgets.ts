import { signal } from "@strudel/core";
import type { Pattern } from "@strudel/core";

/** In-memory value store: maps sequential widget index → current numeric value. */
const widgetValues = new Map<number, number>();

/** Counter assigned sequentially during eval; reset each eval cycle. */
let widgetCounter = 0;

/** Reset widget counter at the start of each eval. */
export function resetWidgetCounter(): void {
  widgetCounter = 0;
}

/**
 * Set a widget's value (called by the editor widget on drag).
 * Updates the in-memory store so the pattern sees the new value next frame.
 */
export function setWidgetValue(index: number, value: number): void {
  widgetValues.set(index, value);
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
