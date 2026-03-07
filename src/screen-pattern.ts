import type { Pattern } from "@strudel/mini";

export type MiniParser = (input: string) => Pattern;

export interface ScreenProps {
  alphaPattern?: Pattern;
}

export abstract class ScreenPattern {
  alphaPattern?: Pattern;
  protected _parseMini: MiniParser;
  protected _onOut?: (screen: any) => void;

  constructor(parseMini: MiniParser, onOut?: (screen: any) => void, screenProps?: ScreenProps) {
    this._parseMini = parseMini;
    this._onOut = onOut;
    this.alphaPattern = screenProps?.alphaPattern;
  }

  protected _asPat(pat: string | number | Pattern): Pattern {
    return typeof pat === 'object' && 'queryArc' in pat ? pat : this._parseMini(String(pat));
  }

  protected get _screenProps(): ScreenProps {
    return { alphaPattern: this.alphaPattern };
  }

  protected abstract _cloneWithScreenProps(props: ScreenProps): this;

  alpha(pat: string | number | Pattern): this {
    return this._cloneWithScreenProps({ ...this._screenProps, alphaPattern: this._asPat(pat) });
  }

  opacity(pat: string | number | Pattern): this { return this.alpha(pat); }

  out(): void {
    if (this._onOut) this._onOut(this);
  }
}
