import type { Pattern, Hap } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type ScreenProps } from "./screen-pattern";

export class ColorPattern extends ScreenPattern {
  pattern: Pattern;

  constructor(pattern: Pattern, parseMini: MiniParser, onOut?: (cp: ColorPattern) => void, screenProps?: ScreenProps) {
    super(parseMini, onOut, screenProps);
    this.pattern = pattern;
  }

  protected _cloneWithScreenProps(props: ScreenProps): this {
    return new ColorPattern(this.pattern, this._parseMini, this._onOut, props) as this;
  }

  queryArc(begin: number, end: number): Hap[] {
    return this.pattern.queryArc(begin, end);
  }
}
