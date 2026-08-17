import { describe, it, expect, vi } from "vitest";
import { makeThumbCell, setupThumbs } from "./thumbs";
import { addMedia, clearAll, type MediaEntry } from "./media-registry";

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
    // name is still shown and the cell is still clickable
    expect(cell.querySelector(".thumb-label")?.textContent).toBe("clip");
  });

  it("calls onPick with the short name when clicked", () => {
    const onPick = vi.fn();
    const cell = makeThumbCell(entry({ name: "washingmachine" }), onPick);
    cell.click();
    expect(onPick).toHaveBeenCalledWith("washingmachine");
  });
});

describe("setupThumbs", () => {
  it("renders a cell per registry entry and clicking one inserts its name at the cursor", () => {
    clearAll();
    const inserted: string[] = [];
    window.pdInsertAtCursor = (t) => inserted.push(t);

    const el = document.createElement("div");
    document.body.appendChild(el);
    setupThumbs(el);
    expect(el.querySelector(".vid-empty")).not.toBeNull(); // empty state before any media

    addMedia("http://x/washingmachine.mp4", "washingmachine"); // fires onChange → re-render
    const cell = el.querySelector<HTMLButtonElement>(".thumb-cell");
    expect(cell).not.toBeNull();
    cell!.click();
    expect(inserted).toEqual(["washingmachine"]);

    el.remove();
    clearAll();
  });
});
