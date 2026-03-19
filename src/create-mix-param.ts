/**
 * createMixParam — registers a named control on Pattern.prototype.
 *
 * Uses a custom combiner ("frame-time appLeft") that:
 * - Queries both patterns at frame time (like appBoth/set.mix) so continuous
 *   signals like sine animate smoothly every frame
 * - Preserves the source pattern's whole (like appLeft/set.in) so downstream
 *   operations like fit(), chop(), loopAt() see the true event duration
 *
 * For _perEvent controls (e.g. irand), we delegate to Strudel's appLeft
 * which samples the control at the hap's whole span — giving stable random
 * values per event rather than flickering every frame.
 *
 * See docs/combinators.md for detailed explanation.
 */
import { reify, Pattern, Hap } from "@strudel/core";

const PatternProto = Pattern.prototype as any;

export function createMixParam(name: string) {
  const withVal = (v: any) => ({ [name]: v });

  const func = function (value: any, pat?: any) {
    if (!pat) return reify(value).withValue(withVal);
    if (value === undefined) return pat.fmap(withVal);
    const valPat = reify(value);

    // _perEvent controls (rand, irand, choose): use Strudel's appLeft which
    // samples the control at the hap's onset, giving stable per-event values.
    if ((valPat as any)._perEvent) {
      return pat.fmap((v: any) => (ctrl: any) => ({
        ...(typeof v === 'object' && v !== null ? v : {}),
        [name]: ctrl,
      })).appLeft(valPat);
    }

    // Frame-time combiner: query control at current state so signals animate
    // smoothly, but preserve source pattern's whole for downstream operations.
    return new Pattern((state: any) => {
      const mainHaps = pat.query(state);
      return mainHaps.flatMap((hap: any) => {
        const ctrlHaps = valPat.query(state);
        if (!ctrlHaps.length) return [hap];

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
