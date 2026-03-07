import { reify } from "@strudel/core";
import type { Pattern } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type FitMode } from "./screen-pattern";

export interface GridOverride {
  indexPat: Pattern;
  screen: ScreenPattern;
}

export class GridPattern extends ScreenPattern {
  children: ScreenPattern[];
  cols: number;
  rows: number;
  cellState: (string | null)[];
  overrides: GridOverride[];

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
    this.overrides = [];
  }

  private _isPattern(v: any): v is Pattern {
    return typeof v === 'object' && v !== null && 'queryArc' in v;
  }

  setI(index: number | string | Pattern, screen: ScreenPattern): this {
    if (this._isPattern(index)) {
      // Dynamic override — resolved at render time
      const g = this._cloneWith(this.pattern, this.fitMode);
      g.overrides = [...this.overrides, { indexPat: index, screen }];
      return g;
    }

    // Static override — replace in children array at build time
    const indices: Set<number> = new Set();
    if (typeof index === 'number') {
      indices.add(index);
    } else {
      const pat = this._parseMini(String(index));
      const haps = pat.queryArc(0, 1);
      for (const h of haps) indices.add(Math.floor(Number(h.value)));
    }

    const newChildren = this.children.map((child, i) =>
      indices.has(i) ? screen._cloneWith(screen.pattern, screen.fitMode) : child
    );

    const g = new GridPattern(
      newChildren,
      this.cols,
      this.rows,
      this._parseMini,
      this._onOut,
      this.fitMode,
      this.pattern,
    ) as this;
    g.children = newChildren; // bypass constructor re-cloning
    g.cellState = [...this.cellState];
    g.overrides = [...this.overrides];
    return g;
  }

  /** Resolve which screen to render for cell `i` at time `t`. */
  resolveChild(i: number, t: number): ScreenPattern {
    return this.resolveChildWithOverride(i, t).child;
  }

  /** Resolve child and return which override index matched (-1 if none). */
  resolveChildWithOverride(i: number, t: number): { child: ScreenPattern; overrideIndex: number } {
    for (let o = this.overrides.length - 1; o >= 0; o--) {
      const haps = this.overrides[o].indexPat.queryArc(t, t + 0.001);
      for (const h of haps) {
        if (Math.floor(Number(h.value)) === i) {
          return { child: this.overrides[o].screen, overrideIndex: o };
        }
      }
    }
    return { child: this.children[i], overrideIndex: -1 };
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
    g.overrides = this.overrides;
    return g;
  }
}
