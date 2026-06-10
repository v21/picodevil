import { describe, it, expect, afterEach } from "vitest";
import { showFatalOverlay } from "./fatal-overlay";

afterEach(() => {
  document.getElementById("pd-fatal")?.remove();
});

describe("showFatalOverlay", () => {
  it("inserts a visible overlay carrying the title and message", () => {
    showFatalOverlay("No WebGL2", "Use a recent browser.");
    const el = document.getElementById("pd-fatal")!;
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toContain("No WebGL2");
    expect(el.textContent).toContain("Use a recent browser.");
  });

  it("is idempotent — a second call replaces rather than stacks", () => {
    showFatalOverlay("First", "a");
    showFatalOverlay("Second", "b");
    expect(document.querySelectorAll("#pd-fatal").length).toBe(1);
    expect(document.getElementById("pd-fatal")!.textContent).toContain("Second");
  });
});
