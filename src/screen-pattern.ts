import type { Pattern, Hap } from "@strudel/mini";
import { Pattern as PatternClass, reify } from "@strudel/core";

export type MiniParser = (input: string) => Pattern;
export type FitMode = "cover" | "contain" | "fill" | "none";

/**
 * Combine a base pattern with a param pattern by querying both at the
 * **original query state** and merging values. Unlike Strudel's `.set()`
 * (which uses `appLeft` and re-queries the right pattern over the left
 * event's `whole` span), this preserves continuous signal sampling at
 * the exact frame time.
 */
export function overlay(base: Pattern, param: Pattern): Pattern {
  return new PatternClass((state: any) => {
    const baseHaps = base.query(state);
    const paramHaps = param.query(state);
    if (!paramHaps.length) return baseHaps;
    // For each base event, merge the first overlapping param value
    return baseHaps.map((bh: any) => {
      const ph = paramHaps.find((p: any) => bh.part.intersection(p.part));
      if (!ph) return bh;
      return bh.withValue(() => ({ ...bh.value, ...ph.value }));
    });
  });
}

export abstract class ScreenPattern {
  pattern: Pattern;
  fitMode: FitMode;
  protected _parseMini: MiniParser;
  protected _onOut?: (screen: any) => void;

  constructor(pattern: Pattern, parseMini: MiniParser, onOut?: (screen: any) => void, fitMode?: FitMode) {
    this.pattern = pattern;
    this._parseMini = parseMini;
    this._onOut = onOut;
    this.fitMode = fitMode ?? "cover";
  }

  protected _asPat(pat: string | number | Pattern): Pattern {
    return typeof pat === 'object' && 'queryArc' in pat ? pat : this._parseMini(String(pat));
  }

  /** Create a clone with a new pattern and/or fitMode. Public so GridPattern can clone children. */
  abstract _cloneWith(pattern: Pattern, fitMode: FitMode): this;

  alpha(pat: string | number | Pattern): this {
    const alphaPat = reify(this._asPat(pat)).withValue((v: any) => ({ alpha: Number(v) }));
    return this._cloneWith(overlay(this.pattern, alphaPat), this.fitMode);
  }

  opacity(pat: string | number | Pattern): this { return this.alpha(pat); }

  fit(mode: FitMode): this {
    return this._cloneWith(this.pattern, mode);
  }

  scaleX(pat: string | number | Pattern): this {
    const sxPat = reify(this._asPat(pat)).withValue((v: any) => ({ scaleX: Number(v) }));
    return this._cloneWith(overlay(this.pattern, sxPat), this.fitMode);
  }

  scaleY(pat: string | number | Pattern): this {
    const syPat = reify(this._asPat(pat)).withValue((v: any) => ({ scaleY: Number(v) }));
    return this._cloneWith(overlay(this.pattern, syPat), this.fitMode);
  }

  scale(pat: string | number | Pattern): this {
    const p = this._asPat(pat);
    const sPat = reify(p).withValue((v: any) => ({ scaleX: Number(v), scaleY: Number(v) }));
    return this._cloneWith(overlay(this.pattern, sPat), this.fitMode);
  }

  queryArc(begin: number, end: number): Hap[] {
    return this.pattern.queryArc(begin, end);
  }

  out(): void {
    if (this._onOut) this._onOut(this);
  }
}
