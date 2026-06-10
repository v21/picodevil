import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeUrlState, decodeUrlState, loadFromUrl, saveToUrl, setUrlWarnCallback, hashLooksCorrupt } from "./url-state";
import type { MediaEntry } from "./media-registry";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_CODE = `$: video("clip.mp4").speed("0.5 1 -1")`;

const SAMPLE_MEDIA: MediaEntry[] = [
  { id: "id-1", name: "clip", url: "http://localhost:3456/videos/clip.mp4", type: "video", duration: 30 },
  { id: "id-2", name: "photo", url: "http://localhost:3456/images/photo.jpg", type: "image" },
  { id: "id-3", name: "cam", url: "", type: "stream", streamKind: "webcam", deviceId: "abc123" },
];

const BLOB_ENTRY: MediaEntry = {
  id: "id-4", name: "local", url: "blob:http://localhost/some-uuid", type: "video",
};

const ENTRY_WITH_THUMB: MediaEntry = {
  id: "id-5", name: "thumb-vid", url: "http://localhost:3456/videos/t.mp4", type: "video",
  thumbnail: "data:image/jpeg;base64,/9j/verylongthumbnaildata...",
  uploading: true, uploadProgress: 0.5, error: "some error",
  downloading: true,
};

// A default/CDN entry whose thumbnail is a short remote URL (not a data: blob).
const ENTRY_WITH_REMOTE_THUMB: MediaEntry = {
  id: "id-6", name: "cdn-vid", url: "https://videoclip.picodevil.com/carpetshop.mp4", type: "video",
  thumbnail: "https://videoclip.picodevil.com/thumbs/carpetshop.jpg",
};

// ---------------------------------------------------------------------------
// encodeUrlState / decodeUrlState round-trip
// ---------------------------------------------------------------------------

describe("hashLooksCorrupt", () => {
  it("is false for an absent hash (a plain fresh visit)", () => {
    expect(hashLooksCorrupt("")).toBe(false);
    expect(hashLooksCorrupt("#")).toBe(false);
    expect(hashLooksCorrupt("#some-other-anchor")).toBe(false);
  });

  it("is false for a valid v1 link", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, SAMPLE_MEDIA);
    expect(hashLooksCorrupt("#" + encoded)).toBe(false);
  });

  it("is true for a v1 envelope that fails to decode (truncated / garbled)", () => {
    expect(hashLooksCorrupt("#v1,not-valid-base64-$$$")).toBe(true);
    const encoded = encodeUrlState(SAMPLE_CODE, SAMPLE_MEDIA);
    expect(hashLooksCorrupt("#" + encoded.slice(0, encoded.length - 8))).toBe(true); // truncated
  });
});

describe("encodeUrlState / decodeUrlState", () => {
  it("round-trips code and media", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, SAMPLE_MEDIA);
    const decoded = decodeUrlState(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.code).toBe(SAMPLE_CODE);
    expect(decoded!.media).toHaveLength(SAMPLE_MEDIA.length);
  });

  it("preserves entry fields: id, name, url, type, duration, streamKind, deviceId", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, SAMPLE_MEDIA);
    const decoded = decodeUrlState(encoded)!;
    const cam = decoded.media.find(e => e.id === "id-3")!;
    expect(cam.streamKind).toBe("webcam");
    expect(cam.deviceId).toBe("abc123");
    const vid = decoded.media.find(e => e.id === "id-1")!;
    expect(vid.duration).toBe(30);
  });

  it("strips a client-generated data: thumbnail from encoded state (large, device-specific)", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, [ENTRY_WITH_THUMB]);
    const decoded = decodeUrlState(encoded)!;
    expect((decoded.media[0] as any).thumbnail).toBeUndefined();
  });

  it("persists a remote (http/https) thumbnail URL so it travels with the share link", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, [ENTRY_WITH_REMOTE_THUMB]);
    const decoded = decodeUrlState(encoded)!;
    expect((decoded.media[0] as any).thumbnail).toBe(ENTRY_WITH_REMOTE_THUMB.thumbnail);
  });

  it("strips transient fields: uploading, uploadProgress, error, downloading", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, [ENTRY_WITH_THUMB]);
    const decoded = decodeUrlState(encoded)!;
    const e = decoded.media[0] as any;
    expect(e.uploading).toBeUndefined();
    expect(e.uploadProgress).toBeUndefined();
    expect(e.error).toBeUndefined();
    expect(e.downloading).toBeUndefined();
  });

  it("strips blob: URL entries from encoded state (session-scoped, dead after reload)", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, [BLOB_ENTRY]);
    const decoded = decodeUrlState(encoded)!;
    expect(decoded.media).toHaveLength(0);
  });

  it("keeps non-blob entries when a blob entry is interleaved", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, [SAMPLE_MEDIA[0], BLOB_ENTRY, SAMPLE_MEDIA[1]]);
    const decoded = decodeUrlState(encoded)!;
    expect(decoded.media.map(e => e.id)).toEqual(["id-1", "id-2"]);
  });

  it("handles empty code and empty media", () => {
    const encoded = encodeUrlState("", []);
    const decoded = decodeUrlState(encoded)!;
    expect(decoded.code).toBe("");
    expect(decoded.media).toHaveLength(0);
  });

  it("handles unicode in code", () => {
    const code = `// 日本語 emoji 🎉\n$: color("red")`;
    const encoded = encodeUrlState(code, []);
    const decoded = decodeUrlState(encoded)!;
    expect(decoded.code).toBe(code);
  });

  it("handles hash with leading # prefix", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, SAMPLE_MEDIA);
    const decoded = decodeUrlState("#" + encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.code).toBe(SAMPLE_CODE);
  });

  it("returns null for empty string", () => {
    expect(decodeUrlState("")).toBeNull();
  });

  it("returns null for random junk", () => {
    expect(decodeUrlState("#notvalidatall")).toBeNull();
    expect(decodeUrlState("v1,!@#$%")).toBeNull();
  });

  it("returns null for wrong version prefix", () => {
    // Fake a v2 prefix
    const encoded = encodeUrlState(SAMPLE_CODE, []);
    const v2 = encoded.replace(/^v1,/, "v2,");
    expect(decodeUrlState(v2)).toBeNull();
  });

  it("encoded string starts with v1, prefix (no leading #)", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, []);
    expect(encoded.startsWith("v1,")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadFromUrl
// ---------------------------------------------------------------------------

describe("loadFromUrl", () => {
  const origLocation = window.location;

  afterEach(() => {
    // Restore hash
    history.replaceState(null, "", "#");
  });

  it("returns null when hash is empty", () => {
    history.replaceState(null, "", "#");
    expect(loadFromUrl()).toBeNull();
  });

  it("returns null when hash is malformed", () => {
    history.replaceState(null, "", "#garbage");
    expect(loadFromUrl()).toBeNull();
  });

  it("returns decoded state when hash is valid", () => {
    const encoded = encodeUrlState(SAMPLE_CODE, SAMPLE_MEDIA);
    history.replaceState(null, "", "#" + encoded);
    const result = loadFromUrl();
    expect(result).not.toBeNull();
    expect(result!.code).toBe(SAMPLE_CODE);
    expect(result!.media).toHaveLength(SAMPLE_MEDIA.length);
  });
});

// ---------------------------------------------------------------------------
// saveToUrl + URL length warning
// ---------------------------------------------------------------------------

describe("saveToUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setUrlWarnCallback(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    setUrlWarnCallback(null);
    history.replaceState(null, "", "#");
  });

  it("updates location.hash after debounce", () => {
    saveToUrl(SAMPLE_CODE, SAMPLE_MEDIA);
    expect(window.location.hash).toBe(""); // not yet
    vi.runAllTimers();
    expect(window.location.hash).not.toBe("");
    expect(window.location.hash.startsWith("#v1,")).toBe(true);
  });

  it("coalesces rapid calls (debounce)", () => {
    const spy = vi.spyOn(history, "replaceState");
    saveToUrl("a", []);
    saveToUrl("b", []);
    saveToUrl("c", []);
    vi.runAllTimers();
    // Only one replaceState call after all three
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("calls warn callback with null when state is small", () => {
    const warnCb = vi.fn();
    setUrlWarnCallback(warnCb);
    saveToUrl(SAMPLE_CODE, SAMPLE_MEDIA);
    vi.runAllTimers();
    expect(warnCb).toHaveBeenCalledWith(null);
  });

  it("calls warn callback with message when state exceeds limit", () => {
    const warnCb = vi.fn();
    setUrlWarnCallback(warnCb);
    // Generate a large code string
    const bigCode = "x".repeat(25000);
    saveToUrl(bigCode, []);
    vi.runAllTimers();
    const [msg] = warnCb.mock.calls[0];
    expect(typeof msg).toBe("string");
    expect(msg).toMatch(/large|long/i);
  });

  it("state written to hash is decodable", () => {
    saveToUrl(SAMPLE_CODE, SAMPLE_MEDIA);
    vi.runAllTimers();
    const result = loadFromUrl();
    expect(result).not.toBeNull();
    expect(result!.code).toBe(SAMPLE_CODE);
  });
});
