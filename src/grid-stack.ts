import { stack } from "@strudel/core";
import type { Pattern } from "@strudel/mini";
import "./visual-controls";

export function gridStack(children: Pattern[], cols: any, rows: any): Pattern {
  return stack(...children.map((child, i) =>
    (child as any).gridModulo(i, children.length, cols, rows)
  ));
}

export function four(children: Pattern[]): Pattern {
  return gridStack(children, 2, 2);
}
