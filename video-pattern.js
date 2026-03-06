export class VideoPattern {
  constructor(srcPattern, props = {}, parseMini = null) {
    this.srcPattern = srcPattern;
    this.props = props;
    this._parseMini = parseMini;
  }

  _with(name, pat) {
    return new VideoPattern(this.srcPattern, {
      ...this.props,
      [name]: this._parseMini(String(pat)),
    }, this._parseMini);
  }

  speed(pat) { return this._with("speed", pat); }

  queryArc(begin, end) {
    const srcEvents = this.srcPattern.queryArc(begin, end);
    return srcEvents.map((ev) => {
      const resolved = { src: ev.value, speed: 1 };
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
