const THUMB_STORAGE_PREFIX = "uzuvid:thumb:";

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
  /**
   * The original File object for local uploads. Kept in memory (not persisted)
   * so the retry button can re-upload without calling downloadYouTube.
   */
  pendingFile?: File;
  /** Error message from last download/upload attempt */
  error?: string;
  /** For stream entries: "webcam" or "screen" */
  streamKind?: "webcam" | "screen";
  /** For webcam streams: saved device ID for re-acquisition */
  deviceId?: string;
};

const registry: MediaEntry[] = [];
let onChange: (() => void) | null = null;
const extraListeners: Set<() => void> = new Set();

function save() {
  onChange?.();
  for (const fn of extraListeners) fn();
}

/**
 * Initialise the registry from a decoded URL state (replaces any existing contents).
 * Thumbnails are merged from localStorage by entry ID.
 * Call this once at startup before any other registry operations.
 * @internal
 */
export function initRegistry(entries: { id: string; name: string; url: string; type: MediaEntry["type"]; duration?: number; streamKind?: MediaEntry["streamKind"]; deviceId?: string }[]) {
  registry.length = 0;
  for (const entry of entries) {
    const thumb = localStorage.getItem(THUMB_STORAGE_PREFIX + entry.id) ?? undefined;
    registry.push({ ...entry, ...(thumb ? { thumbnail: thumb } : {}) } as MediaEntry);
  }
  onChange?.();
  // Generate thumbnails for entries that don't have one (e.g. first load on a new device)
  for (const entry of registry) {
    if (!entry.thumbnail && entry.url && !entry.url.startsWith("blob:") && entry.type !== "stream") {
      generateThumbnail(entry);
    }
  }
}

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
  if (!registry.some(e => e.name === base)) return base;
  let i = 2;
  while (registry.some(e => e.name === `${base}${i}`)) i++;
  return `${base}${i}`;
}

export function isYouTubeUrl(url: string): boolean {
  return YT_RE.test(url);
}

function getEntryById(id: string): MediaEntry | undefined {
  return registry.find(e => e.id === id);
}

export function addMedia(url: string, name?: string): MediaEntry {
  const baseName = name ?? deriveNameFromUrl(url);
  const finalName = uniqueName(baseName);
  const entry: MediaEntry = { id: crypto.randomUUID(), name: finalName, url, type: guessType(url) };
  registry.push(entry);
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
  registry.push(entry);
  save();
  return entry;
}

export function removeMedia(name: string) {
  const i = registry.findIndex(e => e.name === name);
  if (i >= 0) registry.splice(i, 1);
  save();
}

export function renameMedia(oldName: string, newName: string): string | null {
  const entry = registry.find(e => e.name === oldName);
  if (!entry) return null;
  if (oldName === newName) return newName;
  const finalName = uniqueName(newName);
  entry.name = finalName;
  save();
  return finalName;
}

export function updateUrl(name: string, url: string) {
  const entry = registry.find(e => e.name === name);
  if (!entry) return;
  entry.url = url;
  entry.type = guessType(url);
  entry.thumbnail = undefined;
  save();
  if (!isYouTubeUrl(url)) generateThumbnail(entry);
}

export function updateEntry(name: string, updates: Partial<MediaEntry>) {
  const entry = registry.find(e => e.name === name);
  if (!entry) return;
  Object.assign(entry, updates);
  save();
}

/** Look up cached duration by media URL. Returns undefined if not yet known. @internal */
export function getDurationByUrl(url: string): number | undefined {
  return registry.find(e => e.url === url && e.duration != null)?.duration;
}

/** Update duration for an entry by URL (called when video metadata loads in the pool). @internal */
export function setDurationByUrl(url: string, duration: number) {
  const e = registry.find(e => e.url === url && !e.duration);
  if (e) { e.duration = duration; save(); }
}

export function resolveMedia(name: string): MediaEntry | undefined {
  return registry.find(e => e.name === name);
}

export function getAllEntries(): MediaEntry[] {
  return registry.slice();
}

export function exportAll(): string {
  return JSON.stringify(
    registry.map(({ name, url, type }) => ({ name, url, type })),
    null,
    2
  );
}

export function importAll(json: string) {
  const arr: MediaEntry[] = JSON.parse(json);
  for (const entry of arr) {
    if (entry.name && entry.url) {
      const name = uniqueName(entry.name);
      registry.push({ id: entry.id ?? crypto.randomUUID(), ...entry, name });
    }
  }
  save();
}

/**
 * Register a video by name. Idempotent — no-op if name+url already match.
 * If the URL is a YouTube link, the server will download it automatically.
 * Use the name with `video()` or `s()` after calling this.
 *
 * @param {string} name short identifier used in patterns
 * @param {string} url  video URL (MP4 or YouTube)
 * @example
 * loadVideo('cat', 'https://example.com/cat.mp4')
 * $: video('cat')
 * @example
 * loadVideo('yt', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
 * $: s('yt')
 */
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

/**
 * Register an image by name. Idempotent — no-op if name+url already match.
 * Use the name with `image()` or `s()` after calling this.
 *
 * @param {string} name short identifier used in patterns
 * @param {string} url  image URL (PNG, JPEG, GIF, etc.)
 * @example
 * loadImage('logo', 'https://example.com/logo.png')
 * $: image('logo')
 */
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
  registry.length = 0;
  save();
}

export function setOnChange(cb: (() => void) | null) {
  onChange = cb;
}

/** Add an additional listener that is called alongside the primary onChange. @internal */
export function addOnChange(cb: () => void) {
  extraListeners.add(cb);
  return () => extraListeners.delete(cb); // returns an unsubscribe fn
}

function pollTranscodeReady(entryId: string, stem: string, serverBase: string, interval = 2000) {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`${serverBase}/ready/${encodeURIComponent(stem)}`);
      const data = await res.json() as { ready: boolean; error?: string };
      const current = getEntryById(entryId);
      if (!current) { clearInterval(timer); return; }
      if (data.ready || data.error) {
        clearInterval(timer);
        current.uploading = false;
        if (data.error) current.error = `Transcode failed: ${data.error}`;
        else generateThumbnail(current);
        save();
      }
    } catch {
      // server not reachable yet, keep polling
    }
  }, interval);
}

/** Upload a local file to the server, re-encode as I-frame-only MP4, then update the entry URL. @internal */
export function uploadToServer(name: string, file: File, serverBase = "http://localhost:3456"): Promise<void> {
  return new Promise((resolve, reject) => {
    const entry = registry.find(e => e.name === name);
    if (!entry) return reject(new Error(`Entry not found: ${name}`));
    const { id } = entry;

    entry.uploading = true;
    entry.uploadProgress = 0;
    entry.error = undefined;
    entry.pendingFile = file;
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
        const oldUrl = current.url;
        current.url = data.url;
        current.type = 'video';
        current.uploadProgress = undefined;
        current.pendingFile = undefined;
        if (data.ready) {
          current.uploading = false;
          save();
          if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
          generateThumbnail(current);
        } else {
          // Transcoding in progress — keep uploading=true (shows ⚙), poll for completion
          save();
          if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
          const stem = data.url.split('/').pop()?.replace(/\.mp4$/, '') ?? '';
          pollTranscodeReady(id, stem, serverBase);
        }
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
  const entry = registry.find(e => e.name === name);
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    entry.thumbnail = dataUrl;
    // Persist thumbnail separately by ID — registry state lives in the URL, not localStorage.
    try { localStorage.setItem(THUMB_STORAGE_PREFIX + entry.id, dataUrl); } catch { /* storage full */ }
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
