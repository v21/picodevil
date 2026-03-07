export const MIN_NATIVE_RATE = 0.0625;
export const MAX_NATIVE_RATE = 16;

export function isNativeRate(rate: number): boolean {
  return rate >= MIN_NATIVE_RATE && rate <= MAX_NATIVE_RATE;
}

export function setPlaybackRate(el: HTMLMediaElement, rate: number): void {
  try { el.playbackRate = rate; } catch (e) {
    if ((e as DOMException).name === "NotSupportedError") console.error("unsupported playback rate:", rate);
    else throw e;
  }
}
