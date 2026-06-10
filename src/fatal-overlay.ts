/**
 * Full-screen overlay for unrecoverable startup failures (e.g. no WebGL2).
 *
 * The app's whole UI is built around a WebGL2 canvas; if that can't initialise
 * there's nothing useful to show, so instead of a silent black page we put up an
 * explainer telling the user what's wrong and how to fix it.
 */

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
