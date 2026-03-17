/**
 * createMixParam — registers a named control on Pattern.prototype via set.mix (appBoth).
 *
 * Unlike Strudel's default set.in (appLeft), set.mix queries both patterns
 * at the original query state (frame time), so continuous signals like sine
 * get sampled at the exact frame time rather than the event's onset.
 */
import { reify, Pattern, TimeSpan } from "@strudel/core";

const PatternProto = Pattern.prototype as any;

export function createMixParam(name: string) {
  const withVal = (v: any) => ({ [name]: v });

  const func = function (value: any, pat?: any) {
    if (!pat) return reify(value).withValue(withVal);
    if (value === undefined) return pat.fmap(withVal);
    const valPat = reify(value);
    if ((valPat as any)._perEvent) {
      // Per-event mode: query the control at each hap's onset time, not the current frame time.
      // This makes random signals stable for the duration of a hap instead of flickering.
      // We use state.setSpan (not queryArc) so that state.controls (e.g. randSeed injected by
      // indexCycle/index) is preserved through to the rand signal evaluation.
      return new Pattern((state: any) => {
        return pat.query(state).map((hap: any) => {
          const onset = Number(hap.whole?.begin ?? hap.part.begin);
          const onsetState = state.setSpan(new TimeSpan(onset, onset + 1e-4));
          const ctrlHaps = valPat.query(onsetState);
          if (!ctrlHaps.length) return hap;
          return hap.withValue((v: any) => ({ ...v, [name]: ctrlHaps[0].value }));
        });
      });
    }
    return pat.set.mix(valPat.withValue(withVal));
  };

  PatternProto[name] = function (value: any) {
    return func(value, this);
  };

  return func;
}
