/**
 * Compute eventBegin from a hap — the cycle position used to compute elapsed playback time.
 *
 * When sync is enabled, eventBegin is always 0 (play continuously from cycle 0).
 * Otherwise, use the hap's whole.begin (the canonical post-slow/post-chop event start).
 * Falls back to the current cycle time `t` when whole is missing (e.g. signal sources).
 */
export function eventBeginFromHap(ev: any, hap: any, t: number): number {
  if (ev.sync != null || ev.rolling != null) return 0;
  return Number(hap?.whole?.begin ?? t);
}
