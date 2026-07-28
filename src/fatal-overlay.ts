/**
 * Full-screen overlay for unrecoverable startup failures (e.g. no WebGL2).
 *
 * The app's whole UI is built around a WebGL2 canvas; if that can't initialise
 * there's nothing useful to show, so instead of a silent black page we put up an
 * explainer telling the user what's wrong and how to fix it.
 */

/**
 * Pick the user-facing title/message for a renderer startup failure.
 *
 * Two distinct failure modes get different advice (see the error classes in
 * webgl-renderer.ts):
 *   - `ShaderError` — WebGL2 is present but a shader wouldn't compile/link on this
 *     GPU/driver (classically ANGLE→Direct3D on Windows). Advise driver/browser
 *     update + point at the console, where the driver log + shader source were
 *     dumped at the throw site.
 *   - anything else (incl. `WebGL2UnavailableError`) — no usable WebGL2 context.
 *     Advise enabling hardware acceleration.
 *
 * Branches on `err.name` (a string) rather than `instanceof` so this module stays
 * decoupled from the renderer — the safety net shouldn't depend on the thing that
 * failed.
 */
export function rendererFailureMessage(err: unknown): { title: string; message: string } {
  if ((err as { name?: string } | null)?.name === "ShaderError") {
    return {
      title: "picodevil couldn't start on this GPU",
      message:
        "Your browser supports WebGL2, but its graphics shader failed to compile on " +
        "this GPU or driver. Updating your graphics drivers (or your browser) may fix " +
        "it. Full technical details are in the browser console.",
    };
  }
  return {
    title: "This browser can't run picodevil",
    message:
      "picodevil needs WebGL2 with hardware acceleration. Try a recent Chrome, Edge, " +
      "or Firefox, and make sure hardware acceleration is enabled in your browser settings.",
  };
}

/** Show a fatal-error overlay. Idempotent — a second call replaces the message. */
export function showFatalOverlay(title: string, message: string): HTMLElement {
  const existing = document.getElementById("pd-fatal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "pd-fatal";
  overlay.setAttribute("role", "alert");
  overlay.style.cssText = [
    "position:fixed", "inset:0", "z-index:99999",
    "display:flex", "align-items:center", "justify-content:center",
    "padding:2rem", "box-sizing:border-box",
    "background:#111", "color:#eee",
    "font:16px/1.5 system-ui, sans-serif", "text-align:center",
  ].join(";");

  const box = document.createElement("div");
  box.style.cssText = "max-width:32rem";

  const h = document.createElement("h1");
  h.textContent = title;
  h.style.cssText = "font-size:1.4rem;margin:0 0 0.75rem";

  const p = document.createElement("p");
  p.textContent = message;
  p.style.cssText = "margin:0;opacity:0.85";

  box.append(h, p);
  overlay.append(box);
  document.body.appendChild(overlay);
  return overlay;
}
