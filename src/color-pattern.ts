import type { Pattern } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type FitMode } from "./screen-pattern";

export class ColorPattern extends ScreenPattern {
  constructor(pattern: Pattern, parseMini: MiniParser, onOut?: (cp: ColorPattern) => void, fitMode?: FitMode) {
    super(pattern, parseMini, onOut, fitMode);
  }

  static fromMini(pat: Pattern, parseMini: MiniParser, onOut?: (cp: ColorPattern) => void): ColorPattern {
    return new ColorPattern(pat.withValue((v: string) => ({ color: v })), parseMini, onOut);
  }

  _cloneWith(pattern: Pattern, fitMode: FitMode): this {
    return new ColorPattern(pattern, this._parseMini, this._onOut, fitMode) as this;
  }
}
