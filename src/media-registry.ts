const STORAGE_KEY = "uzuvid-media-registry";

export type MediaEntry = {
  /** Stable identity — survives renames, persisted to localStorage */
  id: string;
  name: string;
  url: string;
  type: "video" | "image";
  thumbnail?: string;
  /** Set while a YouTube download is in progress */
  downloading?: boolean;
  /** Error message from last download attempt */
  error?: string;
};

const registry = new Map<string, MediaEntry>();
let onChange: (() => void) | null = null;

function save() {
  const arr = Array.from(registry.values());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  onChange?.();
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr: MediaEntry[] = JSON.parse(raw);
    registry.clear();
    for (const entry of arr) {
      if (!entry.id) entry.id = crypto.randomUUID(); // backfill old entries
      registry.set(entry.name, entry);
    }
  } catch { /* ignore corrupt data */ }
}

load();

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi", "ogv"]);

function guessType(url: string): "video" | "image" {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.has(ext) ? "video" : "image";
}

const YT_RE = /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;

function deriveNameFromUrl(url: string): string {
  const ytMatch = YT_RE.exec(url);
  if (ytMatch) return ytMatch[1];
  const path = url.split(/[?#]/)[0];
  const filename = path.split("/").pop() ?? "media";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

function uniqueName(base: string): string {
  if (!registry.has(base)) return base;
  let i = 2;
  while (registry.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function isYouTubeUrl(url: string): boolean {
  return YT_RE.test(url);
}

function getEntryById(id: string): MediaEntry | undefined {
  for (const e of registry.values()) if (e.id === id) return e;
  return undefined;
}

export function addMedia(url: string, name?: string): MediaEntry {
  const baseName = name ?? deriveNameFromUrl(url);
  const finalName = uniqueName(baseName);
  const entry: MediaEntry = { id: crypto.randomUUID(), name: finalName, url, type: guessType(url) };
  registry.set(finalName, entry);
  save();
  if (!isYouTubeUrl(url)) generateThumbnail(entry);
  return entry;
}

export function removeMedia(name: string) {
  registry.delete(name);
  save();
}

export function renameMedia(oldName: string, newName: string): string | null {
  const entry = registry.get(oldName);
  if (!entry) return null;
  if (oldName === newName) return newName;
  const finalName = uniqueName(newName);
  registry.delete(oldName);
  entry.name = finalName;
  registry.set(finalName, entry);
  save();
  return finalName;
}

export function updateUrl(name: string, url: string) {
  const entry = registry.get(name);
  if (!entry) return;
  entry.url = url;
  entry.type = guessType(url);
  entry.thumbnail = undefined;
  save();
  if (!isYouTubeUrl(url)) generateThumbnail(entry);
}

export function updateEntry(name: string, updates: Partial<MediaEntry>) {
  const entry = registry.get(name);
  if (!entry) return;
  Object.assign(entry, updates);
  save();
}

export function resolveMedia(name: string): MediaEntry | undefined {
  let entry = registry.get(name);
  if (!entry && registry.size === 0) {
    // Re-load from localStorage in case another module instance wrote to it (HMR)
    load();
    entry = registry.get(name);
  }
  return entry;
}

export function getAllEntries(): MediaEntry[] {
  return Array.from(registry.values());
}

export function exportAll(): string {
  return JSON.stringify(
    Array.from(registry.values()).map(({ name, url, type }) => ({ name, url, type })),
    null,
    2
  );
}

export function importAll(json: string) {
  const arr: MediaEntry[] = JSON.parse(json);
  for (const entry of arr) {
    if (entry.name && entry.url) {
      const name = uniqueName(entry.name);
      registry.set(name, { id: entry.id ?? crypto.randomUUID(), ...entry, name });
    }
  }
  save();
}

export function clearAll() {
  registry.clear();
  save();
}

export function setOnChange(cb: (() => void) | null) {
  onChange = cb;
}

/** Try downloading a YouTube URL via the server. Updates entry in place. */
export async function downloadYouTube(name: string, serverBase = "http://localhost:3456") {
  const entry = registry.get(name);
  if (!entry) {
    console.warn(`[downloadYouTube] entry not found for name="${name}"`);
    return;
  }
  const { id, url: ytUrl } = entry;
  console.log(`[downloadYouTube] starting: name="${name}", id=${id}`);
  entry.downloading = true;
  entry.error = undefined;
  save();
  try {
    const res = await fetch(`${serverBase}/download?v=${encodeURIComponent(ytUrl)}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    // Re-lookup by stable ID — entry may have been renamed or registry reloaded since the await
    const current = getEntryById(id);
    console.log(`[downloadYouTube] fetch complete: current entry name="${current?.name ?? "NOT FOUND"}"`);
    if (!current) return; // entry was deleted while downloading
    current.url = data.url;
    current.type = "video";
    current.downloading = false;
    save();
    generateThumbnail(current);
  } catch (e: any) {
    const current = getEntryById(id);
    console.error(`[downloadYouTube] error for id=${id}:`, e);
    if (!current) return;
    current.downloading = false;
    current.error = e.message ?? "Download failed";
    save();
  }
}

const THUMB_W = 64;
const THUMB_H = 48;

function captureThumbnail(source: HTMLVideoElement | HTMLImageElement, entry: MediaEntry) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
    entry.thumbnail = canvas.toDataURL("image/jpeg", 0.6);
    save();
  } catch { /* tainted canvas or other failure, skip */ }
}

// Queue to avoid creating too many video elements at once
let thumbQueue: MediaEntry[] = [];
let thumbActive = false;

function generateThumbnail(entry: MediaEntry) {
  thumbQueue.push(entry);
  processThumbQueue();
}

function processThumbQueue() {
  if (thumbActive || thumbQueue.length === 0) return;
  thumbActive = true;
  const entry = thumbQueue.shift()!;
  const isCrossOrigin = entry.url.startsWith("http");

  function done() { thumbActive = false; processThumbQueue(); }

  if (entry.type === "video") {
    const vid = document.createElement("video");
    if (isCrossOrigin) vid.crossOrigin = "anonymous";
    vid.muted = true;
    vid.preload = "auto";

    const cleanup = () => {
      vid.removeAttribute("src");
      vid.load();
      done();
    };
    const timeout = setTimeout(cleanup, 5000);

    vid.addEventListener("loadeddata", () => {
      vid.currentTime = Math.min(1, vid.duration * 0.1);
    });
    vid.addEventListener("seeked", () => {
      clearTimeout(timeout);
      captureThumbnail(vid, entry);
      cleanup();
    });
    vid.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanup();
    });
    vid.src = entry.url;
  } else {
    const img = new Image();
    if (isCrossOrigin) img.crossOrigin = "anonymous";
    const timeout = setTimeout(done, 5000);
    img.addEventListener("load", () => {
      clearTimeout(timeout);
      captureThumbnail(img, entry);
      done();
    });
    img.addEventListener("error", () => {
      clearTimeout(timeout);
      done();
    });
    img.src = entry.url;
  }
}
