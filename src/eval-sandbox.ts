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
  stackLeft, stackRight, stackCentre, stackBy,
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
  Pattern,
} from "@strudel/core";
import { sin, cos, tan } from "./strudel-globals";
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
import { text } from "./text-pattern";
import { screen, s } from "./screen-pattern";
import { stackN } from "./grid-stack";
import { index, indexCycle, indexWith, indexCycleWith } from "./index-patterns";
import { echo } from "./visual-controls";
import { EVAL_TIMEOUT_MS } from "./config";

const METHOD_GLOBALS_BLOCKLIST = new Set([
  'constructor', 'query', 'queryArc', 'queryWhole',
  'fmap', 'bind', 'innerBind', 'withValue', 'withHaps',
  'getSteps', 'setSteps', 'hasSteps', 'withSteps',
  'toString', 'toJSON', 'log', 'logSteps', 'onError', 'deprecate',
  'p',
]);

let _methodGlobals: Record<string, unknown> | null = null;

const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function isUsableAsParam(name: string): boolean {
  try { new Function(name, ''); return true; } catch { return false; }
}

function buildMethodGlobals(): Record<string, unknown> {
  if (_methodGlobals) return _methodGlobals;
  const result: Record<string, unknown> = {};
  for (const name of Object.getOwnPropertyNames((Pattern as any).prototype)) {
    if (METHOD_GLOBALS_BLOCKLIST.has(name)) continue;
    if (!VALID_IDENTIFIER.test(name)) continue;
    if (!isUsableAsParam(name)) continue;
    const desc = Object.getOwnPropertyDescriptor((Pattern as any).prototype, name);
    if (!desc || typeof desc.value !== 'function') continue;
    result[name] = (...args: unknown[]) => (pat: any) => (pat as any)[name](...args);
  }
  return (_methodGlobals = result);
}

let _normMapBase: Map<string, string> | null = null;

/**
 * Build (and cache) a lowercase → canonical name map covering all pattern globals
 * and Pattern.prototype methods. Must be called after side-effect imports have run
 * (i.e. after visual-controls, effects-controls, etc. have registered their methods).
 * First-seen wins so camelCase canonical forms take precedence over lowercase aliases.
 */
export function buildNormMap(): Map<string, string> {
  if (_normMapBase) return _normMapBase;
  const map = new Map<string, string>();
  const add = (name: string) => {
    const lower = name.toLowerCase();
    if (!map.has(lower)) map.set(lower, name);
  };
  for (const key of Object.keys(getPatternGlobals())) add(key);
  for (const name of Object.getOwnPropertyNames((Pattern as any).prototype)) {
    if (name !== "constructor") add(name);
  }
  // JS literals — so a random-cased `tRue`/`FALSE`/`Null` normalizes back to the
  // keyword instead of surviving as an undefined identifier reference.
  for (const lit of ["true", "false", "null", "undefined", "NaN", "Infinity"]) add(lit);
  return (_normMapBase = map);
}

export function getPatternGlobals(): Record<string, unknown> {
  return {
    ...buildMethodGlobals(),
    mini,
    color, video, image, text, screen, s,
    stackN, index, indexCycle, indexWith, indexCycleWith,
    stack, cat, slowcat, fastcat, sequence, seq, arrange, slowcatPrime, polymeter,
    stepcat, stackLeft, stackRight, stackCentre, stackBy,
    silence, gap, nothing, pure, reify,
    useRNG,
    rand, rand2, irand, brand, brandBy, choose, wchoose, scramble,
    degradeBy, degrade, undegradeBy, undegrade,
    sometimesBy, sometimes, someCyclesBy, someCycles,
    often, rarely, almostNever, almostAlways, always, never,
    sine, sine2, sin, cosine, cosine2, cos, saw, saw2, isaw, isaw2,
    tan,
    tri, tri2, itri, itri2, square, square2, perlin,
    time, mouseX, mouseY, run, chooseIn, chooseCycles, signal, steady,
    addOn, subOn, mulOn, divOn, modOn, powOn, setOn, mapOn,
    echo,
  };
}

/**
 * Execute pre-transpiled user code with pattern globals plus any extra
 * runtime bindings (setCps, hush, loadVideo, slider, etc.) provided by main.ts.
 */
/**
 * Build the per-eval loop watchdog injected by the transpiler as `__pdGuard()`.
 * It throws once the eval has run past `budgetMs`, so a runaway loop aborts
 * instead of freezing the tab. The time check is throttled (every 16384 calls) so
 * the per-iteration cost on legitimate loops is just an integer increment + mask.
 */
export function makeEvalGuard(budgetMs: number = EVAL_TIMEOUT_MS): () => void {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const start = now();
  let n = 0;
  return () => {
    if ((++n & 0x3fff) === 0 && now() - start > budgetMs) {
      throw new Error(
        `Evaluation aborted: your code ran longer than ${budgetMs}ms — likely an infinite loop.`,
      );
    }
  };
}

export function runTranspiled(transpiled: string, extra: Record<string, unknown> = {}): void {
  const globals = { ...getPatternGlobals(), ...extra, __pdGuard: makeEvalGuard() };
  const names = Object.keys(globals);
  const values = Object.values(globals);
  new Function(...names, transpiled)(...values);
}
