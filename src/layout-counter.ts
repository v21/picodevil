let _counter = 0;
export function nextLayoutParent(): number { return ++_counter; }

// FNV-1a 32-bit hash
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

/**
 * Derive a stable, unique per-tile randSeed.
 * @param callId - unique ID for the stack op call site (from nextLayoutParent())
 * @param i - tile/slot index within this call
 * @param state - current query state; composes with any explicit .seed() in the chain
 * @param sourceLayoutParent - layoutParent from the source hap (if any); differentiates nested groups
 */
export function deriveRandSeed(callId: number, i: number, state: any, sourceLayoutParent?: number): number {
  const outerSeed = state.controls?.randSeed ?? 0;
  return hashStr(`${callId}:${i}:${outerSeed}:${sourceLayoutParent ?? 0}`);
}
