import type { Pattern, Hap } from "@strudel/mini";
import type { Outputable } from "./outputable";

export interface VideoValue {
  src: string;
  speed: number;
  start: number;
  end: number;
  [key: string]: string | number;
}

type MiniParser = (input: string) => Pattern;

export class VideoPattern implements Outputable {
  srcPattern: Pattern;
  props: Record<string, Pattern>;
  private _endIsDuration: boolean;
  private _parseMini: MiniParser;
  private _onOut?: (vp: VideoPattern) => void;

  constructor(srcPattern: Pattern, props: Record<string, Pattern> = {}, parseMini: MiniParser, onOut?: (vp: VideoPattern) => void, endIsDuration = false) {
    this.srcPattern = srcPattern;
    this.props = props;
    this._parseMini = parseMini;
    this._onOut = onOut;
    this._endIsDuration = endIsDuration;
  }

  private _with(name: string, pat: string | number, endIsDuration?: boolean): VideoPattern {
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: this._parseMini(String(pat)),
    }, this._parseMini, this._onOut, endIsDuration ?? this._endIsDuration);
  }

  speed(pat: string | number): VideoPattern { return this._with("speed", pat); }
  start(pat: string | number): VideoPattern { return this._with("start", pat); }
  end(pat: string | number): VideoPattern { return this._with("end", pat, false); }
  duration(pat: string | number): VideoPattern { return this._with("end", pat, true); }

  out(): void {
    if (this._onOut) this._onOut(this);
  }

  queryArc(begin: number, end: number): Hap<VideoValue>[] {
    const srcEvents = this.srcPattern.queryArc(begin, end);
    return srcEvents.map((ev) => {
      const resolved: VideoValue = { src: ev.value, speed: 1, start: 0, end: Infinity };
      for (const [k, p] of Object.entries(this.props)) {
        const propEvs = p.queryArc(begin, end);
        if (propEvs.length) {
          const v = propEvs[0].value;
          resolved[k] = isNaN(Number(v)) ? v : Number(v);
        }
      }
      if (this._endIsDuration && typeof resolved.end === "number" && resolved.end !== Infinity) {
        resolved.end = resolved.start + resolved.end;
      }
      return { ...ev, value: resolved };
    });
  }
}
