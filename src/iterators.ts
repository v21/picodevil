/**
 * Round-robins between arguments, cycling through each independently.
 * Arrays advance their own index; single values repeat forever.
 *
 * @example
 * cycle([video("a.mp4"), video("b.mp4")], video("c.mp4"))
 * // yields: a, c, b, c, a, c, ...
 */
function isIterable(a: any): boolean {
  return a != null && typeof a[Symbol.iterator] === 'function' && typeof a.queryArc !== 'function' && !Array.isArray(a);
}

export function cycle(...args: any[]): Iterable<any> {
  return {
    [Symbol.iterator]: function* () {
      // Each arg gets its own iterator: arrays cycle by index, iterables advance, single patterns repeat
      const iters: (Iterator<any> | null)[] = args.map(a =>
        isIterable(a) ? a[Symbol.iterator]() : null
      );
      const indices = new Array(args.length).fill(0);
      let slot = 0;
      while (true) {
        const a = args[slot];
        if (iters[slot]) {
          const result = iters[slot]!.next();
          if (result.done) return;
          yield result.value;
        } else if (Array.isArray(a)) {
          yield a[indices[slot]++ % a.length];
        } else {
          yield a;
        }
        slot = (slot + 1) % args.length;
      }
    }
  };
}
