import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupExamples } from "./examples";

describe("examples list", () => {
  let container: HTMLElement;
  let calls: Array<[string, boolean | undefined]>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    calls = [];
    (window as any).pdSetCode = (code: string, evaluate?: boolean) => {
      calls.push([code, evaluate]);
    };
  });

  afterEach(() => {
    container.remove();
    delete (window as any).pdSetCode;
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
});
