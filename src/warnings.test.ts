import { describe, it, expect, beforeEach } from "vitest";
import { warn, flushWarnings, clearWarnings, warningCount, onWarnings } from "./warnings";

describe("warnings", () => {
  beforeEach(() => {
    clearWarnings();
  });

  it("collects warnings", () => {
    warn("test warning");
    expect(warningCount()).toBe(1);
  });

  it("deduplicates identical warnings", () => {
    warn("same");
    warn("same");
    warn("same");
    expect(warningCount()).toBe(1);
  });

  it("keeps distinct warnings", () => {
    warn("a");
    warn("b");
    expect(warningCount()).toBe(2);
  });

  it("flushWarnings returns and clears", () => {
    warn("x");
    warn("y");
    const flushed = flushWarnings();
    expect(flushed).toEqual(["x", "y"]);
    expect(warningCount()).toBe(0);
  });

  it("flushWarnings returns empty when no warnings", () => {
    expect(flushWarnings()).toEqual([]);
  });

  it("clearWarnings resets without notifying", () => {
    let called = false;
    onWarnings(() => { called = true; });
    warn("test");
    clearWarnings();
    expect(warningCount()).toBe(0);
    expect(called).toBe(false);
  });

  it("notifies listeners on flush", () => {
    const received: string[][] = [];
    const unsub = onWarnings((msgs) => received.push(msgs));
    warn("hello");
    flushWarnings();
    expect(received).toEqual([["hello"]]);
    unsub();
    warn("after unsub");
    flushWarnings();
    expect(received.length).toBe(1); // no second notification
  });
});
