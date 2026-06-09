import type { MediaEntry } from "./media-registry";

/** Hash fields we persist to the URL. Thumbnails go to localStorage instead. */
type UrlMediaEntry = Pick<MediaEntry, "id" | "name" | "url" | "type"> &
  Partial<Pick<MediaEntry, "duration" | "streamKind" | "deviceId">>;

type FftConfig = { bins: number; smooth: number; cutoff: number; scale: number };
type UrlState = { v: number; code: string; media: UrlMediaEntry[]; fft?: FftConfig };

/** Maximum hash length (bytes) before we warn the user. */
const URL_WARN_BYTES = 32000;

function toBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const PREFIX = "v1,";

function stripEntry(e: MediaEntry): UrlMediaEntry {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    type: e.type,
    ...(e.duration != null ? { duration: e.duration } : {}),
    ...(e.streamKind != null ? { streamKind: e.streamKind } : {}),
    ...(e.deviceId != null ? { deviceId: e.deviceId } : {}),
  };
}

/**
 * Encode pattern code + media registry into a URL hash string (without the leading #).
 * Thumbnails, transient state, and blob URLs are stripped.
 */
export function encodeUrlState(code: string, media: MediaEntry[], fft?: FftConfig): string {
  // Drop blob: entries — they're session-scoped object URLs. The underlying File
  // is gone after a reload (and a re-created blob wouldn't share the reference),
  // so persisting them just resurrects dead, unplayable rows. Strip them here.
  const persistable = media.filter((e) => !e.url.startsWith("blob:"));
  const state: UrlState = { v: 1, code, media: persistable.map(stripEntry), ...(fft ? { fft } : {}) };
  return PREFIX + toBase64url(JSON.stringify(state, (key, value) => {
    if (typeof value === 'bigint') {
      console.warn(`[uzu] unexpected BigInt in URL state field "${key}":`, value);
      return Number(value);
    }
    return value;
  }));
}

/**
 * Decode a URL hash string (with or without the leading #) into code + media.
 * Returns null if the hash is absent, malformed, or the wrong version.
 */
export function decodeUrlState(hash: string): { code: string; media: UrlMediaEntry[]; fft?: FftConfig } | null {
  try {
    const content = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!content.startsWith(PREFIX)) return null;
    const json = fromBase64url(content.slice(PREFIX.length));
    const state: UrlState = JSON.parse(json);
    if (state.v !== 1 || typeof state.code !== "string" || !Array.isArray(state.media)) return null;
    return { code: state.code, media: state.media, fft: state.fft };
  } catch {
    return null;
  }
}

/** Load state from the current page's URL hash. Returns null if no valid state. */
export function loadFromUrl(): { code: string; media: UrlMediaEntry[]; fft?: FftConfig } | null {
  return decodeUrlState(window.location.hash);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let urlWarnCallback: ((msg: string | null) => void) | null = null;

/** Register a callback to receive URL-encoding warnings (e.g. state too large). Pass null to clear. */
export function setUrlWarnCallback(cb: ((msg: string | null) => void) | null) {
  urlWarnCallback = cb;
}

/**
 * Debounced save: encodes current code + media into the URL hash.
 * If the encoded state exceeds the warn limit, calls the registered warn callback.
 * Calls are coalesced within a 500ms window.
 */
export function saveToUrl(code: string, media: MediaEntry[], fft?: FftConfig) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const encoded = encodeUrlState(code, media, fft);
      if (encoded.length > URL_WARN_BYTES) {
        urlWarnCallback?.(
          `URL state is large (${encoded.length} chars) — the link may be too long to share reliably`,
        );
      } else {
        urlWarnCallback?.(null);
      }
      history.replaceState(null, "", "#" + encoded);
    } catch (e) {
      urlWarnCallback?.(`Could not encode state to URL: ${e}`);
    }
  }, 500);
}
