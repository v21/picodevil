/**
 * Shared eval sandbox globals for user code execution.
 *
 * `getPatternGlobals()` returns the pure pattern-construction bindings
 * available in the editor. Both `main.ts` (via `runTranspiled`) and test
 * helpers use this as the single source of truth, so adding a new user-facing
 * function only requires editing this file.
 *
 * `runTranspiled(transpiled, extra?)` executes pre-transpiled code with these
 * globals, plus any additional runtime-stateful bindings (setCps, hush, etc.)
 * provided by the caller.
 */
import { mini } from "@strudel/mini";
import {
  stack, cat, slowcat, fastcat, sequence, seq,
  arrange, slowcatPrime, polymeter, stepcat,
  silence, gap, nothing, pure, reify,
  sine, sine2, cosine, cosine2,
  saw, saw2, isaw, isaw2,
  tri, tri2, itri, itri2,
  square, square2,
  perlin,
  time, mouseX, mouseY,
  run, chooseIn, chooseCycles,
  signal, steady,
  useRNG,
} from "@strudel/core";
import {
  rand, rand2, irand, brand, brandBy,
  choose, wchoose, scramble,
  degradeBy, degrade, undegradeBy, undegrade,
  sometimesBy, sometimes, someCyclesBy, someCycles,
  often, rarely, almostNever, almostAlways, always, never,
} from "./event-random";
import { addOn, subOn, mulOn, divOn, modOn, powOn, setOn, mapOn } from "./pattern-extensions";
import { color } from "./color-pattern";
import { video } from "./video-pattern";
import { image } from "./image-pattern";
import { screen, s } from "./screen-pattern";
import { stackN } from "./grid-stack";
import { index, indexCycle, indexWith, indexCycleWith } from "./index-patterns";

export function getPatternGlobals(): Record<string, unknown> {
  return {
    mini,
    color, video, image, screen, s,
    stackN, index, indexCycle, indexWith, indexCycleWith,
    stack, cat, slowcat, fastcat, sequence, seq, arrange, slowcatPrime, polymeter,
    stepcat, silence, gap, nothing, pure, reify,
    useRNG,
    rand, rand2, irand, brand, brandBy, choose, wchoose, scramble,
    degradeBy, degrade, undegradeBy, undegrade,
    sometimesBy, sometimes, someCyclesBy, someCycles,
    often, rarely, almostNever, almostAlways, always, never,
    sine, sine2, cosine, cosine2, saw, saw2, isaw, isaw2,
    tri, tri2, itri, itri2, square, square2, perlin,
    time, mouseX, mouseY, run, chooseIn, chooseCycles, signal, steady,
    addOn, subOn, mulOn, divOn, modOn, powOn, setOn, mapOn,
  };
}

/**
 * Execute pre-transpiled user code with pattern globals plus any extra
 * runtime bindings (setCps, hush, loadVideo, slider, etc.) provided by main.ts.
 */
export function runTranspiled(transpiled: string, extra: Record<string, unknown> = {}): void {
  const globals = { ...getPatternGlobals(), ...extra };
  const names = Object.keys(globals);
  const values = Object.values(globals);
  new Function(...names, transpiled)(...values);
}
