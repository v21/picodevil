import type { Pattern, Hap } from "@strudel/mini";
import type { Outputable } from "./outputable";
import { parseTimeValue, TIME_ZERO, TIME_END, type TimeValue } from "./time-value";

export interface VideoValue {
  src: string;
  speed: number;
  start: TimeValue;
  end: TimeValue;
  endIsDuration: boolean;
}

type MiniParser = (input: string) => Pattern;

/** Validate all values in a pattern by probing one full cycle. */
function validateTimePattern(pat: Pattern, label: string): void {
  const evs = pat.queryArc(0, 1);
  for (const ev of evs) {
    try { parseTimeValue(String(ev.value)); }
    catch { throw new Error(`Invalid ${label} value: "${ev.value}"`); }
  }
}

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

  private _withTime(name: string, pat: string | number, endIsDuration?: boolean): VideoPattern {
    const parsed = this._parseMini(String(pat));
    validateTimePattern(parsed, name);
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: parsed,
    }, this._parseMini, this._onOut, endIsDuration ?? this._endIsDuration);
  }

  private _with(name: string, pat: string | number): VideoPattern {
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: this._parseMini(String(pat)),
    }, this._parseMini, this._onOut, this._endIsDuration);
  }

  speed(pat: string | number): VideoPattern { return this._with("speed", pat); }
  start(pat: string | number): VideoPattern { return this._withTime("start", pat); }
  end(pat: string | number): VideoPattern { return this._withTime("end", pat, false); }
  duration(pat: string | number): VideoPattern { return this._withTime("end", pat, true); }
  dur(pat: string | number): VideoPattern { return this.duration(pat); }

  out(): void {
    if (this._onOut) this._onOut(this);
  }

  queryArc(begin: number, end: number): Hap<VideoValue>[] {
    const srcEvents = this.srcPattern.queryArc(begin, end);
    return srcEvents.map((ev) => {
      const resolved: VideoValue = {
        src: ev.value,
        speed: 1,
        start: TIME_ZERO,
        end: TIME_END,
        endIsDuration: this._endIsDuration,
      };

      for (const [k, p] of Object.entries(this.props)) {
        const propEvs = p.queryArc(begin, end);
        if (propEvs.length) {
          const v = propEvs[0].value;
          if (k === "start" || k === "end") {
            (resolved as any)[k] = parseTimeValue(String(v));
          } else {
            (resolved as any)[k] = isNaN(Number(v)) ? v : Number(v);
          }
        }
      }
      return { ...ev, value: resolved };
    });
  }
}
