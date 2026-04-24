import { VIDEO_BASE, IMAGE_BASE, PREWARM_LOOKAHEAD_MS, PREWARM_NEW_ELEMENTS_PER_FRAME } from './config';
import { eventBeginFromHap } from './event-begin';
import { computeExpectedFromEvent } from './video-pool';
import { renderVideoFrame } from './video-playback';
import { warn } from './warnings';
import { getStreamVideoEl } from './stream-manager';
import { queryNeeded, type FrameEvent, type NeededSource } from './source-query';
import { matchSources, type FreePool } from './source-matcher';
import type { Renderer, TileParams, TileSource } from './renderer-interface';
import type { VideoEl } from './video-element-state';
import type { createVideoPoolManager } from './video-pool-manager';

type VideoPool = ReturnType<typeof createVideoPoolManager>;
type Screen = { queryArc(begin: number, end: number): any[] };

/** Subset of uzuMetrics that the frame renderer updates. */
export interface FrameMetrics {
  shareHits: number;
  xLog: number[];
  seeksThisFrame: number;
  driftSeeksThisFrame: number;
  /** Per-phase rolling ms arrays (last 300 frames each). Set by FrameRenderer. */
  phaseQuery: number[];
  phaseAssign: number[];
  phaseDraw: number[];
  phasePrewarm: number[];
}

const TAU = Math.PI * 2;

/**
 * Owns the per-frame rendering pipeline: collect pattern events, assign video/image
 * elements, build TileParams, and dispatch to the active Renderer backend.
 * Also manages the image cache and video prewarm logic.
 */
export class FrameRenderer {
  /** Total events collected in the last render() call. Exposed for metrics. */
  lastEventCount = 0;
  /** Active video elements this frame. Exposed for metrics in main.ts. */
  readonly activeVideoEls: VideoEl[] = [];

  private readonly renderer: Renderer;
  private readonly pool: VideoPool;
  private readonly metrics: FrameMetrics;
  /** Free image elements keyed by srcUrl. Images are lightweight and never evicted. */
  private readonly imageFreePool = new Map<string, HTMLImageElement>();
  private readonly colorCache = new Map<string, [number, number, number]>();
  private readonly scratchCtx = document.createElement('canvas').getContext('2d')!;
  /** Assignment from NeededSource to element for the current frame. */
  private neededToEl = new Map<NeededSource, VideoEl | HTMLImageElement>();
  /** Reverse map: FrameEvent key ("si:ei") → NeededSource. Built each frame. */
  private feToNeeded = new Map<string, NeededSource>();
  /** Wall-clock time of last frame, for forward prediction in matchSources. */
  private lastFrameWall = performance.now();

  constructor(renderer: Renderer, pool: VideoPool, metrics: FrameMetrics) {
    this.renderer = renderer;
    this.pool = pool;
    this.metrics = metrics;
  }

  /**
   * Called from uzuEval after new screens are registered.
   * Pre-fetches blobs for all video sources visible in the screen.
   */
  prewarmBlobs(screen: Screen): void {
    const probe = screen.queryArc(0, 1);
    for (const h of probe) {
      const v = h.value;
      if (v?._type === 'video') {
        const base = v.urlBase ?? VIDEO_BASE;
        this.pool.fetchVideoBlob(this.pool.resolveMediaUrl(v.src, base));
      }
    }
  }

  /**
   * Render one full frame.
   * Phases: query needed sources → match elements → beginFrame → draw → endFrame → prewarm.
   */
  render(screens: Screen[], t: number, cps: number, cycle: number, frameWallTime?: number): void {
    const nowWall = frameWallTime ?? performance.now();
    const frameDt = Math.min((nowWall - this.lastFrameWall) / 1000, 0.1); // cap at 100ms
    this.lastFrameWall = nowWall;

    this.metrics.seeksThisFrame = 0;
    this.metrics.driftSeeksThisFrame = 0;

    // Phase 1: pattern query
    performance.mark('uzu-phase-start');
    const { needed, eventMap, allEvents } = queryNeeded(screens, t, cps, this.pool.videoDurations, this.pool.resolveMediaUrl);
    this.lastEventCount = allEvents.length;
    this._endPhase('uzu query', this.metrics.phaseQuery);

    // Phase 2: element assignment (pool matching)
    performance.mark('uzu-phase-start');
    this.assignElements(needed, eventMap, t, cps, frameDt);
    this._endPhase('uzu assign', this.metrics.phaseAssign);

    // Phase 3: draw (video frame rendering + GPU dispatch)
    performance.mark('uzu-phase-start');
    this.renderer.beginFrame();
    this.drawFrame(allEvents, t, cps, nowWall);
    this.renderer.endFrame();
    this._endPhase('uzu draw', this.metrics.phaseDraw);

    // Phase 4: prewarm (lookahead query + element prep)
    performance.mark('uzu-phase-start');
    if (cps > 0) this.prewarmSources(screens, cycle, cps);
    this._endPhase('uzu prewarm', this.metrics.phasePrewarm);
  }

  /** Measure from the last 'uzu-phase-start' mark, push duration to arr, clear entries. */
  private _endPhase(name: string, arr: number[]): void {
    performance.measure(name, 'uzu-phase-start');
    const entries = performance.getEntriesByName(name, 'measure');
    const last = entries[entries.length - 1];
    if (last) { arr.push(last.duration); if (arr.length > 300) arr.shift(); }
    performance.clearMarks('uzu-phase-start');
    performance.clearMeasures(name);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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

  /**
   * Phase 2: Build FreePool, run the matcher, wire up new elements, update active list.
   */
  private assignElements(
    needed: NeededSource[],
    eventMap: Map<NeededSource, FrameEvent[]>,
    _t: number,
    _cps: number,
    frameDt: number,
  ): void {
    const { pool } = this;

    // Build a unified FreePool for the matcher:
    //  - Previous frame's active elements (paused in place, state preserved)
    //  - pool.freeVideoPool elements
    //  - imageFreePool elements
    //
    // Active elements are added to a temporary map rather than pool.freeVideoPool to avoid
    // triggering the per-src cap (e.g. syncStack(4) would lose 2 elements if capped at 2).
    // After matching, unmatched active elements are properly freed through pool.freeVideoEl.

    // Step 1: group previous active elements by srcUrl.
    // Do NOT pause them yet — pausing is only done for elements that won't be reused
    // (via pool.freeVideoEl below). Pausing here would cause play→pause→play jitter for
    // native-rate elements (e.g. rolling at speed=1).
    const prevActiveMap = new Map<string, VideoEl[]>();
    for (const el of this.activeVideoEls) {
      const srcUrl = el._state.srcUrl ?? '';
      if (!srcUrl) { pool.freeVideoEl(el); continue; }
      const list = prevActiveMap.get(srcUrl) ?? [];
      list.push(el);
      prevActiveMap.set(srcUrl, list);
    }
    this.activeVideoEls.length = 0;

    // Step 2: build freePool where:
    //  - pool.freeVideoPool entries use the SAME array references (so splice inside
    //    matchSources automatically removes taken elements from the real pool)
    //  - prevActive elements are in SEPARATE arrays (not polluting pool.freeVideoPool)
    //  - active elements are prepended so they score first (already at correct time)
    const freePool: FreePool = new Map();
    for (const [k, v] of pool.freeVideoPool) freePool.set(k, v as Array<VideoEl | HTMLImageElement>);

    // Prepend active elements using new arrays (so pool.freeVideoPool is unaffected)
    for (const [k, v] of prevActiveMap) {
      const existing = freePool.get(k);
      if (existing) {
        // Create a new combined array with active elements at front, pool elements after
        freePool.set(k, [...(v as Array<VideoEl | HTMLImageElement>), ...existing]);
        // Also replace the pool.freeVideoPool entry with the original ref so we can
        // still detect which elements came from the pool vs active
      } else {
        freePool.set(k, v as Array<VideoEl | HTMLImageElement>);
      }
    }
    for (const [k, v] of this.imageFreePool) {
      if (!freePool.has(k)) freePool.set(k, [v]);
    }

    const assignments = matchSources(
      needed,
      freePool,
      pool.videoDurations,
      frameDt,
      (name: string) => pool.makeVideoEl(name),
    );

    // Step 3: sync pool.freeVideoPool.
    // For srcs that had active elements prepended, we created NEW arrays in freePool —
    // the original pool arrays are untouched. We need to remove any pool elements that
    // were taken by the matcher from pool.freeVideoPool.
    const assignedEls = new Set(assignments.map(a => a.el));
    for (const [srcUrl, poolList] of pool.freeVideoPool) {
      const remaining = (poolList as VideoEl[]).filter(el => !assignedEls.has(el));
      if (remaining.length === 0) pool.freeVideoPool.delete(srcUrl);
      else pool.freeVideoPool.set(srcUrl, remaining);
    }

    // Free unmatched previous active elements through the cap logic
    for (const [, els] of prevActiveMap) {
      for (const el of els) {
        if (!assignedEls.has(el)) pool.freeVideoEl(el);
      }
    }

    // Build new neededToEl / feToNeeded maps; activate new elements
    this.neededToEl = new Map();
    this.feToNeeded = new Map();

    let shareHits = 0;
    for (const a of assignments) {
      this.neededToEl.set(a.needed, a.el);

      // Build feToNeeded from eventMap
      const fes = eventMap.get(a.needed);
      if (fes) {
        for (const fe of fes) {
          const key = `${fe.screenIndex}:${fe.eventIndex}`;
          this.feToNeeded.set(key, a.needed);
        }
        if (fes.length > 1) shareHits += fes.length - 1;
      }

      if (a.needed.kind === 'video') {
        const el = a.el as VideoEl;
        this.activeVideoEls.push(el);

        if (a.isNew) {
          // New element from matchSources: set src and start playing
          const srcUrl = a.needed.srcUrl;
          el._state.srcUrl = srcUrl;
          const blobUrl = pool.getBlobUrl(srcUrl);
          el.src = blobUrl ?? srcUrl;
          if (!blobUrl) pool.fetchVideoBlob(srcUrl);
          el.play().catch((e: DOMException | Error) => {
            if ((e as DOMException).name !== 'AbortError') console.warn('video play failed:', e);
          });
        } else {
          // Reused element: update src if blob became available
          const srcUrl = a.needed.srcUrl;
          const blobUrl = pool.getBlobUrl(srcUrl);
          if (blobUrl && el.src !== blobUrl) el.src = blobUrl;
        }
      } else {
        // Image: update pool cache
        this.imageFreePool.set(a.needed.srcUrl, a.el as HTMLImageElement);
      }
    }
    this.metrics.shareHits = shareHits;

    // Sync image free pool: remove entries that freePool consumed (for images we
    // passed new arrays, so the original imageFreePool is unaffected — correct;
    // images are never "consumed" in the pool sense, they stay in imageFreePool)
  }

  /**
   * Resolve one pattern event into TileParams.
   * Returns null if the event should be skipped.
   */
  private buildTileParams(fe: FrameEvent, t: number, cps: number, frameWallTime: number, videoFrameProcessed?: Set<VideoEl>): TileParams | null {
    const { ev, hap, screenIndex, eventIndex } = fe;

    // Position. x/y = centre of tile in 0..1; default to canvas centre (0.5, 0.5).
    const pw = ev.width !== undefined ? Number(ev.width) : 1;
    const ph = ev.height !== undefined ? Number(ev.height) : 1;
    const px = ev.x !== undefined ? Number(ev.x) : 0.5;
    if (ev.x !== undefined) this.metrics.xLog.push(px);
    const py = ev.y !== undefined ? Number(ev.y) : 0.5;
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

    // Rotation
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

    // Source
    let source: TileSource;
    if (ev._type === 'color') {
      const [r, g, b] = this.parseColor(ev.color);
      source = { kind: 'color', r, g, b };
    } else if (ev._type === 'image') {
      const key = `${screenIndex}:${eventIndex}`;
      const ns = this.feToNeeded.get(key);
      const el = ns ? (this.neededToEl.get(ns) as HTMLImageElement | undefined) : undefined;
      if (!el || (el as HTMLImageElement).naturalWidth === 0) return null;
      source = { kind: 'image', el: el as HTMLImageElement };
    } else if (ev._type === 'video') {
      const key = `${screenIndex}:${eventIndex}`;
      const ns = this.feToNeeded.get(key);
      const el = ns ? (this.neededToEl.get(ns) as VideoEl | undefined) : undefined;
      if (!el) return null;
      const eventBegin = eventBeginFromHap(ev, hap, t);
      if (isFinite(el.duration) && el.duration > 0 && !videoFrameProcessed?.has(el)) {
        renderVideoFrame({ ev, el, currentCycle: t, eventBegin, cps, frameWallTime, onSeek: () => { this.metrics.seeksThisFrame++; }, onDriftSeek: () => { this.metrics.driftSeeksThisFrame++; } });
        videoFrameProcessed?.add(el);
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

  /** Phase 3: Build TileParams for each event in draw order and dispatch to the renderer. */
  private drawFrame(allEvents: FrameEvent[], t: number, cps: number, frameWallTime: number): void {
    // Track which elements have already had renderVideoFrame called this frame.
    // Multiple FrameEvents may share the same element (via deduplication in queryNeeded).
    // renderVideoFrame must only run once per element per frame — it is a stateful
    // playback-control function, not a pure query. Calling it multiple times per frame
    // confuses the effective-rate estimator (wallDt≈0 on repeated calls) and can
    // produce spurious drift seeks on shared rolling elements.
    const videoFrameProcessed = new Set<VideoEl>();
    for (const fe of allEvents) {
      let params: TileParams | null;
      try {
        params = this.buildTileParams(fe, t, cps, frameWallTime, videoFrameProcessed);
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

  /** Phase 4: Query ahead and warm up sources needed in the near future. */
  private prewarmSources(screens: Screen[], cycle: number, cps: number): void {
    const { pool } = this;
    const lookaheadCycles = (PREWARM_LOOKAHEAD_MS / 1000) * cps;
    const futureT = cycle + lookaheadCycles;

    const { needed: futureNeeded } = queryNeeded(screens, futureT, cps, pool.videoDurations, pool.resolveMediaUrl);

    // Group future needed by srcUrl so we know how many elements each src will require.
    // This matters for syncStack(N) which needs N elements of the same src simultaneously.
    const neededBySrc = new Map<string, NeededSource[]>();
    for (const ns of futureNeeded) {
      if (ns.kind !== 'video') continue;
      pool.fetchVideoBlob(ns.srcUrl);
      const list = neededBySrc.get(ns.srcUrl) ?? [];
      list.push(ns);
      neededBySrc.set(ns.srcUrl, list);
    }

    // Budget for new element creation this frame (shared across all sources).
    // Seeking already-loaded free elements is not budgeted — it's cheap.
    let newElementBudget = PREWARM_NEW_ELEMENTS_PER_FRAME;

    for (const [srcUrl, nsList] of neededBySrc) {
      // Count how many idle elements already exist for this src (active elements don't
      // need prewarm — they're already loaded and positioned).
      const activeCount = this.activeVideoEls.filter(el => el._state.srcUrl === srcUrl).length;
      const freeList = pool.freeVideoPool.get(srcUrl) ?? [];
      const available = activeCount + freeList.length;
      const deficit = nsList.length - available;

      // Seek existing free elements toward their expected positions
      for (let i = 0; i < freeList.length; i++) {
        const ns = nsList[i]; // best-effort: pair free elements with needed sources in order
        if (!ns || ns.expectedTime == null) continue;
        const el = freeList[i];
        const dur = isFinite(el.duration) ? el.duration : (pool.videoDurations.get(srcUrl) ?? 0);
        const score = dur > 0
          ? ((ns.expectedTime - el.currentTime) % dur + dur) % dur
          : Math.abs(el.currentTime - ns.expectedTime);
        if (!el._state.seeking && score > 0.15) el.currentTime = ns.expectedTime;
      }

      // Create new prewarm elements to cover the deficit, consuming the shared
      // per-frame budget to avoid decode hitches when many elements are needed at once.
      const toCreate = Math.min(deficit, newElementBudget);
      newElementBudget -= toCreate;
      for (let i = 0; i < toCreate; i++) {
        const ns = nsList[available + i];
        const el = pool.makeVideoEl(srcUrl);
        el._state.srcUrl = srcUrl;
        const blobUrl = pool.getBlobUrl(srcUrl);
        el.src = blobUrl ?? srcUrl;
        el.preload = 'auto';
        if (ns?.expectedTime != null) {
          const cachedDur = pool.videoDurations.get(srcUrl);
          if (cachedDur != null) {
            // Duration already known — seek immediately using the precise expected time
            el.currentTime = ns.expectedTime;
          } else {
            // Duration unknown — wait for metadata then compute the accurate position
            el.addEventListener('loadedmetadata', () => {
              const realExpected = computeExpectedFromEvent(ns.ev, futureT, eventBeginFromHap(ns.ev, ns.hap, futureT), cps, el.duration);
              if (realExpected != null) el.currentTime = realExpected;
            }, { once: true });
          }
        }
        pool.freeVideoEl(el);
      }
    }
  }
}
