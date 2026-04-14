const STORAGE_KEY = "uzuvid-media-registry";

export type MediaEntry = {
  /** Stable identity — survives renames, persisted to localStorage */
  id: string;
  name: string;
  url: string;
  type: "video" | "image" | "stream";
  thumbnail?: string;
  /** Video duration in seconds, populated when metadata loads */
  duration?: number;
  /** Set while a YouTube download is in progress */
  downloading?: boolean;
  /** Set while a local file upload+transcode is in progress */
  uploading?: boolean;
  /** Upload phase progress 0–1 (undefined during transcode phase) */
  uploadProgress?: number;
  /** Error message from last download/upload attempt */
  error?: string;
  /** For stream entries: "webcam" or "screen" */
  streamKind?: "webcam" | "screen";
  /** For webcam streams: saved device ID for re-acquisition */
  deviceId?: string;
};

const registry = new Map<string, MediaEntry>();
let onChange: (() => void) | null = null;

function save() {
  // Don't persist entries with blob URLs — they're session-scoped and dead after reload.
  // Entries mid-upload will have their URL updated to the server URL before the session ends;
  // if the page is reloaded before that happens, they're simply lost.
  const arr = Array.from(registry.values()).filter(e => !e.url.startsWith("blob:"));
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
      if (entry.url?.startsWith("blob:")) continue; // stale from a previous session
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

export function addStream(kind: "webcam" | "screen", name?: string, deviceId?: string): MediaEntry {
  const baseName = name ?? kind;
  const finalName = uniqueName(baseName);
  const entry: MediaEntry = {
    id: crypto.randomUUID(), name: finalName, url: "", type: "stream",
    streamKind: kind, deviceId,
  };
  registry.set(finalName, entry);
  save();
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

/** Look up cached duration by media URL. Returns undefined if not yet known. */
export function getDurationByUrl(url: string): number | undefined {
  for (const e of registry.values()) {
    if (e.url === url && e.duration != null) return e.duration;
  }
  return undefined;
}

/** Update duration for an entry by URL (called when video metadata loads in the pool). */
export function setDurationByUrl(url: string, duration: number) {
  for (const e of registry.values()) {
    if (e.url === url && !e.duration) {
      e.duration = duration;
      save();
      return;
    }
  }
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

/** Idempotent: register a video by name. No-op if name+url already match. */
export function loadVideo(name: string, url: string): void {
  const existing = resolveMedia(name);
  if (existing) {
    if (existing.url === url && existing.type === "video") return;
    updateUrl(name, url);
    updateEntry(name, { type: "video" });
  } else {
    addMedia(url, name);
    updateEntry(name, { type: "video" });
  }
  if (isYouTubeUrl(url)) {
    downloadYouTube(name);
  }
}

/** Idempotent: register an image by name. No-op if name+url already match. */
export function loadImage(name: string, url: string): void {
  const existing = resolveMedia(name);
  if (existing) {
    if (existing.url === url && existing.type === "image") return;
    updateUrl(name, url);
    updateEntry(name, { type: "image" });
  } else {
    addMedia(url, name);
    updateEntry(name, { type: "image" });
  }
}

export function clearAll() {
  registry.clear();
  save();
}

export function setOnChange(cb: (() => void) | null) {
  onChange = cb;
}

/** Upload a local file to the server, re-encode as I-frame-only MP4, then update the entry URL. */
export function uploadToServer(name: string, file: File, serverBase = "http://localhost:3456"): Promise<void> {
  return new Promise((resolve, reject) => {
    const entry = registry.get(name);
    if (!entry) return reject(new Error(`Entry not found: ${name}`));
    const { id } = entry;

    entry.uploading = true;
    entry.uploadProgress = 0;
    entry.error = undefined;
    save();

    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${serverBase}/upload?name=${encodeURIComponent(safeName)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      const current = getEntryById(id);
      if (!current) return;
      current.uploadProgress = e.lengthComputable ? e.loaded / e.total : undefined;
      save();
    };

    xhr.onload = () => {
      const current = getEntryById(id);
      if (!current) return resolve();
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        current.url = data.url;
        current.type = 'video';
        current.uploading = false;
        current.uploadProgress = undefined;
        save();
        generateThumbnail(current);
        resolve();
      } else {
        current.uploading = false;
        current.uploadProgress = undefined;
        current.error = `Upload failed: ${xhr.status}`;
        save();
        reject(new Error(current.error));
      }
    };

    const fail = () => {
      const current = getEntryById(id);
      if (current) {
        current.uploading = false;
        current.uploadProgress = undefined;
        current.error = 'Upload failed';
        save();
      }
      reject(new Error('Upload failed'));
    };
    xhr.onerror = fail;
    xhr.onabort = fail;

    xhr.send(file);
  });
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
      if (isFinite(vid.duration) && vid.duration > 0 && !entry.duration) {
        entry.duration = vid.duration;
        save();
      }
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
