/**
 * Map a getUserMedia / getDisplayMedia rejection to a short, user-facing message.
 * Shared by the camera/screen capture (stream-manager) and audio capture
 * (fft-audio) paths so permission denials surface in the warning overlay instead
 * of only the console.
 */
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
