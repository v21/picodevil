import { VIDEO_BASE, IMAGE_BASE, PREWARM_LOOKAHEAD_MS } from './config';
import { eventBeginFromHap } from './event-begin';
import { scoreFreeElement, computeExpectedFromEvent } from './video-pool';
import { renderVideoFrame } from './video-playback';
import { warn } from './warnings';
import { getStreamVideoEl } from './stream-manager';
import type { Renderer, TileParams, TileSource } from './renderer-interface';
import type { VideoEl } from './video-element-state';
import type { createVideoPoolManager } from './video-pool-manager';

type VideoPool = ReturnType<typeof createVideoPoolManager>;
type Screen = { queryArc(begin: number, end: number): any[] };

interface FrameEvent {
  screenIndex: number;
  eventIndex: number;
  ev: any;
  hap: any;
}

/** Subset of uzuMetrics that the frame renderer updates. */
export interface FrameMetrics {
  shareHits: number;
  xLog: number[];
  seeksThisFrame: number;
}

const SHARE_TIME_THRESHOLD = 0.04;
const TAU = Math.PI * 2;

/**
 * Owns the per-frame rendering pipeline: collect pattern events, assign video
 * elements, build TileParams, and dispatch to the active Renderer backend.
 * Also manages the image pool and video prewarm logic.
 */
export class FrameRenderer {
  /** Per-frame video element assignments, keyed by "screenIndex:eventIndex". Exposed for testing. */
  readonly frameAssignments = new Map<string, VideoEl>();
  /** Total events collected in the last render() call. Exposed for metrics. */
  lastEventCount = 0;

  private readonly renderer: Renderer;
  private readonly pool: VideoPool;
  private readonly metrics: FrameMetrics;
  private readonly imagePool = new Map<string, HTMLImageElement>();
  private readonly colorCache = new Map<string, [number, number, number]>();
  private readonly scratchCtx = document.createElement('canvas').getContext('2d')!;

  constructor(renderer: Renderer, pool: VideoPool, metrics: FrameMetrics) {
    this.renderer = renderer;
    this.pool = pool;
    this.metrics = metrics;
  }

  /**
   * Called from uzuEval after new screens are registered.
   * Warms blob cache and image elements for all sources in the screen.
   */
  prewarmBlobs(screen: Screen): void {
    const probe = screen.queryArc(0, 1);
    for (const h of probe) {
      const v = h.value;
      if (v?._type === 'video') {
        const base = v.urlBase ?? VIDEO_BASE;
        this.pool.fetchVideoBlob(this.pool.resolveMediaUrl(v.src, base));
      } else if (v?._type === 'image') {
        const base = v.urlBase ?? IMAGE_BASE;
        this.getImageEl(v.src, base);
      }
    }
  }

  /** Called from uzuEval: drop all cached image elements. */
  clearImages(): void {
    this.imagePool.clear();
  }

  /**
   * Render one full frame.
   * Phases: collect events → assign video elements → beginFrame → draw → endFrame → prewarm.
   */
  render(screens: Screen[], t: number, cps: number, cycle: number): void {
    this.metrics.seeksThisFrame = 0;
    const frameEvents = this.collectFrameEvents(screens, t);
    this.lastEventCount = frameEvents.length;
    this.assignVideoElements(frameEvents, t, cps);
    this.renderer.beginFrame();
    this.drawFrameEvents(frameEvents, t, cps);
    this.renderer.endFrame();
    if (cps > 0) this.prewarmVideos(screens, cycle, cps);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getImageEl(src: string, base: string): HTMLImageElement {
    const srcUrl = this.pool.resolveMediaUrl(src, base);
    if (this.imagePool.has(srcUrl)) return this.imagePool.get(srcUrl)!;
    const el = new Image();
    el.src = srcUrl;
    el.addEventListener('load', () => console.log('image loaded:', src));
    el.addEventListener('error', () => console.error('image failed to load:', srcUrl));
    this.imagePool.set(srcUrl, el);
    return el;
  }

  private parseColor(val: string): [number, number, number] {
    const cached = this.colorCache.get(val);
    if (cached) return cached;
    this.scratchCtx.fillStyle = '#000';
    this.scratchCtx.fillStyle = val;
    const hex = this.scratchCtx.fillStyle;
    if (hex === '#000000' && val !== 'black' && val !== '#000000' && val !== '#000') {
      this.colorCache.set(val, [1, 1, 1]);
      return [1, 1, 1];
    }
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) {
      const result: [number, number, number] = [
        parseInt(m[1], 16) / 255,
        parseInt(m[2], 16) / 255,
        parseInt(m[3], 16) / 255,
      ];
      this.colorCache.set(val, result);
      return result;
    }
    this.colorCache.set(val, [1, 1, 1]);
    return [1, 1, 1];
  }

  /** Phase 1: Query all screens and collect events for this cycle position. */
  private collectFrameEvents(screens: Screen[], t: number): FrameEvent[] {
    const result: FrameEvent[] = [];
    for (let si = 0; si < screens.length; si++) {
      let events: any[];
      try {
        events = screens[si].queryArc(t, t);
      } catch (e) {
        warn(`queryArc failed on screen ${si}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (!events || !Array.isArray(events)) {
        warn(`screen ${si}: queryArc returned non-array: ${typeof events}`);
        continue;
      }
      for (let ei = 0; ei < events.length; ei++) {
        const ev = events[ei]?.value;
        if (ev == null || typeof ev !== 'object') {
          warn(`screen ${si} event ${ei}: expected object value, got ${typeof ev}`);
          continue;
        }
        if (!ev._type) {
          warn(`screen ${si} event ${ei}: missing _type (got keys: ${Object.keys(ev).join(',')})`);
          continue;
        }
        result.push({ screenIndex: si, eventIndex: ei, ev, hap: events[ei] });
      }
    }
    return result;
  }

  /**
   * Phase 2: Assign video elements for all video events.
   * Reuse by draw position for frame-to-frame stability; share by content when
   * the same src is at a similar expected playback time.
   */
  private assignVideoElements(frameEvents: FrameEvent[], t: number, cps: number): void {
    const { pool, frameAssignments, metrics } = this;
    frameAssignments.clear();
    const assignedExpected = new Map<string, { srcUrl: string; expected: number }>();

    // Pre-pass: free any active pool entries whose src won't be needed at their
    // current draw position (e.g. after a shuffle rearranges the layout).
    const neededSrc = new Map<string, string>();
    for (const fe of frameEvents) {
      if (fe.ev._type !== 'video') continue;
      const drawPos = `${fe.screenIndex}:${fe.eventIndex}`;
      const base = fe.ev.urlBase ?? VIDEO_BASE;
      neededSrc.set(drawPos, pool.resolveMediaUrl(fe.ev.src, base));
    }
    for (const [key, el] of pool.videoPool) {
      const needed = neededSrc.get(key);
      if (needed === undefined || el._state.srcUrl !== needed) {
        pool.freeVideoEl(el);
        pool.videoPool.delete(key);
      }
    }

    for (const fe of frameEvents) {
      if (fe.ev._type !== 'video') continue;
      const drawPos = `${fe.screenIndex}:${fe.eventIndex}`;
      const ev = fe.ev;
      const base = ev.urlBase ?? VIDEO_BASE;
      const srcUrl = pool.resolveMediaUrl(ev.src, base);
      const eventBegin = eventBeginFromHap(ev, fe.hap, t);
      const cachedDur = pool.videoDurations.get(srcUrl);
      const expectedTime = computeExpectedFromEvent(ev, t, eventBegin, cps, cachedDur);

      // 1. Reuse: same draw position, same src → keep same element
      const prev = pool.videoPool.get(drawPos);
      if (prev && prev._state.srcUrl === srcUrl) {
        frameAssignments.set(drawPos, prev);
        if (expectedTime != null) assignedExpected.set(drawPos, { srcUrl, expected: expectedTime });
        continue;
      }

      // 2. Share: another event this frame with same src at similar expected time
      let shared = false;
      for (const [otherKey, el] of frameAssignments) {
        if (el._state.srcUrl !== srcUrl) continue;
        if (expectedTime != null) {
          const other = assignedExpected.get(otherKey);
          if (!other || other.srcUrl !== srcUrl) continue;
          const dur = cachedDur ?? (isFinite(el.duration) ? el.duration : 0);
          const score = dur > 0
            ? scoreFreeElement(other.expected, expectedTime, dur)
            : Math.abs(other.expected - expectedTime);
          if (score >= SHARE_TIME_THRESHOLD) continue;
        }
        frameAssignments.set(drawPos, el);
        if (expectedTime != null) assignedExpected.set(drawPos, { srcUrl, expected: expectedTime });
        metrics.shareHits++;
        shared = true;
        break;
      }
      if (shared) continue;

      // 3. Allocate from free pool, scored by proximity to expected time
      const isScrubbed = Number(ev.begin ?? 0) === Number(ev.end ?? 1);
      const el = pool.getVideoEl(ev.src, base, drawPos, expectedTime ?? undefined, !isScrubbed);
      frameAssignments.set(drawPos, el as VideoEl);
      if (expectedTime != null) assignedExpected.set(drawPos, { srcUrl, expected: expectedTime });
    }

    // Free active pool entries not used this frame
    for (const [key, el] of pool.videoPool) {
      if (!frameAssignments.has(key)) {
        pool.freeVideoEl(el);
        pool.videoPool.delete(key);
      }
    }
  }

  /**
   * Resolve one pattern event into TileParams.
   * Returns null if the event should be skipped (missing element, zero dimensions, NaN values).
   */
  private buildTileParams(fe: FrameEvent, t: number, cps: number): TileParams | null {
    const { ev, hap, screenIndex, eventIndex } = fe;

    // Position
    const px = ev.x !== undefined ? Number(ev.x) : 0;
    if (ev.x !== undefined) this.metrics.xLog.push(px);
    const py = ev.y !== undefined ? Number(ev.y) : 0;
    const pw = ev.width !== undefined ? Number(ev.width) : 1;
    const ph = ev.height !== undefined ? Number(ev.height) : 1;
    if (isNaN(px) || isNaN(py) || isNaN(pw) || isNaN(ph)) {
      warn(`screen ${screenIndex} event ${eventIndex}: NaN in position (x=${ev.x}, y=${ev.y}, w=${ev.width}, h=${ev.height})`);
      return null;
    }

    // Alpha
    let alpha = ev.alpha !== undefined ? Number(ev.alpha) : 1;
    if (isNaN(alpha)) {
      warn(`screen ${screenIndex} event ${eventIndex}: NaN alpha (raw=${ev.alpha})`);
      alpha = 1;
    }

    // Rotation — pre-compute cosine scales so the renderer doesn't need trig
    let rotateZ = ev.rotateZ !== undefined ? Number(ev.rotateZ) : 0;
    let rotateXScale = 1;
    let rotateYScale = 1;
    if (ev.rotateX !== undefined) rotateXScale = Math.cos(Number(ev.rotateX) * TAU);
    if (ev.rotateY !== undefined) rotateYScale = Math.cos(Number(ev.rotateY) * TAU);
    if (ev.rotate !== undefined && ev.rotateAxis !== undefined) {
      const turns = Number(ev.rotate);
      const axisAngle = Number(ev.rotateAxis) * TAU;
      const cosAxis = Math.cos(axisAngle);
      const sinAxis = Math.sin(axisAngle);
      const cosTurns = Math.cos(turns * TAU);
      rotateXScale *= 1 - cosAxis * cosAxis * (1 - cosTurns);
      rotateYScale *= 1 - sinAxis * sinAxis * (1 - cosTurns);
    }

    // Source — resolve to a TileSource or bail
    let source: TileSource;
    if (ev._type === 'color') {
      const [r, g, b] = this.parseColor(ev.color);
      source = { kind: 'color', r, g, b };
    } else if (ev._type === 'image') {
      const base = ev.urlBase ?? IMAGE_BASE;
      const el = this.imagePool.get(this.pool.resolveMediaUrl(ev.src, base));
      if (!el || el.naturalWidth === 0) return null;
      source = { kind: 'image', el };
    } else if (ev._type === 'video') {
      const drawPos = `${screenIndex}:${eventIndex}`;
      const el = this.frameAssignments.get(drawPos);
      if (!el) return null;
      const eventBegin = eventBeginFromHap(ev, hap, t);
      if (isFinite(el.duration) && el.duration > 0) {
        renderVideoFrame({ ev, el, currentCycle: t, eventBegin, cps, onSeek: () => { this.metrics.seeksThisFrame++; } });
      }
      if (el.videoWidth === 0) return null;
      source = { kind: 'video', el };
    } else if (ev._type === 'stream') {
      const el = getStreamVideoEl(ev.src);
      if (!el || el.videoWidth === 0) return null;
      source = { kind: 'stream', el };
    } else {
      warn(`screen ${screenIndex} event ${eventIndex}: unknown _type "${ev._type}"`);
      return null;
    }

    return {
      source,
      x: px, y: py, w: pw, h: ph,
      cropx: ev.cropx ?? 0.5,
      cropy: ev.cropy ?? 0.5,
      cropw: ev.cropw ?? 1,
      croph: ev.croph ?? 1,
      fit: ev.objectfit ?? 'cover',
      alpha,
      blend: ev.blend !== undefined ? String(ev.blend) : 'source-over',
      rotateZ,
      rotateXScale,
      rotateYScale,
      scaleX: ev.scaleX !== undefined ? Number(ev.scaleX) : 1,
      scaleY: ev.scaleY !== undefined ? Number(ev.scaleY) : 1,
    };
  }

  /** Phase 3: Build TileParams for each event and dispatch to the renderer. */
  private drawFrameEvents(frameEvents: FrameEvent[], t: number, cps: number): void {
    for (const fe of frameEvents) {
      let params: TileParams | null;
      try {
        params = this.buildTileParams(fe, t, cps);
      } catch (e) {
        warn(`screen ${fe.screenIndex} event ${fe.eventIndex} build error: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (params === null) continue;
      try {
        this.renderer.drawTile(params);
      } catch (e) {
        warn(`screen ${fe.screenIndex} event ${fe.eventIndex} draw error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Phase 4: Query ahead, seek free pool elements toward future targets, create if needed. */
  private prewarmVideos(screens: Screen[], cycle: number, cps: number): void {
    const { pool } = this;
    const lookaheadCycles = (PREWARM_LOOKAHEAD_MS / 1000) * cps;
    const futureT = cycle + lookaheadCycles;

    for (const screen of screens) {
      let futureEvents: any[];
      try {
        futureEvents = screen.queryArc(futureT, futureT);
        if (!futureEvents || !Array.isArray(futureEvents)) continue;
      } catch { continue; }

      for (const hap of futureEvents) {
        const ev = hap?.value;
        if (!ev || ev._type !== 'video') continue;

        const base = ev.urlBase ?? VIDEO_BASE;
        const srcUrl = pool.resolveMediaUrl(ev.src, base);
        const eventBegin = eventBeginFromHap(ev, hap, futureT);
        const cachedDur = pool.videoDurations.get(srcUrl);
        const expectedTime = computeExpectedFromEvent(ev, futureT, eventBegin, cps, cachedDur);

        pool.fetchVideoBlob(srcUrl);

        const freeList = pool.freeVideoPool.get(srcUrl);
        if (freeList && freeList.length > 0 && expectedTime != null) {
          let bestIdx = 0;
          let bestScore = Infinity;
          for (let i = 0; i < freeList.length; i++) {
            const dur = isFinite(freeList[i].duration) ? freeList[i].duration : (cachedDur ?? 0);
            const score = scoreFreeElement(freeList[i].currentTime, expectedTime, dur);
            if (score < bestScore) { bestScore = score; bestIdx = i; }
          }
          const best = freeList[bestIdx];
          if (!best._state.seeking && bestScore > 0.15) {
            best.currentTime = expectedTime;
          }
          continue;
        }

        const alreadyActive = [...pool.videoPool.values()].some(el => el._state.srcUrl === srcUrl);
        if (alreadyActive) continue;

        const el = pool.makeVideoEl(ev.src);
        el._state.srcUrl = srcUrl;
        const blobUrl = pool.videoBlobUrls.get(srcUrl);
        el.src = blobUrl ?? srcUrl;
        el.preload = 'auto';

        el.addEventListener('loadedmetadata', () => {
          const realExpected = computeExpectedFromEvent(ev, futureT, eventBegin, cps, el.duration);
          if (realExpected != null) el.currentTime = realExpected;
        }, { once: true });

        pool.freeVideoEl(el);
      }
    }
  }
}
