import { describe, it, expect } from "vitest";
import { eventBeginFromHap } from "./event-begin";

describe("eventBeginFromHap", () => {
  it("returns hap.whole.begin when present", () => {
    const ev = { _onset: 0 };
    const hap = { whole: { begin: 2 } };
    expect(eventBeginFromHap(ev, hap, 99)).toBe(2);
  });

  it("prefers hap.whole.begin over _onset", () => {
    // This is the Bug 3 scenario: _onset=0 (pre-slow inner time),
    // hap.whole.begin=2 (correct post-slow time)
    const ev = { _onset: 0 };
    const hap = { whole: { begin: 2 } };
    expect(eventBeginFromHap(ev, hap, 99)).toBe(2);
  });

  it("sync overrides everything, returns 0", () => {
    const ev = { sync: 5, _onset: 3 };
    const hap = { whole: { begin: 7 } };
    expect(eventBeginFromHap(ev, hap, 99)).toBe(0);
  });

  it("sync=0 still returns 0", () => {
    const ev = { sync: 0 };
    const hap = { whole: { begin: 5 } };
    expect(eventBeginFromHap(ev, hap, 99)).toBe(0);
  });

  it("falls back to t when hap is undefined", () => {
    const ev = { _onset: 3 };
    expect(eventBeginFromHap(ev, undefined, 5.5)).toBe(5.5);
  });

  it("falls back to t when hap.whole is undefined", () => {
    const ev = { _onset: 3 };
    const hap = { whole: undefined };
    expect(eventBeginFromHap(ev, hap, 5.5)).toBe(5.5);
  });

  it("falls back to t when hap.whole.begin is undefined", () => {
    const ev = {};
    const hap = { whole: { begin: undefined } };
    expect(eventBeginFromHap(ev, hap, 7)).toBe(7);
  });

  it("converts Fraction-like whole.begin to number", () => {
    // Strudel uses Fraction objects that have toString() returning repeating decimals
    const ev = {};
    const frac = { valueOf: () => 3 };
    const hap = { whole: { begin: frac } };
    expect(eventBeginFromHap(ev, hap, 99)).toBe(3);
  });
});
