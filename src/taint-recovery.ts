/**
 * WebGL cross-origin taint detection, diagnostics and auto-cure.
 *
 * Background: uploading a video frame to a GPU texture via `gl.texImage2D(el)`
 * throws a `SecurityError` ("The video element contains cross-origin data, and
 * may not be loaded.") when the browser considers the element's loaded resource
 * to be cross-origin and not CORS-clean. When this happens the source goes black
 * (every frame re-throws and is swallowed) until the page is refreshed.
 *
 * All our video elements are created with `crossOrigin="anonymous"` and our CDN
 * sends `Access-Control-Allow-Origin: *`, so in theory this should never fire —
 * but it does, intermittently, under heavy performance load. Rather than reason
 * about the exact browser-side cause, we capture rich diagnostics the *moment* it
 * happens (so a real occurrence is conclusive) and auto-cure by swapping the
 * element onto its same-origin `blob:` URL, which can never taint.
 *
 * The pure helpers (`isTaintError`, `buildTaintRecord`, `appendToRing`) are unit
 * tested; the orchestrator `recoverFromDrawError` wires them to console /
 * localStorage / the video pool.
 */

import type { TileParams } from "./renderer-interface";
import type { FrameEvent } from "./source-query";

/** localStorage key holding the rolling taint diagnostics log. */
export const TAINT_LOG_KEY = "picodevil-taint-log";
/** Max records kept in the localStorage ring buffer. */
export const TAINT_LOG_MAX = 50;

/** Minimal pool surface the cure needs (subset of VideoPoolManager). */
export interface CurePool {
  getBlobUrl(srcUrl: string): string | undefined;
  fetchVideoBlob(srcUrl: string): void;
}

/** A single captured taint event. Plain JSON — safe to stringify into localStorage. */
export interface TaintRecord {
  time: string;
  kind: string;
  message: string;
  errorName?: string;
  screenIndex?: number;
  eventIndex?: number;
  /** The logical media URL the element was assigned (from `_state.srcUrl`). */
  srcUrl?: string;
  /** What the element actually loaded — distinguishes a raw http: src from a cured blob:. */
  currentSrc?: string;
  src?: string;
  /** Origin/host of `currentSrc`, the single most useful field for finding the culprit host. */
  host?: string;
  crossOrigin?: string | null;
  readyState?: number;
  networkState?: number;
  videoWidth?: number;
  videoHeight?: number;
  /** HTMLMediaElement.error.code, if any. */
  mediaErrorCode?: number;
  /** Whether a same-origin blob was already cached for this src at taint time. */
  hadBlob?: boolean;
  /**
   * What the recovery did:
   * - "cured-blob": swapped onto the already-cached same-origin blob: URL (guaranteed clean).
   * - "cured-cachebust": reloaded src with a `?pdcb=N` param to force a fresh CORS fetch.
   * - "no-cure": couldn't act (no srcUrl, or a stream/image source).
   */
  action?: string;
}

/** True if the thrown error is the WebGL cross-origin / tainted-canvas security error. */
export function isTaintError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name;
  const msg = (e as { message?: string }).message ?? "";
  if (name === "SecurityError") return true;
  return /cross-origin|cross origin|tainted/i.test(msg);
}

/** Host of a URL, or undefined if it isn't parseable (e.g. a blob: or data: with no host). */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host || new URL(url).protocol; // blob:/data: → protocol as a hint
  } catch {
    return undefined;
  }
}

/**
 * Build a diagnostics record from the offending tile/element. Pure aside from
 * reading element properties — pass a plain element-like object in tests.
 */
export function buildTaintRecord(
  params: Pick<TileParams, "source">,
  fe: Pick<FrameEvent, "screenIndex" | "eventIndex"> | undefined,
  e: unknown,
  now: string,
  hadBlob: boolean,
  action: string,
): TaintRecord {
  const src = params.source;
  const rec: TaintRecord = {
    time: now,
    kind: src.kind,
    message: (e as { message?: string })?.message ?? String(e),
    errorName: (e as { name?: string })?.name,
    screenIndex: fe?.screenIndex,
    eventIndex: fe?.eventIndex,
    hadBlob,
    action,
  };
  if (src.kind === "video" || src.kind === "stream" || src.kind === "image") {
    const el = src.el as HTMLVideoElement & { _state?: { srcUrl?: string } };
    rec.srcUrl = el._state?.srcUrl;
    rec.currentSrc = el.currentSrc;
    rec.src = el.src;
    rec.host = hostOf(el.currentSrc || el.src);
    rec.crossOrigin = el.crossOrigin;
    rec.readyState = el.readyState;
    rec.networkState = el.networkState;
    rec.videoWidth = (el as HTMLVideoElement).videoWidth;
    rec.videoHeight = (el as HTMLVideoElement).videoHeight;
    rec.mediaErrorCode = el.error?.code;
  }
  return rec;
}

/** Append a record to a ring buffer, keeping only the most recent `max`. Pure. */
export function appendToRing(existing: TaintRecord[], rec: TaintRecord, max: number): TaintRecord[] {
  const next = existing.concat(rec);
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Read the persisted taint log (newest last). Returns [] on any failure. */
export function readTaintLog(): TaintRecord[] {
  try {
    const raw = localStorage.getItem(TAINT_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(rec: TaintRecord): void {
  try {
    const next = appendToRing(readTaintLog(), rec, TAINT_LOG_MAX);
    localStorage.setItem(TAINT_LOG_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable or over quota — diagnostics still went to console */
  }
}

/** Append a cache-busting query param so a reload bypasses any poisoned cache entry. Pure. */
export function cacheBustUrl(url: string, n: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}pdcb=${n}`;
}

/**
 * Decide how to cure a tainted video element. Pure — returns the new src to assign
 * (or undefined if the element already holds it / can't be cured) and an action label.
 *
 * blob fast-path: a same-origin blob: URL can never taint, so if one is already cached
 * we just swap to it (no download forced). Otherwise reload with a cache-busting param,
 * which forces a fresh CORS fetch and dodges a poisoned no-CORS cache entry.
 */
export function decideCure(
  srcUrl: string | undefined,
  blobUrl: string | undefined,
  currentSrc: string,
  cbN: number,
): { newSrc?: string; action: string } {
  if (!srcUrl) return { action: "no-cure" };
  if (blobUrl) {
    return currentSrc === blobUrl ? { action: "cured-blob" } : { newSrc: blobUrl, action: "cured-blob" };
  }
  return { newSrc: cacheBustUrl(srcUrl, cbN), action: "cured-cachebust" };
}

// Dedupe: act at most once per (element, srcUrl) so a tainted element doesn't trigger
// a reload storm or flood console/localStorage at 60fps. Re-acts if the element is later
// recycled onto a different src. After a cure the element reloads (videoWidth → 0, so the
// uploader skips it) and shouldn't re-throw; if the blob later lands the renderer's own
// reuse path upgrades it.
const handled = new WeakMap<object, string | undefined>();
let cbCounter = 0;

/**
 * Called from the renderer's drawTile catch. No-ops for non-taint errors.
 * On a taint error it logs diagnostics once (console.error + localStorage) and, for video
 * sources, cures the element via {@link decideCure} (cached blob, else cache-bust reload).
 *
 * @returns true if it handled a taint error (caller can skip its generic warn).
 */
export function recoverFromDrawError(
  e: unknown,
  params: Pick<TileParams, "source">,
  fe: Pick<FrameEvent, "screenIndex" | "eventIndex"> | undefined,
  pool: CurePool,
  now: string = new Date().toISOString(),
): boolean {
  if (!isTaintError(e)) return false;

  const src = params.source;
  const el =
    src.kind === "video" || src.kind === "stream" || src.kind === "image"
      ? (src.el as HTMLVideoElement & { _state?: { srcUrl?: string } })
      : undefined;
  const srcUrl = src.kind === "video" ? el?._state?.srcUrl : undefined;

  // Dedupe per element + src so we act/log exactly once per episode.
  if (el && handled.get(el) === srcUrl) return true;
  if (el) handled.set(el, srcUrl);

  let action = "no-cure";
  let hadBlob = false;
  if (src.kind === "video" && el) {
    const blobUrl = srcUrl ? pool.getBlobUrl(srcUrl) : undefined;
    hadBlob = blobUrl !== undefined;
    const cure = decideCure(srcUrl, blobUrl, el.src, ++cbCounter);
    action = cure.action;
    if (cure.newSrc !== undefined) el.src = cure.newSrc;
  }

  const rec = buildTaintRecord(params, fe, e, now, hadBlob, action);
  console.error("[pd] WebGL CORS taint:", rec);
  persist(rec);
  return true;
}

/** Clear the persisted taint log. */
export function clearTaintLog(): void {
  try {
    localStorage.removeItem(TAINT_LOG_KEY);
  } catch {
    /* ignore */
  }
}

// Expose a convenience accessor for fishing diagnostics out after the fact.
if (typeof window !== "undefined") {
  (window as { pdTaintLog?: () => TaintRecord[] }).pdTaintLog = readTaintLog;
  (window as { pdClearTaintLog?: () => void }).pdClearTaintLog = clearTaintLog;
}
