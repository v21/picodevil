import type { Pattern, Hap } from "@strudel/mini";

export interface VideoValue {
  src: string;
  speed: number;
  [key: string]: string | number;
}

type MiniParser = (input: string) => Pattern;

export class VideoPattern {
  srcPattern: Pattern;
  props: Record<string, Pattern>;
  private _parseMini: MiniParser;

  constructor(srcPattern: Pattern, props: Record<string, Pattern> = {}, parseMini: MiniParser) {
    this.srcPattern = srcPattern;
    this.props = props;
    this._parseMini = parseMini;
  }

  private _with(name: string, pat: string | number): VideoPattern {
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: this._parseMini(String(pat)),
    }, this._parseMini);
  }

  speed(pat: string | number): VideoPattern { return this._with("speed", pat); }

  queryArc(begin: number, end: number): Hap<VideoValue>[] {
    const srcEvents = this.srcPattern.queryArc(begin, end);
    return srcEvents.map((ev) => {
      const resolved: VideoValue = { src: ev.value, speed: 1 };
      for (const [k, p] of Object.entries(this.props)) {
        const propEvs = p.queryArc(begin, end);
        if (propEvs.length) {
          const v = propEvs[0].value;
          resolved[k] = isNaN(Number(v)) ? v : Number(v);
        }
      }
      return { ...ev, value: resolved };
    });
  }
}
