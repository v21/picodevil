/**
 * createMixParam — registers a named control on Pattern.prototype.
 *
 * Uses a custom combiner ("frame-time appLeft") that:
 * - Queries both patterns at frame time (like appBoth/set.mix) so continuous
 *   signals like sine animate smoothly every frame
 * - Preserves the source pattern's whole (like appLeft/set.in) so downstream
 *   operations like fit(), chop(), loopAt() see the true event duration
 *
 * For _perEvent controls (e.g. irand), the control is sampled at the hap's
 * onset instead of frame time, giving stable random values per event.
 *
 * See docs/combinators.md for detailed explanation.
 */
import { reify, Pattern, TimeSpan, Hap } from "@strudel/core";

const PatternProto = Pattern.prototype as any;

export function createMixParam(name: string) {
  const withVal = (v: any) => ({ [name]: v });

  const func = function (value: any, pat?: any) {
    if (!pat) return reify(value).withValue(withVal);
    if (value === undefined) return pat.fmap(withVal);
    const valPat = reify(value);
    const perEvent = !!(valPat as any)._perEvent;

    return new Pattern((state: any) => {
      const mainHaps = pat.query(state);
      return mainHaps.flatMap((hap: any) => {
        // Where to sample the control:
        // - default: current frame state → signals animate smoothly
        // - _perEvent: hap's onset → random values are stable per-event
        const ctrlState = perEvent
          ? state.setSpan(new TimeSpan(
              Number(hap.whole?.begin ?? hap.part.begin),
              Number(hap.whole?.begin ?? hap.part.begin) + 1e-4))
          : state;
        const ctrlHaps = valPat.query(ctrlState);
        if (!ctrlHaps.length) return [hap];

        if (perEvent) {
          // perEvent: control was sampled at onset, not frame time —
          // parts won't overlap, so just take the first value directly.
          // _perEvent patterns (rand, irand, choose) are signals that produce
          // exactly one hap per query — if that assumption breaks, this [0] is wrong.
          return [hap.withValue((v: any) => ({ ...v, [name]: ctrlHaps[0].value }))];
        }

        // Find control haps whose parts overlap this main hap's part
        const results: any[] = [];
        for (const ch of ctrlHaps) {
          const newPart = hap.part.intersection(ch.part);
          if (!newPart) continue;
          results.push(new Hap(
            hap.whole,   // PRESERVED from source pattern
            newPart,     // part intersected for correct rendering window
            { ...(typeof hap.value === 'object' && hap.value !== null
                  ? hap.value : {}),
              [name]: ch.value },
            hap.context
          ));
        }
        return results.length ? results : [hap];
      });
    });
  };

  PatternProto[name] = function (value: any) {
    return func(value, this);
  };

  return func;
}
