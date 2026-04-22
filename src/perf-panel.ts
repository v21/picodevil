/** Performance information panel for the sidebar. */

export function setupPerfPanel(container: HTMLElement) {
  container.innerHTML = `
    <div class="perf-panel">
      <div class="perf-section">
        <div class="perf-head">frame time</div>
        <canvas id="perf-graph" style="width:100%;height:60px;display:block;margin-bottom:4px;"></canvas>
        <div class="perf-row"><span class="perf-label">fps</span><span class="perf-value" id="perf-fps">—</span></div>
        <div class="perf-row"><span class="perf-label">frame gap</span><span class="perf-value" id="perf-framegap-now">—</span></div>
        <div class="perf-row"><span class="perf-label">frame gap p50</span><span class="perf-value" id="perf-frametime">—</span></div>
        <div class="perf-row"><span class="perf-label">frame gap p95</span><span class="perf-value" id="perf-p95">—</span></div>
        <div class="perf-row"><span class="perf-label">frame gap worst</span><span class="perf-value" id="perf-worst">—</span></div>
        <div class="perf-row"><span class="perf-label">our work</span><span class="perf-value" id="perf-work-now">—</span></div>
        <div class="perf-row"><span class="perf-label">our work p50</span><span class="perf-value" id="perf-work">—</span></div>
      </div>
      <div class="perf-section">
        <div class="perf-head">js heap</div>
        <canvas id="perf-heap-graph" style="width:100%;height:48px;display:block;margin-bottom:4px;"></canvas>
        <div class="perf-row"><span class="perf-label">js heap used</span><span class="perf-value" id="perf-heap">—</span></div>
        <div class="perf-row"><span class="perf-label">js heap total</span><span class="perf-value" id="perf-heap-total">—</span></div>
      </div>
      <div class="perf-section">
        <div class="perf-head">video</div>
        <div class="perf-row"><span class="perf-label">playing</span><span class="perf-value" id="perf-playing">—</span></div>
        <div class="perf-row"><span class="perf-label">natural playback</span><span class="perf-value" id="perf-natural">—</span></div>
        <div class="perf-row"><span class="perf-label">seek mode</span><span class="perf-value" id="perf-seek">—</span></div>
        <div class="perf-row"><span class="perf-label">seeks/frame</span><span class="perf-value" id="perf-seeks-frame">—</span></div>
        <div class="perf-row"><span class="perf-label">seeks/300f</span><span class="perf-value" id="perf-seeks-300f">—</span></div>
        <div class="perf-row"><span class="perf-label">drift seeks/300f</span><span class="perf-value" id="perf-drift-seeks-300f">—</span></div>
        <div class="perf-row"><span class="perf-label">free pool</span><span class="perf-value" id="perf-free">—</span></div>
        <div class="perf-row"><span class="perf-label">blob cache</span><span class="perf-value" id="perf-blob-cache">—</span></div>
      </div>
      <div class="perf-section">
        <div class="perf-head">render</div>
        <div class="perf-row"><span class="perf-label">screens</span><span class="perf-value" id="perf-screens">—</span></div>
        <div class="perf-row"><span class="perf-label">events/frame</span><span class="perf-value" id="perf-events">—</span></div>
      </div>
    </div>
  `;

  const graphCanvas = container.querySelector("#perf-graph") as HTMLCanvasElement;
  const gctx = graphCanvas.getContext("2d")!;
  const heapCanvas = container.querySelector("#perf-heap-graph") as HTMLCanvasElement;
  const hctx = heapCanvas.getContext("2d")!;

  function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  function fmt(ms: number): string {
    return ms.toFixed(1) + " ms";
  }

  function fmtBytes(b: number): string {
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
    if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
    return b + " B";
  }

  function resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { W: number; H: number } {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.offsetWidth;
    const cssH = canvas.offsetHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.scale(dpr, dpr);
    }
    return { W: cssW, H: cssH };
  }

  // Target lines in ms — 60fps = 16.7ms, 30fps = 33.3ms
  const TARGET_60 = 1000 / 60;
  const TARGET_30 = 1000 / 30;

  /**
   * Frame time graph: bars = inter-frame gap (perceived FPS), dimmer overlay = JS work.
   * Color of bar reflects quality of the inter-frame gap.
   */
  function drawFrameGraph(interFrameTimes: number[], workTimes: number[]) {
    const { W, H } = resizeCanvas(graphCanvas, gctx);
    gctx.clearRect(0, 0, W, H);

    const MAX = 300;
    const padded = interFrameTimes.length < MAX
      ? new Array(MAX - interFrameTimes.length).fill(0).concat(interFrameTimes)
      : interFrameTimes;
    const paddedWork = workTimes.length < MAX
      ? new Array(MAX - workTimes.length).fill(0).concat(workTimes)
      : workTimes;
    const n = padded.length;

    // Fixed scale: 50ms max
    const maxMs = 50;

    function drawRefLine(ms: number, color: string, label: string) {
      const y = H - (ms / maxMs) * H;
      gctx.strokeStyle = color;
      gctx.lineWidth = 1;
      gctx.setLineDash([3, 3]);
      gctx.beginPath();
      gctx.moveTo(0, y);
      gctx.lineTo(W, y);
      gctx.stroke();
      gctx.setLineDash([]);
      gctx.fillStyle = color;
      gctx.font = "10px monospace";
      gctx.fillText(label, 2, y - 2);
    }
    drawRefLine(TARGET_60, "rgba(80,200,80,0.5)", "60fps");
    drawRefLine(TARGET_30, "rgba(200,160,40,0.5)", "30fps");

    const barW = Math.max(1, W / n);

    for (let i = 0; i < n; i++) {
      const gap = padded[i];
      const work = paddedWork[i] ?? 0;
      const x = i * (W / n);

      // Inter-frame bar (full perceived time)
      const barH = Math.min(H, (gap / maxMs) * H);
      const y = H - barH;
      if (gap <= TARGET_60) {
        gctx.fillStyle = "rgba(80,200,80,0.7)";
      } else if (gap <= TARGET_30) {
        gctx.fillStyle = "rgba(220,160,40,0.8)";
      } else {
        gctx.fillStyle = "rgba(220,60,60,0.9)";
      }
      gctx.fillRect(x, y, Math.max(barW - 0.5, 0.5), barH);

      // JS work overlay (dimmer, drawn on top within the same bar)
      const workH = Math.min(H, (work / maxMs) * H);
      const workY = H - workH;
      gctx.fillStyle = "rgba(255,255,255,0.25)";
      gctx.fillRect(x, workY, Math.max(barW - 0.5, 0.5), workH);
    }
  }

  /**
   * Heap graph: line chart of usedJSHeapSize over the same time window.
   * GC runs appear as sudden downward drops.
   */
  function drawHeapGraph(heapSamples: number[]) {
    const { W, H } = resizeCanvas(heapCanvas, hctx);
    hctx.clearRect(0, 0, W, H);

    const MAX = 300;
    const padded = heapSamples.length < MAX
      ? new Array(MAX - heapSamples.length).fill(0).concat(heapSamples)
      : heapSamples;
    const n = padded.length;
    if (n < 2) return;

    // Scale: 0 to max observed (with a small padding)
    let maxHeap = 0;
    for (const v of padded) if (v > maxHeap) maxHeap = v;
    if (maxHeap === 0) return;
    const scale = maxHeap * 1.05; // 5% headroom

    // Fill under the line
    hctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H - (padded[i] / scale) * H;
      if (i === 0) hctx.moveTo(x, y);
      else hctx.lineTo(x, y);
    }
    hctx.lineTo(W, H);
    hctx.lineTo(0, H);
    hctx.closePath();
    hctx.fillStyle = "rgba(100,180,255,0.18)";
    hctx.fill();

    // Line
    hctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H - (padded[i] / scale) * H;
      if (i === 0) hctx.moveTo(x, y);
      else hctx.lineTo(x, y);
    }
    hctx.strokeStyle = "rgba(100,180,255,0.85)";
    hctx.lineWidth = 1.5;
    hctx.stroke();

    // Max label
    hctx.fillStyle = "rgba(100,180,255,0.6)";
    hctx.font = "10px monospace";
    hctx.fillText(fmtBytes(maxHeap), 2, 11);
  }

  function update() {
    const m = (window as any).uzuMetrics;
    const info = (window as any).uzuPerfInfo?.();

    if (m) {
      const interTimes = m.interFrameTimes as number[];
      const workTimes = m.frameTimes as number[];
      drawFrameGraph(interTimes, workTimes);
      drawHeapGraph(m.heapSamples as number[]);

      if (interTimes.length > 0) {
        const latestGap = interTimes[interTimes.length - 1];
        const medianGap = percentile(interTimes, 0.5);
        const p95Gap = percentile(interTimes, 0.95);
        const fps = latestGap > 0 ? 1000 / latestGap : 0;
        (container.querySelector("#perf-framegap-now") as HTMLElement).textContent = fmt(latestGap);
        (container.querySelector("#perf-fps") as HTMLElement).textContent = fps.toFixed(1);
        (container.querySelector("#perf-frametime") as HTMLElement).textContent = fmt(medianGap);
        (container.querySelector("#perf-p95") as HTMLElement).textContent = fmt(p95Gap);
        (container.querySelector("#perf-worst") as HTMLElement).textContent = fmt(m.maxInterFrameTime);
      }
      if (workTimes.length > 0) {
        const latestWork = workTimes[workTimes.length - 1];
        const medianWork = percentile(workTimes, 0.5);
        (container.querySelector("#perf-work-now") as HTMLElement).textContent = fmt(latestWork);
        (container.querySelector("#perf-work") as HTMLElement).textContent = fmt(medianWork);
      }

      (container.querySelector("#perf-playing") as HTMLElement).textContent = String(m.poolSize);
      (container.querySelector("#perf-free") as HTMLElement).textContent = String(m.freePoolSize);

      // Memory text
      const perfMem = (performance as any).memory;
      if (perfMem) {
        (container.querySelector("#perf-heap") as HTMLElement).textContent = fmtBytes(perfMem.usedJSHeapSize);
        (container.querySelector("#perf-heap-total") as HTMLElement).textContent = fmtBytes(perfMem.totalJSHeapSize);
      } else {
        (container.querySelector("#perf-heap") as HTMLElement).textContent = "n/a";
        (container.querySelector("#perf-heap-total") as HTMLElement).textContent = "n/a";
      }
    }

    if (info) {
      (container.querySelector("#perf-natural") as HTMLElement).textContent = String(info.naturalCount);
      (container.querySelector("#perf-seek") as HTMLElement).textContent = String(info.seekCount);
      (container.querySelector("#perf-seeks-frame") as HTMLElement).textContent = String(info.seeksThisFrame);
      (container.querySelector("#perf-seeks-300f") as HTMLElement).textContent = String(info.seeksPer300f);
      (container.querySelector("#perf-drift-seeks-300f") as HTMLElement).textContent = String(info.driftSeeksPer300f);
      (container.querySelector("#perf-blob-cache") as HTMLElement).textContent =
        info.blobCacheCount > 0 ? `${fmtBytes(info.blobCacheBytes)} (${info.blobCacheCount})` : "0";
      (container.querySelector("#perf-screens") as HTMLElement).textContent = String(info.screensCount);
      (container.querySelector("#perf-events") as HTMLElement).textContent = String(info.eventsPerFrame);
    }
  }

  // Run at rAF rate while visible so the graph animates smoothly
  let visible = false;
  let rafId: number | null = null;

  function loop() {
    if (!visible) { rafId = null; return; }
    update();
    rafId = requestAnimationFrame(loop);
  }

  const observer = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible && rafId === null) {
      rafId = requestAnimationFrame(loop);
    }
  });
  observer.observe(container);
}
