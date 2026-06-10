/**
 * Eval timeout / infinite-loop guard.
 *
 * User code runs synchronously via `new Function`, so a `while(true){}` would
 * freeze the tab. The transpiler injects `__pdGuard()` at the top of every loop
 * body; runTranspiled supplies a time-budget guard that throws once exceeded, so
 * the eval aborts (and EvalController restores the prior pattern).
 */
import { describe, it, expect } from "vitest";
import { transpile } from "./transpiler";
import { makeEvalGuard } from "./eval-sandbox";

describe("transpiler loop-guard injection", () => {
  it("injects __pdGuard() into while / for / do-while / for-of bodies", () => {
    expect(transpile("while (true) { x(); }").code).toContain("__pdGuard()");
    expect(transpile("for (let i = 0; i < 10; i++) { y(); }").code).toContain("__pdGuard()");
    expect(transpile("do { z(); } while (cond);").code).toContain("__pdGuard()");
    expect(transpile("for (const a of list) { w(a); }").code).toContain("__pdGuard()");
  });

  it("normalises a non-block loop body and still guards it", () => {
    const out = transpile("while (cond) doThing();").code;
    expect(out).toContain("__pdGuard()");
    expect(out).toContain("doThing()");
  });

  it("does not inject a guard into loop-free code", () => {
    expect(transpile('s("a b c").fast(2)').code).not.toContain("__pdGuard");
  });
});

describe("makeEvalGuard", () => {
  it("throws once the time budget is exceeded", () => {
    const guard = makeEvalGuard(0); // any elapsed time exceeds a 0ms budget
    expect(() => { for (let i = 0; i < 20000; i++) guard(); }).toThrow(/infinite loop|aborted/i);
  });

  it("does not throw within the budget", () => {
    const guard = makeEvalGuard(10_000);
    expect(() => { for (let i = 0; i < 50000; i++) guard(); }).not.toThrow();
  });

  it("aborts a real transpiled infinite loop under a tiny budget", () => {
    const { code } = transpile("let i = 0; while (true) { i = i + 1; }");
    const fn = new Function("__pdGuard", code);
    expect(() => fn(makeEvalGuard(5))).toThrow(/infinite loop|aborted/i);
  });
});
