import { reify } from "@strudel/core";
import type { Pattern } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type FitMode } from "./screen-pattern";

export type GridDim = number | string | Pattern;

/** A screen is anything with queryArc — ScreenPattern or plain Pattern. */
export type Screen = { queryArc(begin: number, end: number): any[] };

export type GridOverride =
  | { type: 'set'; indexPat: Pattern; screen: Screen }
  | { type: 'mod'; indexPat: Pattern; fn: (screen: Screen) => Screen };

/** Clone a child: ScreenPatterns use _cloneWith, plain Patterns pass through (immutable). */
function cloneChild(src: Screen): Screen {
  if (src instanceof ScreenPattern) {
    return src._cloneWith(src.pattern, src.fitMode);
  }
  return src; // plain Pattern — immutable, no clone needed
}

export class GridPattern extends ScreenPattern {
  /** Source children — cycled at render time to fill current cell count. */
  children: Screen[];
  colsPat: Pattern;
  rowsPat: Pattern;
  cellState: (string | null)[];
  overrides: GridOverride[];

  constructor(
    children: Screen[],
    cols: GridDim,
    rows: GridDim,
    parseMini: MiniParser,
    onOut?: (gp: GridPattern) => void,
    fitMode?: FitMode,
    pattern?: any,
  ) {
    super(pattern ?? reify({}), parseMini, onOut, fitMode);
    this.colsPat = this._dimToPat(cols);
    this.rowsPat = this._dimToPat(rows);
    this.children = children.map(cloneChild);
    this.cellState = [];
    this.overrides = [];
  }

  private _dimToPat(dim: GridDim): Pattern {
    if (typeof dim === 'number') return reify(dim);
    if (this._isPattern(dim)) return dim;
    return this._parseMini(String(dim));
  }

  private _isPattern(v: any): v is Pattern {
    return typeof v === 'object' && v !== null && 'queryArc' in v;
  }

  private _indexToPat(index: number | string | Pattern): Pattern {
    if (this._isPattern(index)) return index;
    if (typeof index === 'number') return reify(index);
    return this._parseMini(String(index));
  }

  /** Resolve current cols/rows at time `t`. */
  resolveGrid(t: number): { cols: number; rows: number } {
    const colsHaps = this.colsPat.queryArc(t, t + 0.001);
    const cols = colsHaps.length > 0 ? Math.max(1, Math.floor(Number(colsHaps[0].value))) : 1;
    const rowsHaps = this.rowsPat.queryArc(t, t + 0.001);
    const rows = rowsHaps.length > 0 ? Math.max(1, Math.floor(Number(rowsHaps[0].value))) : 1;
    return { cols, rows };
  }

  /** Get the source child for cell `i` by cycling through source children. */
  childAt(i: number): Screen {
    return this.children[((i % this.children.length) + this.children.length) % this.children.length];
  }

  setI(index: number | string | Pattern, screen: Screen): this {
    const indexPat = this._indexToPat(index);
    const g = this._cloneWith(this.pattern, this.fitMode);
    g.overrides = [...this.overrides, { type: 'set', indexPat, screen }];
    return g;
  }

  modI(index: number | string | Pattern, fn: (screen: Screen) => Screen): this {
    const indexPat = this._indexToPat(index);
    const g = this._cloneWith(this.pattern, this.fitMode);
    g.overrides = [...this.overrides, { type: 'mod', indexPat, fn }];
    return g;
  }

  /** Resolve which screen to render for cell `i` at time `t`. */
  resolveChild(i: number, t: number): Screen {
    return this.resolveChildWithOverride(i, t).child;
  }

  /** Resolve child by applying all matching overrides in order. Indices wrap to current cell count. */
  resolveChildWithOverride(i: number, t: number): { child: Screen; overrideIndex: number } {
    const { cols, rows } = this.resolveGrid(t);
    const totalCells = cols * rows;
    const wrappedI = ((i % totalCells) + totalCells) % totalCells;
    let child = this.childAt(wrappedI);
    let lastOverride = -1;
    for (let o = 0; o < this.overrides.length; o++) {
      const override = this.overrides[o];
      const haps = override.indexPat.queryArc(t, t + 0.001);
      for (const h of haps) {
        const raw = Math.floor(Number(h.value));
        const wrapped = ((raw % totalCells) + totalCells) % totalCells;
        if (wrapped === wrappedI) {
          if (override.type === 'set') {
            child = override.screen;
          } else {
            child = override.fn(child);
          }
          lastOverride = o;
          break;
        }
      }
    }
    return { child, overrideIndex: lastOverride };
  }

  _cloneWith(pattern: any, fitMode: FitMode): this {
    const g = new GridPattern(
      this.children,
      this.colsPat,
      this.rowsPat,
      this._parseMini,
      this._onOut,
      fitMode,
      pattern,
    ) as this;
    g.children = this.children;
    g.cellState = this.cellState;
    g.overrides = this.overrides;
    return g;
  }
}
