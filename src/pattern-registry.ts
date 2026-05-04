import { Pattern, silence } from "@strudel/core";

let pPatterns: Record<string, Pattern> = {};
let anonymousIndex = 0;
let eachFn: ((p: Pattern) => Pattern) | undefined;
let allFns: ((p: Pattern) => Pattern)[] = [];
let lastNamedIndices: { name: string; screenIndex: number }[] = [];

export type RegistrySnapshot = {
  pPatterns: Record<string, Pattern>;
  anonymousIndex: number;
  eachFn: ((p: Pattern) => Pattern) | undefined;
  allFns: ((p: Pattern) => Pattern)[];
};

/** Strip S or H prefix to get the user-facing FBO name. */
function fboName(id: string): string {
  if (id.length > 1 && (id.startsWith('S') || id.startsWith('H'))) return id.slice(1);
  return id;
}

export function initRegistry(): void {
  (Pattern.prototype as any).p = function(id: string) {
    if (id.startsWith('_') || id.endsWith('_')) return silence;
    if (id === 'all') {
      console.warn('.p("all") is reserved for the full-canvas FBO. Choose a different name.');
      return silence;
    }
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

  /**
   * Mark this pattern as FBO-only: it renders to its named offscreen framebuffer
   * but is not drawn to the main canvas. Equivalent to the `H` label prefix.
   * @example
   * mycomp: stack(color("red"), color("blue").alpha(0.5)).hide()
   * $: s("mycomp")
   */
  (Pattern.prototype as any).hide = function() {
    return (this as any).withValue((v: any) => ({ ...v, _fboOnly: true }));
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
  lastNamedIndices = [];
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
  lastNamedIndices = [];
}

/**
 * Returns true if `name` is a registered non-anonymous pattern (or the reserved "all").
 * Used by screen() to classify tokens as pattern FBO references.
 */
export function isNamedPattern(name: string): boolean {
  if (name === 'all') return true;
  if (name.includes('$')) return false;
  return (name in pPatterns) || (('S' + name) in pPatterns) || (('H' + name) in pPatterns);
}

/**
 * Returns the named-screen indices populated by the last collectScreens() call.
 * Each entry maps a stripped FBO name to its index in the screens array.
 */
export function getNamedScreenIndices(): { name: string; screenIndex: number }[] {
  return lastNamedIndices;
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

  lastNamedIndices = [];

  return pairs.map(([id, pat], screenIndex) => {
    const isAnon = id.includes('$');
    const isHidden = !isAnon && id.length > 1 && id.startsWith('H');
    const name = isAnon ? id : fboName(id);

    if (!isAnon) {
      lastNamedIndices.push({ name, screenIndex });
    }

    let p: Pattern = pat;
    if (isHidden) {
      p = (pat as any).withValue((v: any) => ({ ...v, _fboOnly: true }));
    }
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
