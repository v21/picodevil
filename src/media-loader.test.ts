import { describe, it, expect } from "vitest";
import { entryRenderKey, reconcileGrid } from "./media-loader";
import type { MediaEntry } from "./media-registry";

const base = (o: Partial<MediaEntry> = {}): MediaEntry =>
  ({ id: "1", name: "clip", url: "http://x/c.mp4", type: "video", ...o });

const e = (id: string, name: string, o: Partial<MediaEntry> = {}): MediaEntry =>
  ({ id, name, url: `http://x/${name}.mp4`, type: "video", ...o });

describe("reconcileGrid", () => {
  it("creates one cell per entry, tagged for insert + flip", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a"), e("2", "b")]);
    const cells = grid.querySelectorAll<HTMLElement>(".thumb-cell");
    expect(cells.length).toBe(2);
    expect(cells[0].dataset.flipKey).toBe("a");
    expect(cells[0].dataset.entryId).toBe("1");
  });

  it("reuses the same DOM node when nothing visual changed", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a")]);
    const first = grid.querySelector(".thumb-cell");
    reconcileGrid(grid, [e("1", "a")]);
    expect(grid.querySelector(".thumb-cell")).toBe(first);
  });

  it("rebuilds a cell when a visual field changes (thumbnail arrives)", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a")]);
    const first = grid.querySelector(".thumb-cell");
    reconcileGrid(grid, [e("1", "a", { thumbnail: "data:x" })]);
    expect(grid.querySelector(".thumb-cell")).not.toBe(first);
  });

  it("removes cells for gone entries and shows the empty state", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a")]);
    reconcileGrid(grid, []);
    expect(grid.querySelector(".thumb-cell")).toBeNull();
    expect(grid.querySelector("[data-empty]")).not.toBeNull();
  });

  it("preserves order after a reorder", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a"), e("2", "b")]);
    reconcileGrid(grid, [e("2", "b"), e("1", "a")]);
    const order = Array.from(grid.querySelectorAll<HTMLElement>(".thumb-cell")).map(c => c.dataset.flipKey);
    expect(order).toEqual(["b", "a"]);
  });

  it("shows a progress badge while uploading, updated in place, removed when done", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a", { uploading: true, uploadProgress: 0.2 })]);
    const cell = grid.querySelector<HTMLElement>(".thumb-cell")!;
    expect(cell.querySelector(".thumb-progress")?.textContent).toBe("↑20%");

    reconcileGrid(grid, [e("1", "a", { uploading: true, uploadProgress: 0.8 })]);
    expect(grid.querySelector(".thumb-cell")).toBe(cell); // reused, not rebuilt (no img reload)
    expect(cell.querySelector(".thumb-progress")?.textContent).toBe("↑80%");

    reconcileGrid(grid, [e("1", "a")]); // finished
    expect(cell.querySelector(".thumb-progress")).toBeNull();
  });

  it("uses a compact glyph+percent for download/transcode badges", () => {
    const grid = document.createElement("div");
    reconcileGrid(grid, [e("1", "a", { downloading: true, phase: "transcode", phasePercent: 0.5 })]);
    expect(grid.querySelector(".thumb-progress")?.textContent).toBe("⚙50%");
  });
});

describe("entryRenderKey", () => {
  it("is stable across upload-progress ticks (row/input not rebuilt while typing)", () => {
    expect(entryRenderKey(base({ uploading: true, uploadProgress: 0.1 })))
      .toBe(entryRenderKey(base({ uploading: true, uploadProgress: 0.9 })));
  });

  it("is stable across download phase/percent ticks", () => {
    expect(entryRenderKey(base({ downloading: true, phase: "download", phasePercent: 0.2 })))
      .toBe(entryRenderKey(base({ downloading: true, phase: "transcode", phasePercent: 0.8 })));
  });

  it("still changes on a structural field (e.g. thumbnail arriving)", () => {
    expect(entryRenderKey(base())).not.toBe(entryRenderKey(base({ thumbnail: "data:image/jpeg,x" })));
  });

  it("still changes when upload starts/stops (structural)", () => {
    expect(entryRenderKey(base())).not.toBe(entryRenderKey(base({ uploading: true })));
  });
});
