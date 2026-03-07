import { reify } from "@strudel/core";
import { ScreenPattern, type MiniParser, type FitMode } from "./screen-pattern";

export class GridPattern extends ScreenPattern {
  children: ScreenPattern[];
  cols: number;
  rows: number;
  cellState: (string | null)[];

  constructor(
    children: ScreenPattern[],
    cols: number,
    rows: number,
    parseMini: MiniParser,
    onOut?: (gp: GridPattern) => void,
    fitMode?: FitMode,
    pattern?: any,
  ) {
    super(pattern ?? reify({}), parseMini, onOut, fitMode);
    this.cols = cols;
    this.rows = rows;

    // Fill grid cells by cycling through children array, cloning each
    const totalCells = cols * rows;
    this.children = [];
    for (let i = 0; i < totalCells; i++) {
      const src = children[i % children.length];
      this.children.push(src._cloneWith(src.pattern, src.fitMode));
    }

    this.cellState = new Array(totalCells).fill(null);
  }

  _cloneWith(pattern: any, fitMode: FitMode): this {
    const g = new GridPattern(
      this.children,
      this.cols,
      this.rows,
      this._parseMini,
      this._onOut,
      fitMode,
      pattern,
    ) as this;
    // Avoid re-cloning children — use them directly since they're already clones
    g.children = this.children;
    g.cellState = this.cellState;
    return g;
  }
}
