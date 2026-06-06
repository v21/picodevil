/**
 * Resolve the media the built-in examples reference into name→url seed entries.
 *
 * Prefers the local files in the sibling `bunnycdn/content/` (served offline via
 * the harness's /example-media/ mount, no network) and falls back to the live
 * CDN URLs when that directory is absent (bare checkout / CI) or `forceCdn`.
 *
 * Shared by test/example-bench.ts and test/example-golden.ts.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const MEDIA_SPEC_PATH = resolve(import.meta.dirname ?? ".", "baselines", "example-media.json");
// test/ -> .. (picodevil) -> .. (workspace root) -> bunnycdn/content
export const EXAMPLE_MEDIA_DIR = resolve(import.meta.dirname ?? ".", "..", "..", "bunnycdn", "content");

interface MediaSpec { entries: { name: string; file: string; cdn: string }[] }

export interface ResolvedMedia {
  entries: { name: string; url: string }[];
  mode: string;
  /** Directory to mount at /example-media/, or undefined in CDN mode. */
  mediaDir?: string;
}

export function resolveExampleMedia(forceCdn = false): ResolvedMedia {
  const spec: MediaSpec = JSON.parse(readFileSync(MEDIA_SPEC_PATH, "utf-8"));
  const useLocal = existsSync(EXAMPLE_MEDIA_DIR) && !forceCdn;
  if (useLocal) {
    return {
      entries: spec.entries.map(e => ({ name: e.name, url: `/example-media/${e.file}` })),
      mode: `local (${EXAMPLE_MEDIA_DIR})`,
      mediaDir: EXAMPLE_MEDIA_DIR,
    };
  }
  return {
    entries: spec.entries.map(e => ({ name: e.name, url: e.cdn })),
    mode: forceCdn ? "cdn (forced)" : "cdn (local media dir not found)",
  };
}
