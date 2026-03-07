import type { Pattern } from "@strudel/mini";
import { reify } from "@strudel/core";
import { ScreenPattern, overlay, type MiniParser, type FitMode } from "./screen-pattern";
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

function timeValueFromRaw(v: any): TimeValue {
  const n = Number(v);
  return isNaN(n) ? parseTimeValue(String(v)) : { value: n, unit: "rel" } as TimeValue;
}

export class VideoPattern extends ScreenPattern {
  private _srcPattern: Pattern;
  private _urlBase?: string;

  constructor(pattern: Pattern, srcPattern: Pattern, parseMini: MiniParser, onOut?: (vp: VideoPattern) => void, fitMode?: FitMode, urlBase?: string) {
    super(pattern, parseMini, onOut, fitMode);
    this._srcPattern = srcPattern;
    this._urlBase = urlBase;
  }

  /** Create a VideoPattern from a raw source pattern (mini string pattern). */
  static fromSrc(srcPattern: Pattern, parseMini: MiniParser, onOut?: (vp: VideoPattern) => void): VideoPattern {
    const pattern = srcPattern.withValue((v: string) => ({
      src: v,
      speed: 1,
      start: TIME_ZERO,
      end: TIME_END,
      endIsDuration: false,
    }));
    return new VideoPattern(pattern, srcPattern, parseMini, onOut);
  }

  get srcPattern(): Pattern { return this._srcPattern; }
  get videoUrlBase(): string | undefined { return this._urlBase; }

  _cloneWith(pattern: Pattern, fitMode: FitMode): this {
    return new VideoPattern(pattern, this._srcPattern, this._parseMini, this._onOut, fitMode, this._urlBase) as this;
  }

  urlBase(base: string): VideoPattern {
    return new VideoPattern(this.pattern, this._srcPattern, this._parseMini, this._onOut, this.fitMode, base);
  }

  private _withTimeProp(name: "start" | "end", pat: string | number | Pattern, endIsDuration?: boolean): VideoPattern {
    const parsed = this._asPat(pat);
    if (typeof pat !== 'object' || !('queryArc' in pat)) validateTimePattern(parsed, name);
    const propPat = reify(parsed).withValue((v: any) => {
      const tv = timeValueFromRaw(v);
      return endIsDuration !== undefined
        ? { [name]: tv, endIsDuration }
        : { [name]: tv };
    });
    return this._cloneWith(overlay(this.pattern, propPat), this.fitMode);
  }

  private _withProp(name: string, pat: string | number | Pattern): VideoPattern {
    const parsed = this._asPat(pat);
    const propPat = reify(parsed).withValue((v: any) => ({ [name]: isNaN(Number(v)) ? v : Number(v) }));
    return this._cloneWith(overlay(this.pattern, propPat), this.fitMode);
  }

  scrub(pat: string | number | Pattern): VideoPattern { return this._withTimeProp("start", pat).duration(0); }
  speed(pat: string | number | Pattern): VideoPattern { return this._withProp("speed", pat); }
  start(pat: string | number | Pattern): VideoPattern { return this._withTimeProp("start", pat); }
  end(pat: string | number | Pattern): VideoPattern { return this._withTimeProp("end", pat, false); }
  duration(pat: string | number | Pattern): VideoPattern { return this._withTimeProp("end", pat, true); }
  dur(pat: string | number | Pattern): VideoPattern { return this.duration(pat); }
}
