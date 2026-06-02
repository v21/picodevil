import { silence } from "@strudel/core";
import { transpile, type WidgetCallInfo } from "./transpiler";
import { runTranspiled, buildNormMap } from "./eval-sandbox";
import { resetWidgetCounter } from "./widgets";
import { clearWarnings } from "./warnings";
import {
  snapshotRegistry, restoreRegistry, resetRegistry,
  collectScreens, getNamedScreenIndices,
} from "./pattern-registry";
import type { Screen } from "./renderer-interface";

export interface EvalDeps<CpsSnap> {
  clearActiveVideos(): void;
  prewarmScreen(s: Screen): void;
  snapshotCps(): CpsSnap;
  restoreCps(snap: CpsSnap): void;
  globals: Record<string, unknown>;
}

export class EvalController<CpsSnap> {
  screens: Screen[] = [];
  namedScreens: { name: string; screenIndex: number }[] = [];
  private normMap?: Map<string, string>;

  constructor(private deps: EvalDeps<CpsSnap>) {}

  hush() {
    this.screens = [];
    this.namedScreens = [];
    resetRegistry();
    return silence;
  }

  eval(code: string): { error: string | null; widgets: WidgetCallInfo[] } {
    // Build the norm map on first eval (Pattern.prototype is fully populated by then)
    if (!this.normMap) {
      this.normMap = new Map(buildNormMap());
      const add = (name: string) => {
        const lower = name.toLowerCase();
        if (!this.normMap!.has(lower)) this.normMap!.set(lower, name);
      };
      for (const key of Object.keys(this.deps.globals)) add(key);
      add("hush");
    }

    // Phase 1: Transpile — if this fails, don't touch running state at all
    let transpiled: string;
    let widgets: WidgetCallInfo[] = [];
    try {
      const result = transpile(code, this.normMap);
      transpiled = result.code;
      widgets = result.widgets;
    } catch (e) {
      console.error("transpile error:", e);
      return { error: e instanceof Error ? e.message : String(e), widgets: [] };
    }

    // Phase 2: Snapshot current state so we can restore on execution failure
    const prevScreens = [...this.screens];
    const prevNamedScreens = [...this.namedScreens];
    const prevRegistry = snapshotRegistry();
    const prevCps = this.deps.snapshotCps();

    // Phase 3: Clear state and execute
    this.deps.clearActiveVideos();
    clearWarnings();
    if (typeof window !== "undefined") (window as any).pdWarnings = [];
    this.screens = [];
    this.namedScreens = [];
    resetRegistry();
    resetWidgetCounter();
    try {
      runTranspiled(transpiled, {
        ...this.deps.globals,
        hush: () => this.hush(),
      });
      const pScreens = collectScreens();
      this.namedScreens = getNamedScreenIndices();
      if (pScreens.length > 0) {
        this.screens = [...this.screens, ...pScreens];
      }
      for (const s of this.screens) this.deps.prewarmScreen(s);
      console.log("evaluated:", code, "screens:", this.screens.length);
      return { error: null, widgets };
    } catch (e) {
      console.error("eval error:", e);
      this.screens = prevScreens;
      this.namedScreens = prevNamedScreens;
      restoreRegistry(prevRegistry);
      this.deps.restoreCps(prevCps);
      return { error: e instanceof Error ? e.message : String(e), widgets };
    }
  }
}
