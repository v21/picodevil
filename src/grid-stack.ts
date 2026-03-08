import { stack } from "@strudel/core";
import type { Pattern } from "@strudel/mini";
import "./visual-controls";

/**
 * Distributes an array of patterns across cells in a grid, cycling children if there are more cells than patterns.
 *
 * @param {Pattern[]} children array of patterns to distribute across the grid
 * @param {number | Pattern} cols number of columns (can be a pattern)
 * @param {number | Pattern} rows number of rows (can be a pattern)
 * @returns {Pattern} stacked pattern with each child assigned to grid cells via .gridModulo()
 * @example
 * $: gridStack([color("red"), color("blue"), video("clip.mp4")], 2, 2)
 * $: gridStack([video("a.mp4"), video("b.mp4")], 3, 1)
 *
 */
export function gridStack(children: Pattern[], cols: any, rows: any): Pattern {
  return stack(...children.map((child, i) =>
    (child as any).gridModulo(i, children.length, cols, rows)
  ));
}

/**
 * Shorthand for gridStack(children, 2, 2) — arranges patterns in a 2×2 grid.
 *
 * @param {Pattern[]} children array of up to 4 patterns
 * @returns {Pattern} 2×2 grid of the given patterns
 * @example
 * $: four([color("red"), color("blue"), color("green"), video("clip.mp4")])
 *
 */
export function four(children: Pattern[]): Pattern {
  return gridStack(children, 2, 2);
}
