/**
 * Vite plugin that extracts JSDoc from source files and Strudel dependencies
 * to produce a virtual module `virtual:reference-data` for the sidebar reference tab.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

interface RefEntry {
  name: string;
  description: string;
  params: string[];
  examples: string[];
  aliases: string[];
  isMethod: boolean; // .foo() vs foo()
}

interface RefCategory {
  name: string;
  sourceFile: string;
  entries: RefEntry[];
}

// Parse a JSDoc block into description, @param, @example
function parseJSDoc(block: string): { description: string; params: string[]; examples: string[] } {
  const lines = block.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").replace(/^\s*\/\*\*\s*/, "").replace(/\s*\*\/\s*$/, ""));
  let description = "";
  const params: string[] = [];
  const examples: string[] = [];
  let inExample = false;
  let currentExample = "";

  for (const line of lines) {
    if (line.startsWith("@example")) {
      if (inExample && currentExample.trim()) examples.push(currentExample.trim());
      inExample = true;
      currentExample = "";
    } else if (line.startsWith("@param")) {
      inExample = false;
      if (currentExample.trim()) examples.push(currentExample.trim());
      currentExample = "";
      // Extract param description, skip type annotations
      const m = line.match(/@param\s+(?:\{[^}]*\}\s+)?(\S+)\s*(.*)/);
      if (m) params.push(`${m[1]}: ${m[2]}`);
    } else if (line.startsWith("@")) {
      // other tags — end example
      if (inExample && currentExample.trim()) examples.push(currentExample.trim());
      inExample = false;
      currentExample = "";
    } else if (inExample) {
      currentExample += line + "\n";
    } else {
      if (line.trim()) description += (description ? " " : "") + line.trim();
    }
  }
  if (inExample && currentExample.trim()) examples.push(currentExample.trim());
  return { description, params, examples };
}

// Extract all JSDoc + export pairs from a file
function extractFromFile(source: string, filterNames?: Set<string>): RefEntry[] {
  const entries: RefEntry[] = [];
  // Match JSDoc (no nested comment blocks) followed by declaration
  const pattern = /(\/\*\*(?:[^*]|\*(?!\/))*\*\/)\s*\n\s*(?:export\s+(?:const|function)\s+(\w+)|PatternProto\.(\w+)\s*=|const\s+(\w+)\s*=)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const jsdocBlock = match[1];
    const name = match[2] || match[3] || match[4];
    if (!name) continue;
    if (filterNames && !filterNames.has(name)) continue;

    const { description, params, examples } = parseJSDoc(jsdocBlock);
    if (!description) continue;

    entries.push({ name, description, params, examples, aliases: [], isMethod: !!match[3] });
  }
  return entries;
}

// Find aliases like PatternProto.left = PatternProto.x
function findAliases(source: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const re = /PatternProto\.(\w+)\s*=\s*PatternProto\.(\w+)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const [, alias, target] = m;
    if (!aliases.has(target)) aliases.set(target, []);
    aliases.get(target)!.push(alias);
  }
  // Also: PatternProto.dur = PatternProto.duration style
  return aliases;
}

function extractStrudelSignals(source: string, names: Set<string>): RefEntry[] {
  const entries: RefEntry[] = [];
  // Match JSDoc followed by export const <name>
  const re = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\nexport\s+const\s+(\w+)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[2];
    if (!names.has(name)) continue;
    const { description, params, examples } = parseJSDoc(m[1]);
    if (!description) continue;
    entries.push({ name, description, params, examples, aliases: [], isMethod: false });
  }
  // Also match: export function <name>
  const re2 = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\nexport\s+function\s+(\w+)/g;
  while ((m = re2.exec(source)) !== null) {
    const name = m[2];
    if (!names.has(name)) continue;
    const { description, params, examples } = parseJSDoc(m[1]);
    if (!description) continue;
    entries.push({ name, description, params, examples, aliases: [], isMethod: false });
  }
  return entries;
}

function buildReferenceData(root: string): RefCategory[] {
  const categories: RefCategory[] = [];

  // --- uzuvid source files ---
  const fileMap: [string, string][] = [
    ["Sources", "src/color-pattern.ts"],
    ["Sources", "src/video-pattern.ts"],
    ["Sources", "src/image-pattern.ts"],
    ["Sources", "src/screen-pattern.ts"],
    ["Controls", "src/visual-controls.ts"],
    ["Interpolation", "src/pattern-extensions.ts"],
    ["Layout", "src/grid-stack.ts"],
    ["Indexing", "src/index-patterns.ts"],
    ["Iteration", "src/iterators.ts"],
  ];

  const catMap = new Map<string, RefEntry[]>();
  for (const [catName, filePath] of fileMap) {
    const fullPath = resolve(root, filePath);
    let source: string;
    try {
      source = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    const entries = extractFromFile(source);
    const aliases = findAliases(source);
    // Attach aliases to entries
    for (const entry of entries) {
      if (aliases.has(entry.name)) {
        entry.aliases = aliases.get(entry.name)!;
      }
    }
    if (!catMap.has(catName)) catMap.set(catName, []);
    catMap.get(catName)!.push(...entries);
  }

  for (const [name, entries] of catMap) {
    if (entries.length > 0) {
      categories.push({ name, sourceFile: "", entries });
    }
  }

  // --- Global functions from main.ts ---
  const globalNames = new Set(["setCps", "setCpm", "hush"]);
  const mainSource = readFileSync(resolve(root, "src/main.ts"), "utf-8");
  const globalEntries = extractFromFile(mainSource, globalNames);
  if (globalEntries.length > 0) {
    categories.push({ name: "Global", sourceFile: "src/main.ts", entries: globalEntries });
  }

  // --- Strudel signals ---
  const signalNames = new Set([
    "sine", "sine2", "cosine", "cosine2",
    "saw", "saw2", "isaw", "isaw2",
    "tri", "tri2", "itri", "itri2",
    "square", "square2",
    "rand", "rand2", "irand", "brand", "brandBy",
    "perlin",
    "time", "mouseX", "mouseY",
    "run", "choose", "chooseIn", "chooseCycles",
    "signal", "steady", "useRNG",
  ]);

  const signalPath = resolve(root, "node_modules/@strudel/core/signal.mjs");
  try {
    const signalSource = readFileSync(signalPath, "utf-8");
    const signalEntries = extractStrudelSignals(signalSource, signalNames);
    // Add manual entries for those without JSDoc
    for (const name of signalNames) {
      if (!signalEntries.find((e) => e.name === name)) {
        // mouseX/mouseY have JSDoc under mousex/mousey
        if (name === "mouseX" || name === "mouseY") {
          const altName = name.toLowerCase();
          const alt = signalEntries.find((e) => e.name === altName);
          if (alt) {
            signalEntries.push({ ...alt, name });
            continue;
          }
        }
      }
    }
    if (signalEntries.length > 0) {
      categories.push({ name: "Signals (Strudel)", sourceFile: "signal.mjs", entries: signalEntries });
    }
  } catch {}

  // --- Strudel combinators ---
  const combNames = new Set(["stack", "cat", "slowcat", "fastcat", "silence", "gap", "nothing", "pure", "reify"]);
  const patternPath = resolve(root, "node_modules/@strudel/core/pattern.mjs");
  try {
    const patternSource = readFileSync(patternPath, "utf-8");
    const combEntries = extractStrudelSignals(patternSource, combNames);
    if (combEntries.length > 0) {
      categories.push({ name: "Combinators (Strudel)", sourceFile: "pattern.mjs", entries: combEntries });
    }
  } catch {}

  return categories;
}

const VIRTUAL_ID = "virtual:reference-data";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export default function referencePlugin() {
  let root = "";
  return {
    name: "uzuvid-reference",
    configResolved(config: any) {
      root = config.root;
    },
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id: string) {
      if (id === RESOLVED_ID) {
        const data = buildReferenceData(root);
        return `export default ${JSON.stringify(data, null, 2)};`;
      }
    },
    handleHotUpdate({ file }: { file: string }) {
      // Invalidate when source files change
      if (file.includes("/src/") && file.endsWith(".ts")) {
        return [];
      }
    },
  };
}
