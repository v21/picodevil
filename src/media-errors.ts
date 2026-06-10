/**
 * Map a getUserMedia / getDisplayMedia rejection to a short, user-facing message.
 * Shared by the camera/screen capture (stream-manager) and audio capture
 * (fft-audio) paths so permission denials surface in the warning overlay instead
 * of only the console.
 */
import { warn } from "./warnings";

export function describeMediaError(err: unknown, what: string): string {
  const name = (err as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `${what} permission denied — allow access in your browser to use it.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `${what}: no matching device found.`;
    case "NotReadableError":
      return `${what}: the device is in use by another application.`;
    case "AbortError":
      return `${what} was cancelled.`;
    default: {
      const msg = (err as { message?: string })?.message;
      return `${what} failed${msg ? `: ${msg}` : ""}.`;
    }
  }
}

/** True if the error is a user/browser permission denial (vs a device/other failure). */
export function isPermissionDenied(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "NotAllowedError" || name === "SecurityError";
}

/** Last path segment of a URL (filename), for compact error messages. */
export function shortenUrl(u: string): string {
  try { return new URL(u, "http://x/").pathname.split("/").pop() || u; } catch { return u; }
}

/**
 * Message for a media element load failure (404, network, decode), or null if the
 * "error" event is spurious. Pure so it's testable without DOM events.
 * `hasError` is the <video>'s MediaError presence — a recycled element whose src
 * was cleared fires "error" with no MediaError, which we ignore.
 */
export function describeMediaLoadError(
  kind: "video" | "image",
  src: string | null | undefined,
  hasError: boolean,
): string | null {
  if (kind === "video" && !hasError) return null; // spurious (pool recycle / src cleared)
  if (!src) return null;
  return `${kind === "video" ? "Video" : "Image"} failed to load: ${shortenUrl(src)}`;
}

/** Attach a deduped load-error warning to a media element (video or image). */
export function warnOnMediaLoadError(el: HTMLVideoElement | HTMLImageElement): void {
  el.addEventListener("error", () => {
    const isVideo = el instanceof HTMLVideoElement;
    const src = isVideo ? (el.currentSrc || el.src) : el.src;
    const msg = describeMediaLoadError(isVideo ? "video" : "image", src, isVideo ? !!el.error : true);
    if (msg) warn(msg);
  });
}
