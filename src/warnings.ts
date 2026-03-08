/**
 * Runtime warning system for uzuvid.
 *
 * Collects warnings during rendering, deduped by message.
 * Warnings are shown in the editor overlay and exposed to the monkey tester
 * via window.uzuWarnings.
 */

const warnings = new Set<string>();
let listeners: ((msgs: string[]) => void)[] = [];

/** Emit a runtime warning. Deduped per flush cycle. */
export function warn(msg: string) {
  if (warnings.has(msg)) return;
  warnings.add(msg);
  console.warn("[uzu]", msg);
}

/** Flush warnings and notify listeners. Call once per eval or periodically. */
export function flushWarnings(): string[] {
  if (warnings.size === 0) return [];
  const msgs = [...warnings];
  warnings.clear();
  for (const fn of listeners) fn(msgs);
  return msgs;
}

/** Clear all warnings without notifying. */
export function clearWarnings() {
  warnings.clear();
}

/** Subscribe to warning flushes. Returns unsubscribe function. */
export function onWarnings(fn: (msgs: string[]) => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

/** Current warning count (for testing). */
export function warningCount(): number {
  return warnings.size;
}

// Expose for monkey tester
if (typeof window !== "undefined") {
  (window as any).uzuWarnings = [] as string[];
  onWarnings((msgs) => {
    (window as any).uzuWarnings.push(...msgs);
  });
}
