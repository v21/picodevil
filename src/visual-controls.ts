/**
 * Visual controls registered on Pattern.prototype via set.mix (appBoth).
 *
 * Unlike Strudel's default set.in (appLeft), set.mix queries both patterns
 * at the original query state (frame time), so continuous signals like sine
 * get sampled at the exact frame time rather than the event's onset.
 */
import { reify, Pattern } from "@strudel/core";
import { mini } from "@strudel/mini";

const PatternProto = Object.getPrototypeOf(reify(0));

/** Reify a value: strings go through mini(), everything else through reify(). */
function asPattern(value: any) {
  if (typeof value === "string") return mini(value);
  return reify(value);
}

function createMixParam(name: string) {
  const withVal = (v: any) => ({ [name]: v });

  const func = function (value: any, pat?: any) {
    if (!pat) return asPattern(value).withValue(withVal);
    if (value === undefined) return pat.fmap(withVal);
    return pat.set.mix(asPattern(value).withValue(withVal));
  };

  PatternProto[name] = function (value: any) {
    return func(value, this);
  };

  return func;
}

// Shared controls (all screen types)
export const alpha = createMixParam("alpha");
export const opacity = createMixParam("opacity");
export const scaleX = createMixParam("scaleX");
export const scaleY = createMixParam("scaleY");
export const fit = createMixParam("fit");

// Video-specific controls
export const speed = createMixParam("speed");
export const start = createMixParam("start");
export const end = createMixParam("end");
export const duration = createMixParam("duration");
