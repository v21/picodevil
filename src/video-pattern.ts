import type { Pattern, Hap } from "@strudel/mini";
import { ScreenPattern, type MiniParser, type ScreenProps } from "./screen-pattern";
import { parseTimeValue, TIME_ZERO, TIME_END, type TimeValue } from "./time-value";

export interface VideoValue {
  src: string;
  speed: number;
  start: TimeValue;
  end: TimeValue;
  endIsDuration: boolean;
}

/** Validate all values in a pattern by probing one full cycle. */
function validateTimePattern(pat: Pattern, label: string): void {
  const evs = pat.queryArc(0, 1);
  for (const ev of evs) {
    try { parseTimeValue(String(ev.value)); }
    catch { throw new Error(`Invalid ${label} value: "${ev.value}"`); }
  }
}

export class VideoPattern extends ScreenPattern {
  srcPattern: Pattern;
  props: Record<string, Pattern>;
  private _endIsDuration: boolean;

  constructor(srcPattern: Pattern, props: Record<string, Pattern> = {}, parseMini: MiniParser, onOut?: (vp: VideoPattern) => void, endIsDuration = false, screenProps?: ScreenProps) {
    super(parseMini, onOut, screenProps);
    this.srcPattern = srcPattern;
    this.props = props;
    this._endIsDuration = endIsDuration;
  }

  protected _cloneWithScreenProps(props: ScreenProps): this {
    return new VideoPattern(this.srcPattern, this.props, this._parseMini, this._onOut, this._endIsDuration, props) as this;
  }

  private _withTime(name: string, pat: string | number | Pattern, endIsDuration?: boolean): VideoPattern {
    const parsed = this._asPat(pat);
    if (typeof pat !== 'object' || !('queryArc' in pat)) validateTimePattern(parsed, name);
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: parsed,
    }, this._parseMini, this._onOut, endIsDuration ?? this._endIsDuration, this._screenProps);
  }

  private _with(name: string, pat: string | number | Pattern): VideoPattern {
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: this._asPat(pat),
    }, this._parseMini, this._onOut, this._endIsDuration, this._screenProps);
  }

  scrub(pat: string | number | Pattern): VideoPattern { return this._withTime("start", pat).duration(0); }
  speed(pat: string | number | Pattern): VideoPattern { return this._with("speed", pat); }
  start(pat: string | number | Pattern): VideoPattern { return this._withTime("start", pat); }
  end(pat: string | number | Pattern): VideoPattern { return this._withTime("end", pat, false); }
  duration(pat: string | number | Pattern): VideoPattern { return this._withTime("end", pat, true); }
  dur(pat: string | number | Pattern): VideoPattern { return this.duration(pat); }

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
            const n = Number(v);
            (resolved as any)[k] = isNaN(n) ? parseTimeValue(String(v)) : { value: n, unit: "rel" } as TimeValue;
          } else {
            (resolved as any)[k] = isNaN(Number(v)) ? v : Number(v);
          }
        }
      }
      return { ...ev, value: resolved };
    });
  }
}
