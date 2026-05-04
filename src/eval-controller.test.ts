import { describe, it, expect, beforeEach } from "vitest";
import { EvalController, type EvalDeps } from "./eval-controller";
import { initRegistry as initPatternRegistry } from "./pattern-registry";
import type { Screen } from "./renderer-interface";

// Install .p() on Pattern.prototype before any tests run
initPatternRegistry();

type CpsSnap = { value: number };

function makeDeps() {
  let storedSnap: CpsSnap = { value: 0.5 };
  const calls = {
    clearActiveVideos: 0,
    prewarmScreens: [] as Screen[],
    restoreCpsCalls: [] as CpsSnap[],
  };
  const deps: EvalDeps<CpsSnap> = {
    clearActiveVideos: () => { calls.clearActiveVideos++; },
    prewarmScreen: (s) => { calls.prewarmScreens.push(s); },
    snapshotCps: () => ({ ...storedSnap }),
    restoreCps: (snap) => { calls.restoreCpsCalls.push(snap); storedSnap = snap; },
    globals: {},
  };
  return { deps, calls, setSnap: (v: CpsSnap) => { storedSnap = v; } };
}

describe("EvalController", () => {
  let ctrl: EvalController<CpsSnap>;
  let calls: ReturnType<typeof makeDeps>["calls"];

  beforeEach(() => {
    const m = makeDeps();
    ctrl = new EvalController(m.deps);
    calls = m.calls;
  });

  describe("transpile error", () => {
    it("returns error without touching screens", () => {
      const result = ctrl.eval("function({{{{");
      expect(result.error).toBeTruthy();
      expect(result.widgets).toEqual([]);
      expect(ctrl.screens).toHaveLength(0);
    });

    it("does not call clearActiveVideos on transpile failure", () => {
      ctrl.eval("function({{{{");
      expect(calls.clearActiveVideos).toBe(0);
    });
  });

  describe("eval error (runtime throw)", () => {
    it("returns the thrown error message", () => {
      const result = ctrl.eval("throw new Error('boom')");
      expect(result.error).toBe("boom");
    });

    it("restores previous screens on runtime error", () => {
      // populate screens
      ctrl.eval('$: color("red")');
      expect(ctrl.screens).toHaveLength(1);

      // now eval code that throws at runtime
      const result = ctrl.eval("throw new Error('oops')");
      expect(result.error).toBe("oops");
      expect(ctrl.screens).toHaveLength(1); // restored
    });

    it("calls restoreCps on runtime error", () => {
      ctrl.eval("throw new Error('oops')");
      expect(calls.restoreCpsCalls).toHaveLength(1);
    });

    it("does not call restoreCps on success", () => {
      ctrl.eval('$: color("red")');
      expect(calls.restoreCpsCalls).toHaveLength(0);
    });
  });

  describe("successful eval", () => {
    it("returns null error and populates screens", () => {
      const result = ctrl.eval('$: color("red")');
      expect(result.error).toBeNull();
      expect(ctrl.screens).toHaveLength(1);
    });

    it("accumulates multiple anonymous patterns", () => {
      ctrl.eval('$: color("red"); $: color("blue")');
      expect(ctrl.screens).toHaveLength(2);
    });

    it("calls clearActiveVideos on each eval", () => {
      ctrl.eval('$: color("red")');
      ctrl.eval('$: color("blue")');
      expect(calls.clearActiveVideos).toBe(2);
    });

    it("calls prewarmScreen for each screen", () => {
      ctrl.eval('$: color("red"); $: color("blue")');
      expect(calls.prewarmScreens).toHaveLength(2);
    });

    it("clears screens from previous eval on new eval", () => {
      ctrl.eval('$: color("red"); $: color("blue")');
      ctrl.eval('$: color("green")');
      expect(ctrl.screens).toHaveLength(1);
    });

    it("transpiler $: syntax works (registers a screen)", () => {
      const result = ctrl.eval('$: color("red")');
      expect(result.error).toBeNull();
      expect(ctrl.screens).toHaveLength(1);
    });
  });

  describe("hush()", () => {
    it("clears screens and namedScreens", () => {
      ctrl.eval('$: color("red")');
      expect(ctrl.screens).toHaveLength(1);
      ctrl.hush();
      expect(ctrl.screens).toHaveLength(0);
      expect(ctrl.namedScreens).toHaveLength(0);
    });

    it("hush available as sandbox global inside eval", () => {
      ctrl.eval('$: color("red")');
      expect(ctrl.screens).toHaveLength(1);
      ctrl.eval("hush()");
      expect(ctrl.screens).toHaveLength(0);
    });
  });

  describe("namedScreens", () => {
    it("populates namedScreens for non-anonymous patterns", () => {
      ctrl.eval('myscreen: color("red")');
      expect(ctrl.namedScreens.some(n => n.name === "myscreen")).toBe(true);
    });
  });
});
