import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";

export function image(pat: string | Pattern): Pattern {
  const p = typeof pat === 'string' ? mini(pat) : pat;
  return p.withValue((v: string) => ({ _type: "image", src: v }));
}
