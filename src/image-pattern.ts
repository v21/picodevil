import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";

export function image(pat: string): Pattern {
  return mini(pat).withValue((v: string) => ({ _type: "image", src: v }));
}
