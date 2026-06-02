/**
 * Optional companion server configuration. Connects the frontend to a
 * picodevil-server instance (see ../../server/) which handles YouTube
 * downloads and local-file transcoding.
 *
 * Storage: localStorage key `picodevil-server-url`. In dev (Vite import.meta.env.DEV),
 * defaults to `http://localhost:47426` when nothing is saved so local development
 * works zero-config.
 *
 * Resolution model: server-hosted entries store leading-slash paths like
 * `/videos/abc.mp4` and are resolved via `resolveUrl()` at the point of use.
 * External URLs (CDN, blob:, data:, YouTube proxy results) pass through unchanged.
 */

export type ServerStatus = "unknown" | "checking" | "ok" | "error";

export interface HealthResponse {
  name: string;
  version: string;
  apiVersion: number;
  port: number;
  ok: boolean;
}

const STORAGE_KEY = "picodevil-server-url";
const DEFAULT_DEV_URL = "http://localhost:47426";

let status: ServerStatus = "unknown";
let health: HealthResponse | null = null;
let lastError: string | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

function isDev(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((import.meta as any).env?.DEV);
  } catch {
    return false;
  }
}

export function getServerUrl(): string | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* SSR or denied */ }
  if (raw && raw.length > 0) return raw;
  if (isDev()) return DEFAULT_DEV_URL;
  return null;
}

export function setServerUrl(url: string | null): void {
  try {
    if (url == null || url === "") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, url);
  } catch { /* denied */ }
  status = "unknown";
  health = null;
  lastError = null;
  notify();
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function getServerStatus(): ServerStatus { return status; }
export function getServerHealth(): HealthResponse | null { return health; }
export function getServerError(): string | null { return lastError; }

/**
 * Probe the configured (or supplied) server URL's /health endpoint.
 * Updates status as a side-effect. Returns parsed health response, or null on failure.
 */
export async function probeHealth(url?: string): Promise<HealthResponse | null> {
  const target = url ?? getServerUrl();
  if (!target) {
    status = "unknown";
    health = null;
    lastError = null;
    notify();
    return null;
  }
  status = "checking";
  notify();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(new URL("/health", target).href, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as HealthResponse;
    if (data?.name !== "picodevil-server") throw new Error("Not a picodevil-server");
    health = data;
    status = "ok";
    lastError = null;
    notify();
    return data;
  } catch (err) {
    health = null;
    status = "error";
    lastError = err instanceof Error ? err.message : String(err);
    notify();
    return null;
  }
}

/**
 * Resolve a stored entry URL to a fetchable URL.
 *
 * Pass-through (returned unchanged):
 *  - Anything with a scheme (`http:`, `https:`, `blob:`, `data:`, etc.) — external sources.
 *  - Protocol-relative URLs (`//example.com/foo`).
 *
 * Server-relative paths (typically `/videos/abc.mp4` from the server's response):
 *  - Resolved against `getServerUrl()` via the URL constructor.
 *  - If no server is configured, the path is returned unchanged (caller's problem).
 */
export function resolveUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  // Has a scheme? (rfc3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":")
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("//")) return pathOrUrl;
  const base = getServerUrl();
  if (!base) return pathOrUrl;
  return new URL(pathOrUrl, base).href;
}

/**
 * Convenience: a base usable as a prefix for `${base}name.mp4` style construction.
 * Returns "" when no server is configured so callers building paths fall through
 * to whatever non-server resolution they have.
 */
export function getVideoBase(): string {
  const url = getServerUrl();
  return url ? new URL("/videos/", url).href : "";
}
export function getImageBase(): string {
  const url = getServerUrl();
  return url ? new URL("/images/", url).href : "";
}

export interface CompatibilityResult {
  /** false ⇒ Test/Save should refuse to probe; true ⇒ allowed but may carry a warning */
  ok: boolean;
  level: "info" | "warn" | "error";
  message?: string;
}

/**
 * Static analysis of a candidate server URL given the page's protocol/host.
 * No network. Called on every keystroke in the settings input.
 */
export function checkCompatibility(
  url: string,
  pageProtocol: string = typeof location !== "undefined" ? location.protocol : "http:",
  pageHost: string = typeof location !== "undefined" ? location.host : "",
): CompatibilityResult {
  if (!url || !url.trim()) return { ok: false, level: "error", message: "Enter a server URL." };

  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return { ok: false, level: "error", message: "Not a valid URL." }; }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, level: "error", message: "Only http:// and https:// URLs are supported." };
  }

  if (pageHost && parsed.host === pageHost && parsed.protocol === pageProtocol) {
    return {
      ok: true,
      level: "warn",
      message: "This is your frontend's URL — the picodevil server runs separately.",
    };
  }

  const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)
    || parsed.hostname.endsWith(".localhost");

  if (pageProtocol === "https:" && parsed.protocol === "http:" && !isLocalhost) {
    return {
      ok: true,
      level: "warn",
      message: "Browsers block HTTP requests to non-localhost hosts from HTTPS pages. " +
               "This URL won't reach your server. Run the server with HTTPS " +
               "(use `tailscale serve` for a free *.ts.net HTTPS hostname), or run picodevil locally.",
    };
  }

  if (parsed.protocol === "http:" && !parsed.port && isLocalhost) {
    return {
      ok: true,
      level: "info",
      message: "Missing port — the default picodevil-server port is 47426.",
    };
  }

  return { ok: true, level: "info" };
}

/**
 * One-shot migration for entry URLs persisted by older versions of picodevil,
 * which stored fully-qualified `http://localhost:PORT/{videos,images}/X` strings.
 * Now we store leading-slash paths and resolve at use site, so any localhost
 * URL pointing at our endpoints gets rewritten to a relative path.
 *
 * Anchored — `https://evil.com/http://localhost:3456/foo` is NOT rewritten.
 * Only `/videos/` and `/images/` paths are rewritten; other paths (e.g. `/url?...`)
 * pass through unchanged.
 */
export function migrateLegacyServerUrl(url: string): string {
  if (!url) return url;
  const match = url.match(/^https?:\/\/(localhost|127\.0\.0\.1):\d+(\/(?:videos|images)\/.*)$/);
  return match ? match[2] : url;
}

/** @internal — for tests only. Reset module state. */
export function _resetForTests() {
  status = "unknown";
  health = null;
  lastError = null;
  subscribers.clear();
}
