import { describe, it, expect } from "vitest";
import { CpsController } from "./cps-controller";
import { pure } from "@strudel/core";

const T0 = 10_000; // arbitrary start time in ms

describe("CpsController", () => {
  describe("tick() — basic cycle calculation", () => {
    it("produces 0.5 cycle after 1000ms at default cps=0.5", () => {
      const ctrl = new CpsController(0.5, T0);
      const { cps, cycle } = ctrl.tick(T0 + 1000);
      expect(cps).toBe(0.5);
      expect(cycle).toBeCloseTo(0.5);
    });

    it("t equals cycle (used as arc query time)", () => {
      const ctrl = new CpsController(1, T0);
      const { cycle, t } = ctrl.tick(T0 + 1500);
      expect(cycle).toBeCloseTo(1.5);
      expect(t).toBeCloseTo(cycle);
    });

    it("cycle advances linearly between ticks", () => {
      const ctrl = new CpsController(1, T0);
      const r1 = ctrl.tick(T0 + 500);
      const r2 = ctrl.tick(T0 + 1000);
      expect(r2.cycle - r1.cycle).toBeCloseTo(0.5);
    });
  });

  describe("setCps() — tempo change continuity", () => {
    it("setCps(1) changes cps and tick reflects new rate", () => {
      const ctrl = new CpsController(0.5, T0);
      ctrl.setCps(1, T0 + 1000); // after 1 cycle at 0.5 cps = 0.5 cycles elapsed
      const { cps, cycle } = ctrl.tick(T0 + 2000); // 1 more second at cps=1
      expect(cps).toBe(1);
      expect(cycle).toBeCloseTo(1.5); // 0.5 before + 1.0 after
    });

    it("cycle is continuous across tempo change — no jump", () => {
      const ctrl = new CpsController(0.5, T0);
      const before = ctrl.tick(T0 + 1000); // cycle = 0.5
      ctrl.setCps(2, T0 + 1000);           // change at same instant
      const after = ctrl.tick(T0 + 1000);  // same instant, second tick
      expect(after.cycle).toBeCloseTo(before.cycle, 5);
    });

    it("setCps(0) freezes cycle accumulation", () => {
      const ctrl = new CpsController(1, T0);
      ctrl.tick(T0 + 500);              // advance to 0.5
      ctrl.setCps(0, T0 + 500);
      const r1 = ctrl.tick(T0 + 1000); // time passes but cycle stays
      const r2 = ctrl.tick(T0 + 2000);
      expect(r1.cycle).toBeCloseTo(0.5);
      expect(r2.cycle).toBeCloseTo(0.5);
    });

    it("resuming from freeze continues from frozen position", () => {
      const ctrl = new CpsController(1, T0);
      ctrl.tick(T0 + 500);         // cycle = 0.5
      ctrl.setCps(0, T0 + 500);    // freeze
      ctrl.setCps(1, T0 + 2000);   // resume 1.5s later
      const r = ctrl.tick(T0 + 2500); // 0.5s at cps=1
      expect(r.cycle).toBeCloseTo(1.0); // 0.5 frozen + 0.5 new
    });
  });

  describe("setCpm()", () => {
    it("setCpm(60) is equivalent to setCps(1)", () => {
      const a = new CpsController(1, T0);
      const b = new CpsController(1, T0);
      a.setCpm(60, T0 + 500);
      b.setCps(1, T0 + 500);
      expect(a.tick(T0 + 1000).cycle).toBeCloseTo(b.tick(T0 + 1000).cycle);
    });

    it("setCpm(120) is equivalent to setCps(2)", () => {
      const ctrl = new CpsController(1, T0);
      ctrl.setCpm(120, T0);
      expect(ctrl.cyclesPerSecond).toBe(2);
    });

    it("setCpm with pattern delegates correctly", () => {
      const ctrl = new CpsController(1, T0);
      const pat = pure(120);
      ctrl.setCpm(pat, T0);
      expect(ctrl.cpsPattern).not.toBeNull();
    });
  });

  describe("dynamic cpsPattern", () => {
    it("pattern value overrides cyclesPerSecond in tick", () => {
      const ctrl = new CpsController(0.5, T0);
      ctrl.setCps(pure(2), T0); // always returns 2
      const { cps } = ctrl.tick(T0 + 1000);
      expect(cps).toBeCloseTo(2);
    });

    it("pattern value clamps to 0 for negative values", () => {
      const ctrl = new CpsController(1, T0);
      ctrl.setCps(pure(-1), T0);
      const { cps } = ctrl.tick(T0 + 100);
      expect(cps).toBe(0);
    });
  });

  describe("snapshot() / restore()", () => {
    it("restores state to the snapshot point", () => {
      const ctrl = new CpsController(1, T0);
      ctrl.tick(T0 + 500);
      const snap = ctrl.snapshot();
      ctrl.setCps(2, T0 + 500);
      ctrl.tick(T0 + 1000);
      ctrl.restore(snap);
      const r = ctrl.tick(T0 + 1000);
      expect(r.cps).toBe(1);
      expect(r.cycle).toBeCloseTo(1.0); // 0.5 accumulated + 0.5 more at cps=1
    });

    it("snapshot round-trips are independent copies", () => {
      const ctrl = new CpsController(1, T0);
      const snap1 = ctrl.snapshot();
      ctrl.setCps(2, T0);
      const snap2 = ctrl.snapshot();
      ctrl.restore(snap1);
      expect(ctrl.cyclesPerSecond).toBe(1);
      ctrl.restore(snap2);
      expect(ctrl.cyclesPerSecond).toBe(2);
    });
  });
});
