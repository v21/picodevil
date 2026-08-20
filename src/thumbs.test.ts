import { describe, it, expect, vi } from "vitest";
import { makeThumbCell, cellKey } from "./thumbs";
import type { MediaEntry } from "./media-registry";

function entry(over: Partial<MediaEntry> = {}): MediaEntry {
  return { id: "id1", name: "clip", url: "http://x/clip.mp4", type: "video", ...over };
}

describe("makeThumbCell", () => {
  it("renders the thumbnail image and short-name label", () => {
    const cell = makeThumbCell(entry({ thumbnail: "data:image/jpeg;base64,AAAA" }), () => {});
    const img = cell.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(cell.querySelector(".thumb-label")?.textContent).toBe("clip");
  });

  it("shows a placeholder (no img) when there's no thumbnail", () => {
    const cell = makeThumbCell(entry({ thumbnail: undefined }), () => {});
    expect(cell.querySelector("img")).toBeNull();
    expect(cell.querySelector(".thumb-placeholder")).not.toBeNull();
    expect(cell.querySelector(".thumb-label")?.textContent).toBe("clip");
  });

  it("tags the cell with a flip key for the view⇄edit transition", () => {
    const cell = makeThumbCell(entry({ name: "washingmachine" }), () => {});
    expect(cell.dataset.flipKey).toBe("washingmachine");
  });

  it("calls onPick with the short name when clicked", () => {
    const onPick = vi.fn();
    const cell = makeThumbCell(entry({ name: "washingmachine" }), onPick);
    cell.click();
    expect(onPick).toHaveBeenCalledWith("washingmachine");
  });
});

describe("cellKey", () => {
  it("changes when a visually-relevant field changes", () => {
    expect(cellKey(entry())).not.toBe(cellKey(entry({ thumbnail: "data:x" })));
    expect(cellKey(entry())).not.toBe(cellKey(entry({ name: "other" })));
  });
  it("is stable when nothing visual changed", () => {
    expect(cellKey(entry())).toBe(cellKey(entry()));
  });
});
