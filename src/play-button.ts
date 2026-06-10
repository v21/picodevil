export interface PlayButton {
  /** The button element (appended to the parent on creation). */
  el: HTMLButtonElement;
  /**
   * Reflect whether the editor's text differs from the last-evaluated code.
   * `true` = changes pending (button lights up, "press me"); `false` = up to
   * date (button greyed out).
   */
  setDirty(dirty: boolean): void;
}

// A play triangle that fills the round button. Pure inline SVG so it needs no
// asset pipeline and inherits `currentColor`.
const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">' +
  '<path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>';

/**
 * A round "evaluate" button (bottom-left of the screen) that signals when the
 * editor has unevaluated changes. Primarily for touch devices that can't press
 * Ctrl/Cmd-Enter, but shown on desktop too. Clicking it always re-evaluates;
 * it's greyed out (not disabled) when the code is already up to date so a
 * re-eval / restart is still one tap away.
 */
export function createPlayButton(parent: HTMLElement, onPlay: () => void): PlayButton {
  const btn = document.createElement("button");
  btn.className = "pd-play-button pd-play-clean";
  btn.type = "button";
  btn.setAttribute("aria-label", "Evaluate code");
  btn.title = "Evaluate (Ctrl/Cmd-Enter)";
  btn.innerHTML = PLAY_ICON;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onPlay();
  });
  parent.appendChild(btn);
  trackKeyboardInset(btn);

  const setDirty = (dirty: boolean) => {
    btn.classList.toggle("pd-play-dirty", dirty);
    btn.classList.toggle("pd-play-clean", !dirty);
  };

  return { el: btn, setDirty };
}

/**
 * How far the on-screen (virtual) keyboard intrudes into the layout viewport,
 * in CSS px. The visual viewport shrinks (and/or shifts down) when the keyboard
 * opens; the keyboard covers everything below `visualHeight + visualOffsetTop`
 * down to the layout viewport's bottom (`layoutHeight`). Clamped at 0 so a
 * keyboard-less viewport (or a URL bar collapse that grows the visual viewport)
 * never returns a negative inset.
 */
export function keyboardInset(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  return Math.max(0, layoutHeight - (visualHeight + visualOffsetTop));
}

/**
 * Lift the button above the virtual keyboard. `position:fixed` is anchored to
 * the layout viewport, so without this the button hides behind the keyboard on
 * mobile. We feed the keyboard inset into a CSS var the button's transform
 * consumes (see .pd-play-button in style.css), leaving the :active scale intact.
 */
function trackKeyboardInset(btn: HTMLElement) {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return;
  const update = () => {
    const inset = keyboardInset(window.innerHeight, vv.height, vv.offsetTop);
    btn.style.setProperty("--pd-kb-inset", `${inset}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
