import type { Pattern, Hap } from "@strudel/mini";
import type { Outputable } from "./outputable";

type MiniParser = (input: string) => Pattern;

export class ColorPattern implements Outputable {
  pattern: Pattern;
  alphaPattern?: Pattern;
  private _parseMini: MiniParser;
  private _onOut?: (cp: ColorPattern) => void;

  constructor(pattern: Pattern, parseMini: MiniParser, onOut?: (cp: ColorPattern) => void, alphaPattern?: Pattern) {
    this.pattern = pattern;
    this._parseMini = parseMini;
    this._onOut = onOut;
    this.alphaPattern = alphaPattern;
  }

  private _asPat(pat: string | number | Pattern): Pattern {
    return typeof pat === 'object' && 'queryArc' in pat ? pat : this._parseMini(String(pat));
  }

  alpha(pat: string | number | Pattern): ColorPattern {
    return new ColorPattern(this.pattern, this._parseMini, this._onOut, this._asPat(pat));
  }

  out(): void {
    if (this._onOut) this._onOut(this);
  }

  queryArc(begin: number, end: number): Hap[] {
    return this.pattern.queryArc(begin, end);
  }
}
