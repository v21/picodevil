import type { Pattern } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type FitMode } from "./screen-pattern";

export class ImagePattern extends ScreenPattern {
  private _srcPattern: Pattern;
  private _urlBase?: string;

  constructor(pattern: Pattern, srcPattern: Pattern, parseMini: MiniParser, onOut?: (ip: ImagePattern) => void, fitMode?: FitMode, urlBase?: string) {
    super(pattern, parseMini, onOut, fitMode);
    this._srcPattern = srcPattern;
    this._urlBase = urlBase;
  }

  static fromSrc(srcPattern: Pattern, parseMini: MiniParser, onOut?: (ip: ImagePattern) => void): ImagePattern {
    return new ImagePattern(
      srcPattern.withValue((v: string) => ({ src: v })),
      srcPattern,
      parseMini,
      onOut,
    );
  }

  get srcPattern(): Pattern { return this._srcPattern; }
  get imageUrlBase(): string | undefined { return this._urlBase; }

  _cloneWith(pattern: Pattern, fitMode: FitMode): this {
    return new ImagePattern(pattern, this._srcPattern, this._parseMini, this._onOut, fitMode, this._urlBase) as this;
  }

  urlBase(base: string): ImagePattern {
    return new ImagePattern(this.pattern, this._srcPattern, this._parseMini, this._onOut, this.fitMode, base);
  }
}
