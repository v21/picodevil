import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";

export function image(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`image() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === 'string' ? mini(pat) : pat;
  return p.withValue((v: string) => {
    if (typeof v !== 'string') {
      warn(`image pattern produced non-string value: ${typeof v}`);
    }
    return { _type: "image", src: v };
  });
}
