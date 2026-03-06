import type { Pattern, Hap } from "@strudel/mini";
import type { Outputable } from "./outputable";

export class ColorPattern implements Outputable {
  pattern: Pattern;
  private _onOut?: (cp: ColorPattern) => void;

  constructor(pattern: Pattern, onOut?: (cp: ColorPattern) => void) {
    this.pattern = pattern;
    this._onOut = onOut;
  }

  out(): void {
    if (this._onOut) this._onOut(this);
  }

  queryArc(begin: number, end: number): Hap[] {
    return this.pattern.queryArc(begin, end);
  }
}
