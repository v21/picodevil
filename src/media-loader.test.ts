import { describe, it, expect } from "vitest";
import { entryRenderKey } from "./media-loader";
import type { MediaEntry } from "./media-registry";

const base = (o: Partial<MediaEntry> = {}): MediaEntry =>
  ({ id: "1", name: "clip", url: "http://x/c.mp4", type: "video", ...o });

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
