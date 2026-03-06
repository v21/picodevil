export function setPlaybackRate(el: HTMLMediaElement, rate: number): void {
  try { el.playbackRate = rate; } catch (e) {
    if ((e as DOMException).name === "NotSupportedError") console.error("unsupported playback rate:", rate);
    else throw e;
  }
}
