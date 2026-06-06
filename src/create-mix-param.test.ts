import { test, expect, describe } from "vitest";
import { getPatternGlobals } from "./eval-sandbox";
import { late } from "@strudel/core";

const g = getPatternGlobals() as any;
const { s, color, sine, mini } = g;

describe("createMixParam frame-time control sampling", () => {
  // ── THE BUG (currently failing) ───────────────────────────────────────────
  // stackN() round-trips the query span through a JS float (Number()); under
  // late() the source event's instant no longer exactly equals the control's
  // instant, so the zero-width part intersection in createMixParam returns
  // undefined and the alpha is dropped (tile flashes from 20% to 100% opacity).
  // t below is a real frame time captured from the live render loop.
  test("alpha is NOT dropped on a late()-shifted stackN tile (FP instant skew)", () => {
    const t = 0.2753500000238395;
    const haps = (s("red") as any).stackN(4).late(0.1).alpha(0.2).queryArc(t, t);
    expect(haps.length).toBe(4);
    for (const h of haps) {
      expect(h.value.alpha, `tile i=${h.value.i} lost its alpha`).toBe(0.2);
    }
  });

  // Same skew through the full reported pattern shape.
  test("alpha survives stackN + someCycles(late) at a known-bad frame time", () => {
    const t = 0.2753500000238395;
    const haps = (s("<red green blue>") as any)
      .stackN(4).someCycles(late(0.1)).alpha(0.2).queryArc(t, t);
    for (const h of haps) expect(h.value.alpha).toBe(0.2);
  });

  // ── PIN: multiple output haps (must be preserved by the fix) ──────────────
  // A non-zero-width arc query where the control has finer sub-structure than
  // the source must split the source event into one hap per control segment.
  test("non-zero-width arc: finer control splits source into multiple haps", () => {
    const haps = (color("red") as any).alpha(mini("0 1 0 1")).queryArc(0, 1);
    expect(haps.length).toBe(4);
    expect(haps.map((h: any) => h.value.alpha)).toEqual([0, 1, 0, 1]);
    // each output keeps red and carries the right alpha over its quarter
    for (const h of haps) expect(h.value.color).toBe("red");
    expect(haps.map((h: any) => Number(h.part.begin))).toEqual([0, 0.25, 0.5, 0.75]);
  });

  // ── PIN: continuous signals must still animate per frame ──────────────────
  test("continuous signal control varies frame-to-frame (not frozen)", () => {
    const pat = (color("red") as any).alpha(sine);
    const a1 = pat.queryArc(0.10, 0.10)[0].value.alpha;
    const a2 = pat.queryArc(0.30, 0.30)[0].value.alpha;
    const a3 = pat.queryArc(0.55, 0.55)[0].value.alpha;
    expect(a1).not.toBe(a2);
    expect(a2).not.toBe(a3);
  });

  // ── PIN: ordinary (non-shifted) tiles already work ────────────────────────
  test("plain stackN tiles all carry alpha", () => {
    const haps = (s("red") as any).stackN(4).alpha(0.2).queryArc(0.3, 0.3);
    expect(haps.length).toBe(4);
    for (const h of haps) expect(h.value.alpha).toBe(0.2);
  });
});
