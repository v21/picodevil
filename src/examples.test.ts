import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupExamples, autostartExamples, pickAutostartCode } from "./examples";

describe("autostart example selection", () => {
  it("includes only examples opted in with autostart:true, never the flashing colour grids", () => {
    const eligible = autostartExamples();
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every(e => e.autostart === true)).toBe(true);
    expect(eligible.some(e => e.name === "colour grids (flashing)")).toBe(false);
  });

  it("picks code only from the eligible subset", () => {
    const eligible = autostartExamples();
    // Deterministic selector → last eligible example's code.
    const code = pickAutostartCode(() => eligible.length - 1);
    expect(code).toBe(eligible[eligible.length - 1].code);
    expect(eligible.some(e => e.code === code)).toBe(true);
  });
});

describe("examples list", () => {
  let container: HTMLElement;
  let calls: Array<[string, boolean | undefined]>;
  let events: string[];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    calls = [];
    events = [];
    (window as any).pdSetCode = (code: string, evaluate?: boolean) => {
      calls.push([code, evaluate]);
      events.push("setCode");
    };
    (window as any).pdResetCps = () => { events.push("resetCps"); };
  });

  afterEach(() => {
    container.remove();
    delete (window as any).pdSetCode;
    delete (window as any).pdResetCps;
  });

  it("clicking an example loads AND evaluates it", () => {
    setupExamples(container);
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    btn!.click();
    expect(calls.length).toBe(1);
    const [code, evaluate] = calls[0];
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
    expect(evaluate).toBe(true); // load should also trigger evaluation
  });

  it("resets cps before loading the example", () => {
    setupExamples(container);
    container.querySelector("button")!.click();
    expect(events).toEqual(["resetCps", "setCode"]);
  });
});
