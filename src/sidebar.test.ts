import { describe, it, expect } from "vitest";
import { resolveSidebarOpen } from "./sidebar";

describe("resolveSidebarOpen", () => {
  it("first visit (no stored key) starts open", () => {
    expect(resolveSidebarOpen(null)).toBe(true);
  });

  it("stays closed only when explicitly closed", () => {
    expect(resolveSidebarOpen(JSON.stringify({ open: false }))).toBe(false);
  });

  it("respects a stored open state", () => {
    expect(resolveSidebarOpen(JSON.stringify({ open: true }))).toBe(true);
  });

  it("switching a tab (stores tab, not open) keeps it open", () => {
    // Regression: writing {tab} must not demote a never-closed sidebar to closed.
    expect(resolveSidebarOpen(JSON.stringify({ tab: "perf" }))).toBe(true);
  });

  it("resizing (stores width, not open) keeps it open", () => {
    expect(resolveSidebarOpen(JSON.stringify({ width: 300 }))).toBe(true);
  });

  it("an empty stored object stays open (nothing was explicitly closed)", () => {
    expect(resolveSidebarOpen("{}")).toBe(true);
  });

  it("malformed JSON falls back to open", () => {
    expect(resolveSidebarOpen("not json")).toBe(true);
  });
});
