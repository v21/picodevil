import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";

export function video(pat: string): Pattern {
  return mini(pat).withValue((v: string) => ({ _type: "video", src: v }));
}
