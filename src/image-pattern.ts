import type { Pattern, Hap } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type ScreenProps } from "./screen-pattern";

export class ImagePattern extends ScreenPattern {
  srcPattern: Pattern;
  private _urlBase?: string;

  constructor(srcPattern: Pattern, parseMini: MiniParser, onOut?: (ip: ImagePattern) => void, screenProps?: ScreenProps, urlBase?: string) {
    super(parseMini, onOut, screenProps);
    this.srcPattern = srcPattern;
    this._urlBase = urlBase;
  }

  get imageUrlBase(): string | undefined { return this._urlBase; }

  protected _cloneWithScreenProps(props: ScreenProps): this {
    return new ImagePattern(this.srcPattern, this._parseMini, this._onOut, props, this._urlBase) as this;
  }

  urlBase(base: string): ImagePattern {
    return new ImagePattern(this.srcPattern, this._parseMini, this._onOut, this._screenProps, base);
  }

  queryArc(begin: number, end: number): Hap[] {
    return this.srcPattern.queryArc(begin, end);
  }
}
