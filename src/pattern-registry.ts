import { Pattern, silence } from "@strudel/core";

let pPatterns: Record<string, Pattern> = {};
let anonymousIndex = 0;
let eachFn: ((p: Pattern) => Pattern) | undefined;
let allFns: ((p: Pattern) => Pattern)[] = [];

export type RegistrySnapshot = {
  pPatterns: Record<string, Pattern>;
  anonymousIndex: number;
  eachFn: ((p: Pattern) => Pattern) | undefined;
  allFns: ((p: Pattern) => Pattern)[];
};

export function initRegistry(): void {
  (Pattern.prototype as any).p = function(id: string) {
    if (id.startsWith('_') || id.endsWith('_')) return silence;
    if (id.includes('$')) {
      id = `${id}${anonymousIndex}`;
      anonymousIndex++;
    }
    pPatterns[id] = this;
    return this;
  };

  (Pattern.prototype as any).q = function(_id: string) {
    return silence;
  };

  try {
    for (let k = 1; k < 10; k++) {
      Object.defineProperty(Pattern.prototype, `d${k}`, {
        get() { return (this as any).p(String(k)); },
        configurable: true,
      });
      Object.defineProperty(Pattern.prototype, `p${k}`, {
        get() { return (this as any).p(String(k)); },
        configurable: true,
      });
    }
  } catch (e) {
    console.warn("initRegistry: error defining getter aliases:", e);
  }
}

export function resetRegistry(): void {
  pPatterns = {};
  anonymousIndex = 0;
  eachFn = undefined;
  allFns = [];
}

export function snapshotRegistry(): RegistrySnapshot {
  return {
    pPatterns: { ...pPatterns },
    anonymousIndex,
    eachFn,
    allFns: [...allFns],
  };
}

export function restoreRegistry(snapshot: RegistrySnapshot): void {
  pPatterns = snapshot.pPatterns;
  anonymousIndex = snapshot.anonymousIndex;
  eachFn = snapshot.eachFn;
  allFns = snapshot.allFns;
}

/** Collect registered patterns into a Screen[]. Named patterns are tagged
 * with their id via withState for future framebuffer routing. */
export function collectScreens(): Pattern[] {
  const pairs: [string, Pattern][] = [];
  let soloActive = false;

  for (const [key, pat] of Object.entries(pPatterns)) {
    const isSoloed = key.length > 1 && key.startsWith('S');
    if (isSoloed && !soloActive) {
      pairs.length = 0;
      soloActive = true;
    }
    if (!soloActive || isSoloed) {
      pairs.push([key, pat]);
    }
  }

  return pairs.map(([id, pat]) => {
    let p: Pattern = id.includes('$')
      ? pat
      : (pat as any).withState((s: any) => s.setControls({ id }));
    if (eachFn) p = eachFn(p);
    for (const fn of allFns) p = fn(p);
    return p;
  });
}

/** Apply fn to each registered pattern before rendering. */
export function each(fn: (p: Pattern) => Pattern): void {
  eachFn = fn;
}

/** Apply fn to every collected pattern after per-pattern processing. */
export function all(fn: (p: Pattern) => Pattern): void {
  allFns.push(fn);
}
