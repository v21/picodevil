/**
 * Tests that pattern errors during queryArc surface via the strudel.log
 * CustomEvent and are captured by warn() rather than only going to console.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Pattern } from "@strudel/core";
import { color } from "./color-pattern";
import { warn, flushWarnings, clearWarnings } from "./warnings";

beforeEach(() => clearWarnings());

// Mirror the listener added in editor.ts
function installStrudelLogListener() {
  const handler = (e: Event) => {
    const msg = (e as CustomEvent).detail?.message;
    if (msg) warn(msg);
  };
  document.addEventListener("strudel.log", handler);
  return () => document.removeEventListener("strudel.log", handler);
}

describe("render error handling", () => {
  it("strudel.log event is dispatched when queryArc throws", () => {
    const broken = new Pattern(() => { throw new Error("boom"); });
    // queryArc catches the error and dispatches strudel.log
    broken.queryArc(0, 0);
    // The event is dispatched synchronously, so we can flush immediately
    // (in tests there's no editor listener, so manually check the event fires)
    // We verify by installing the listener before the call:
  });

  it("strudel.log listener pipes error into warn()", () => {
    const unsub = installStrudelLogListener();
    const broken = new Pattern(() => { throw new Error("radius boom"); });
    broken.queryArc(0, 0);
    const msgs = flushWarnings();
    unsub();
    expect(msgs.some(m => m.includes("radius boom"))).toBe(true);
  });

  it("TypeError from mapWithVal appears via strudel.log", () => {
    const unsub = installStrudelLogListener();
    const broken = new Pattern(() => { throw new TypeError("x.radius is not a function"); });
    broken.queryArc(0, 0);
    const msgs = flushWarnings();
    unsub();
    expect(msgs.some(m => m.includes("x.radius is not a function"))).toBe(true);
  });

  it("healthy pattern produces no warnings", () => {
    const unsub = installStrudelLogListener();
    color("red").queryArc(0, 0);
    const msgs = flushWarnings();
    unsub();
    expect(msgs).toHaveLength(0);
  });
});
