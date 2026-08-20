import {
  getAllEntries, addMedia, removeMedia, renameMedia, updateUrl, updateEntry,
  isYouTubeUrl, downloadYouTube, exportAll, importAll, clearAll, setOnChange,
  uploadToServer, addFromServer, missingFromServer, guessTypeFromFile, moveMediaBefore,
  type MediaEntry, type SourceItem,
} from "./media-registry";
import { getServerUrl, getServerStatus, subscribe as subscribeServer } from "./server-config";
import { createServerSettingsButton } from "./server-settings-ui";
import {
  startWebcam, startScreenCapture, stopStream, removeStream,
  isStreamActive, setStreamOnChange, reconnectStreams,
} from "./stream-manager";
import { makeThumbCell, cellKey, insertName } from "./thumbs";

let container: HTMLElement;

// The videos tab has two modes over the same media: "edit" (the row list, with
// rename/url/delete) and "view" (a read-only grid of thumbnails, click to insert
// a name). Persisted separately from, but in the same spirit as, the sidebar
// state. Defaults to "view".
const VIEW_MODE_KEY = "picodevil-videos-view";
type ViewMode = "edit" | "view";
let viewMode: ViewMode = localStorage.getItem(VIEW_MODE_KEY) === "edit" ? "edit" : "view";

// Persisted scroll offset of the grid ("view") pane — restored across mode
// toggles and reloads. `restoreGridScroll` gates a one-shot restore on the next
// view render so ordinary re-renders (progress ticks, etc.) don't fight the user.
const GRID_SCROLL_KEY = "picodevil-videos-scroll";
let gridScroll = Number(localStorage.getItem(GRID_SCROLL_KEY)) || 0;
let restoreGridScroll = true;
let gridScrollTimer: ReturnType<typeof setTimeout> | undefined;

function saveGridScroll() {
  clearTimeout(gridScrollTimer);
  gridScrollTimer = setTimeout(() => {
    try { localStorage.setItem(GRID_SCROLL_KEY, String(Math.round(gridScroll))); } catch { /* storage disabled */ }
  }, 200);
}

// The view⇄edit "thumbs fly" animation. Flip FLIP_MODE_SWITCH to false to kill it.
const FLIP_MODE_SWITCH = true;
const FLIP_MS = 300;
let flipping = false;
let flipToken = 0; // bumped per flip so a superseded flip's cleanup can bow out

function flipEnabled(): boolean {
  return FLIP_MODE_SWITCH && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setViewMode(mode: ViewMode) {
  if (mode === viewMode) return;
  flipping = false; // let a re-toggle mid-animation swap the panes
  const first = flipEnabled() ? measureFlipRects() : null; // outgoing thumbnail positions
  // Going list → thumbs, fade the outgoing list text out (rather than snapping to
  // transparent when the pane is hidden). The grid has no separate text chrome
  // (the label rides the flying cell), so only this direction needs it.
  if (first && mode === "view") {
    const list = container.querySelector<HTMLElement>("[data-list]");
    if (list) fadeOutPane(list);
  }
  viewMode = mode;
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* storage disabled */ }
  if (mode === "view") restoreGridScroll = true; // re-restore where they left off
  render(); // swaps the panes
  if (first?.size) playFlip(first);
}

/** Snapshot a pane as a fixed-position clone over its current spot and fade it
 *  out — so its text eases away instead of vanishing when the real pane is
 *  hidden. Thumbnails are hidden on the clone (the real flying/incoming ones
 *  cover that area). Cleans up on transitionend, with a fallback. */
function fadeOutPane(pane: HTMLElement) {
  const rect = pane.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const clone = pane.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-list");
  clone.removeAttribute("data-grid");
  clone.classList.add("pd-fade-out-clone");
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.querySelectorAll<HTMLElement>(".vid-thumb, .thumb-cell > img").forEach(t => { t.style.visibility = "hidden"; });
  // cloneNode copies input attributes, not live values — mirror name/url over.
  const src = pane.querySelectorAll("input");
  const dst = clone.querySelectorAll("input");
  src.forEach((inp, i) => { if (dst[i]) dst[i].value = inp.value; });
  document.body.appendChild(clone);
  clone.scrollTop = pane.scrollTop; // align rows with the original
  requestAnimationFrame(() => { clone.style.opacity = "0"; });
  const remove = () => clone.remove();
  clone.addEventListener("transitionend", remove);
  setTimeout(remove, 4000);
}

/** Screen rects of every laid-out thumbnail (grid cell / row thumb), keyed by
 *  flip-key. Only the visible pane has non-zero rects, so this captures it. */
function measureFlipRects(): Map<string, DOMRect> {
  const m = new Map<string, DOMRect>();
  container.querySelectorAll<HTMLElement>("[data-flip-key]").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width && r.height) m.set(el.dataset.flipKey!, r);
  });
  return m;
}

/** FLIP: fly each incoming thumbnail from where its counterpart sat in the old
 *  pane to its new spot, scaling between the grid (120×90) and row (40×30). */
function playFlip(first: Map<string, DOMRect>) {
  const pane = container.querySelector<HTMLElement>(viewMode === "view" ? "[data-grid]" : "[data-list]");
  const view = pane?.getBoundingClientRect();
  const hit = (a: DOMRect, b: DOMRect) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const anims: HTMLElement[] = [];
  container.querySelectorAll<HTMLElement>("[data-flip-key]").forEach(el => {
    const f = first.get(el.dataset.flipKey!);
    if (!f) return;
    const l = el.getBoundingClientRect();
    if (!l.width || !l.height) return;                   // the now-hidden old pane
    if (view && !hit(f, view) && !hit(l, view)) return;  // both off-screen — skip
    const dx = f.left - l.left, dy = f.top - l.top;
    const sx = f.width / l.width, sy = f.height / l.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) return;
    el.style.transition = "none";
    el.style.transformOrigin = "top left";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    anims.push(el);
  });
  if (!anims.length) return;
  flipping = true; // pause render() so a playback save() can't reconcile mid-flight
  pane?.classList.add("pd-chrome-in"); // fade the incoming pane's text/labels in
  const token = ++flipToken;

  // Release on the NEXT frame, not after a layout read: a composited transform
  // isn't committed by reading offsetWidth, so inverting-then-clearing in the same
  // frame coalesces into a no-op and the motion collapses to a jump. rAF lets the
  // browser paint the inverted (First) state once, then animate it to identity.
  requestAnimationFrame(() => {
    for (const el of anims) {
      el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`;
      el.style.transform = "";
    }
  });

  // Clean up when the motion actually finishes (transitionend), not on a fixed
  // timer — so cleanup can never clear a still-running transform and snap it,
  // whatever the playback speed (e.g. slow-mo in the Animations inspector). The
  // fallback only covers a genuinely missed transitionend.
  const done = () => {
    clearTimeout(fallback);
    anims[0].removeEventListener("transitionend", done);
    if (token !== flipToken) return; // superseded by a newer toggle — leave it be
    for (const el of anims) { el.style.transition = ""; el.style.transformOrigin = ""; el.style.transform = ""; }
    pane?.classList.remove("pd-chrome-in");
    flipping = false;
    render(); // catch up on anything deferred during the flight
  };
  anims[0].addEventListener("transitionend", done);
  const fallback = setTimeout(done, 4000);
}

// Toggle icons (inline SVG so nothing is fetched at runtime; stroke inherits the
// button's currentColor). Feather/Lucide "grid" and "edit-3", 24×24 stroke paths.
const ICON_GRID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>';
const ICON_EDIT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

/** Curated starter media, hosted on the static CDN (sources.json import/export shape). */
const DEFAULTS_URL = "https://videoclip.picodevil.com/sources.json";
/** The fetched defaults list, or null until the one-shot fetch resolves (or fails). */
let defaultSources: SourceItem[] | null = null;

/**
 * Whether to auto-populate the registry with the CDN defaults once they're
 * fetched. True only on a genuinely fresh session (no saved URL state) that
 * hasn't loaded anything yet. A returning user who deliberately cleared their
 * media still carries a URL hash, so their session is *not* fresh and we leave
 * it untouched.
 */
export function shouldAutoloadDefaults(isFreshSession: boolean, entryCount: number): boolean {
  return isFreshSession && entryCount === 0;
}

export function setupMediaLoader(el: HTMLElement, isFreshSession = false) {
  container = el;
  setOnChange(render);
  setStreamOnChange(render);
  // Re-render when the server connection status changes so the "Load all"
  // footer button appears/disappears in step with the connection.
  subscribeServer(render);
  render();

  // Fetch the defaults bundle once. On a fresh session we pull it in
  // automatically so a first-time visitor lands with media ready (same effect
  // as clicking "Defaults", which then self-hides). For a returning user it
  // just enables the "Defaults" button, shown only when it contains media not
  // already in the list — so a failed/blocked fetch loads nothing and the
  // button stays hidden.
  fetch(DEFAULTS_URL)
    .then(res => res.ok ? res.json() : null)
    .then(items => {
      if (!Array.isArray(items)) return;
      defaultSources = items;
      if (shouldAutoloadDefaults(isFreshSession, getAllEntries().length)) {
        addFromServer(defaultSources);
      }
      render();
    })
    .catch(() => {/* offline or CORS-blocked — nothing loaded, button stays hidden */});

  // Reconnect persisted webcam streams (screen captures need manual reconnect)
  reconnectStreams().then(render);

  // Paste JSON to import
  el.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (!text || !text.startsWith("[")) return;
    try {
      importAll(text);
      showToast("Imported from paste");
      e.preventDefault();
    } catch {
      // Text started with "[" so it was clearly an import attempt — surface the
      // parse failure instead of swallowing it.
      showToast("Import failed: invalid JSON");
    }
  });

  // Drag & drop files or URLs
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.style.outline = "2px solid #666";
  });
  el.addEventListener("dragleave", () => {
    el.style.outline = "";
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.style.outline = "";
    // Try files first
    if (e.dataTransfer?.files.length) {
      for (const file of Array.from(e.dataTransfer.files)) {
        const blobUrl = URL.createObjectURL(file);
        const name = file.name.replace(/\.[^.]+$/, "");
        // A blob: URL has no extension, so classify from the File's MIME/name
        // up front — otherwise the entry defaults to "image" and s("name")
        // would try to render a video as a still image.
        const entry = addMedia(blobUrl, name, guessTypeFromFile(file));
        if (getServerUrl() && getServerStatus() !== "error") {
          uploadToServer(entry.name, file).catch((err) => {
            // Most failures are stored on the entry (row shows an error + retry);
            // surface the oversize case as a toast too, since it's a user action.
            if (/too large/i.test(err?.message ?? "")) showToast(err.message);
          });
        }
      }
      return;
    }
    // Try text (URL or JSON)
    const text = e.dataTransfer?.getData("text/plain")?.trim();
    if (!text) return;
    if (text.startsWith("[")) {
      try { importAll(text); showToast("Imported from drop"); return; }
      catch { showToast("Import failed: invalid JSON"); return; }
    }
    if (text.startsWith("http")) {
      addMedia(text);
      if (isYouTubeUrl(text)) {
        const entries = getAllEntries();
        downloadYouTube(entries[entries.length - 1].name);
      }
    }
  });
}

function render() {
  // Don't reflow the panes mid-drag or mid-flip: a save() from playback (durations
  // loading, thumbnails finishing, progress ticks) would otherwise reconcile an
  // animating element (snapping it to its final spot) and break the motion. Both
  // finishDrag() and the flip's cleanup re-render once the animation ends.
  if (drag?.active || flipping) return;

  // First render: build the persistent structure (add bar + both view panes).
  // These are never torn down so scroll positions and the add bar's input value
  // survive subsequent renders; only the active pane is shown.
  if (!container.querySelector("[data-add-bar]")) {
    container.appendChild(makeAddBar());
  }
  if (!container.querySelector("[data-list]")) {
    const list = document.createElement("div");
    list.dataset.list = "1";
    list.className = "vid-list";
    container.appendChild(list);
  }
  if (!container.querySelector("[data-grid]")) {
    const grid = document.createElement("div");
    grid.dataset.grid = "1";
    grid.className = "thumbs-grid";
    // Persist scroll as the user scrolls (skip the programmatic restore below,
    // which would otherwise re-save a possibly-clamped value).
    grid.addEventListener("scroll", () => {
      if (restoreGridScroll) return;
      gridScroll = grid.scrollTop;
      saveGridScroll();
    }, { passive: true });
    container.appendChild(grid);
  }

  const list = container.querySelector<HTMLElement>("[data-list]")!;
  const grid = container.querySelector<HTMLElement>("[data-grid]")!;
  const editing = viewMode === "edit";
  list.style.display = editing ? "" : "none";
  grid.style.display = editing ? "none" : "";

  // Reconcile only the visible pane in place — no scroll position lost. The
  // hidden pane is left stale and refreshed the next time it's shown.
  const entries = getAllEntries();
  if (editing) {
    reconcileList(list, entries);
  } else {
    reconcileGrid(grid, entries);
    // One-shot restore of the persisted scroll, once entries exist (rows are
    // fixed-height, so the grid's full height is known as soon as they're added).
    if (restoreGridScroll && entries.length > 0) {
      grid.scrollTop = gridScroll;
      restoreGridScroll = false;
    }
  }

  // Footer has conditional buttons (Defaults, Load all, server status) and lives
  // outside the scrollable area, so it's cheap and safe to rebuild each time.
  const oldFooter = container.querySelector<HTMLElement>("[data-footer]");
  const newFooter = makeFooter();
  newFooter.dataset.footer = "1";
  if (oldFooter) {
    container.replaceChild(newFooter, oldFooter);
  } else {
    container.appendChild(newFooter);
  }
}

function makeAddBar(): HTMLElement {
  const addBar = document.createElement("div");
  addBar.dataset.addBar = "1";
  addBar.className = "add-bar";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "paste URL to add...";
  input.className = "pd-input";

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add";
  addBtn.className = "pd-btn";
  addBtn.addEventListener("click", () => {
    const url = input.value.trim();
    if (!url) return;
    const entry = addMedia(url);
    input.value = "";
    if (isYouTubeUrl(url)) downloadYouTube(entry.name);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addBtn.click();
  });

  const camBtn = document.createElement("button");
  camBtn.textContent = "Webcam";
  camBtn.className = "pd-btn";
  camBtn.addEventListener("click", async () => {
    try {
      await startWebcam();
      render();
    } catch (e: any) {
      showToast(e.message ?? "Webcam failed");
    }
  });

  const screenBtn = document.createElement("button");
  screenBtn.textContent = "Screen";
  screenBtn.className = "pd-btn";
  screenBtn.addEventListener("click", async () => {
    try {
      await startScreenCapture();
      render();
    } catch (e: any) {
      showToast(e.message ?? "Screen capture failed");
    }
  });

  addBar.appendChild(input);
  addBar.appendChild(addBtn);
  addBar.appendChild(camBtn);
  addBar.appendChild(screenBtn);
  return addBar;
}

function makeFooter(): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "vid-footer";

  const leftGroup = document.createElement("div");
  leftGroup.className = "vid-footer-left";
  footer.appendChild(leftGroup);

  const rightGroup = document.createElement("div");
  rightGroup.className = "vid-footer-right";
  footer.appendChild(rightGroup);

  // Mode toggle — icon shows the mode you'd switch *to* (grid vs edit).
  const goEdit = viewMode === "view";
  const toggle = makeFooterBtn("", () => setViewMode(goEdit ? "edit" : "view"));
  toggle.classList.add("vid-view-toggle");
  toggle.innerHTML = goEdit ? ICON_EDIT : ICON_GRID;
  toggle.title = goEdit ? "Switch to edit view" : "Switch to grid view";
  toggle.setAttribute("aria-label", toggle.title);
  leftGroup.appendChild(toggle);

  leftGroup.appendChild(makeFooterBtn("Export", () => {
    navigator.clipboard.writeText(exportAll()).then(
      () => showToast("Copied to clipboard"),
      () => showToast("Copy failed"),
    );
  }));

  leftGroup.appendChild(makeFooterBtn("Import", () => {
    navigator.clipboard.readText().then((text) => {
      try {
        importAll(text);
        showToast("Imported");
      } catch {
        showToast("Invalid JSON");
      }
    }).catch(() => showToast("Clipboard access denied"));
  }));

  const clearBtn = makeFooterBtn("Clear", () => {
    clearBtn.textContent = "Confirm?";
    clearBtn.style.color = "#f88";
    const timeout = setTimeout(() => {
      clearBtn.textContent = "Clear";
      clearBtn.style.color = ""; // back to the class colour (+ restores :hover)
    }, 2000);
    clearBtn.addEventListener("click", () => {
      clearTimeout(timeout);
      clearAll();
    }, { once: true });
  });
  leftGroup.appendChild(clearBtn);

  // "Defaults" (left group) — only when the fetched defaults contain media not
  // already loaded. Disappears once everything's been pulled in.
  const missingDefaults = defaultSources ? missingFromServer(defaultSources) : [];
  if (missingDefaults.length > 0) {
    leftGroup.appendChild(makeFooterBtn("Defaults", () => {
      const added = addFromServer(missingDefaults);
      showToast(`Added ${added} default${added === 1 ? "" : "s"}`);
    }));
  }

  // "Load all" (right group) — only when we have a live connection. Pulls
  // everything the server can currently serve via GET /list.
  if (getServerUrl() && getServerStatus() === "ok") {
    const addServerBtn = makeFooterBtn("Load all", async () => {
      const base = getServerUrl();
      if (!base) return;
      addServerBtn.disabled = true;
      try {
        const res = await fetch(new URL("/list", base).href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = await res.json() as SourceItem[];
        const added = addFromServer(items);
        showToast(added > 0 ? `Added ${added} from server` : "Already up to date");
      } catch {
        showToast("Couldn't reach server");
      } finally {
        addServerBtn.disabled = false;
      }
    });
    rightGroup.appendChild(addServerBtn);
  }

  // Server status / configuration (right group)
  const { el: serverBtn } = createServerSettingsButton();
  rightGroup.appendChild(serverBtn);

  return footer;
}

/** Stable key representing the *structural* fields of an entry — if unchanged,
 *  the row DOM node is reused as-is. Progress percentages (`uploadProgress`,
 *  `phasePercent`) and `phase` are deliberately excluded: a transcode/download
 *  tick shouldn't rebuild the row, because that tears out the name/url input the
 *  user may be typing in. Those are refreshed in place by `updateRowProgress`. */
export function entryRenderKey(entry: MediaEntry): string {
  return [
    entry.url,
    entry.type ?? "",
    entry.thumbnail ?? "",
    String(!!entry.downloading),
    String(!!entry.uploading),
    entry.error ?? "",
    String(!!entry.unavailable),
    entry.streamKind ?? "",
    entry.deviceId ?? "",
    String(entry.type === "stream" ? isStreamActive(entry.name) : false),
  ].join("\0");
}

/** Indicator text for an in-progress upload or download, or null when the entry
 *  isn't uploading/downloading. Single source of truth for the edit-row indicator
 *  (`text`) and the compact grid-cell badge (`short`). */
function progressText(entry: MediaEntry): { text: string; short: string; title: string; small: boolean } | null {
  if (entry.uploading) {
    const pct = entry.uploadProgress != null ? Math.round(entry.uploadProgress * 100) : null;
    return pct != null && pct < 100
      ? { text: `↑${pct}%`, short: `↑${pct}%`, title: "Uploading…", small: false }
      : { text: "⚙", short: "⚙", title: "Transcoding…", small: false };
  }
  if (entry.downloading) {
    // Two-phase YouTube progress: "downloading: 45%" then "transcoding: 13%".
    // Falls back to ⏳ before the first /ready poll reports a phase.
    if (entry.phase && entry.phasePercent != null) {
      const label = entry.phase === "transcode" ? "transcoding" : "downloading";
      const pct = Math.round(entry.phasePercent * 100);
      const glyph = entry.phase === "transcode" ? "⚙" : "⬇";
      return { text: `${label}: ${pct}%`, short: `${glyph}${pct}%`, title: `${label} in progress`, small: false };
    }
    return { text: "⏳", short: "⏳", title: "", small: true };
  }
  return null;
}

/** Refresh just the progress indicator's text/title in place, without rebuilding
 *  the row — so typing in the row's inputs isn't interrupted by progress ticks. */
function updateRowProgress(row: HTMLElement, entry: MediaEntry) {
  const indicator = row.querySelector<HTMLElement>(".vid-indicator");
  const p = progressText(entry);
  if (!indicator || !p) return;
  if (indicator.textContent !== p.text) indicator.textContent = p.text;
  indicator.title = p.title;
}

/** Show/refresh (or remove) the compact progress badge in a grid cell's
 *  bottom-right corner. Managed here rather than in makeThumbCell so the cell
 *  isn't rebuilt each progress tick (which would reload its <img>). */
function updateCellProgress(cell: HTMLElement, entry: MediaEntry) {
  const p = progressText(entry);
  let badge = cell.querySelector<HTMLElement>(".thumb-progress");
  if (!p) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "thumb-progress";
    // Into the flex bottom bar so the label shrinks to make room (no overlap).
    (cell.querySelector(".thumb-bar") ?? cell).appendChild(badge);
  }
  if (badge.textContent !== p.short) badge.textContent = p.short;
  badge.title = p.title;
}

function reconcileList(list: HTMLElement, entries: MediaEntry[]) {
  // Index existing rows by entry name.
  const byName = new Map<string, HTMLElement>();
  for (const child of Array.from(list.children) as HTMLElement[]) {
    const name = child.dataset.entryName;
    if (name) byName.set(name, child);
  }

  const seen = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    seen.add(entry.name);
    const key = entryRenderKey(entry);
    let row = byName.get(entry.name);

    if (row) {
      // Replace row only when something visual changed.
      if (row.dataset.entryKey !== key) {
        const newRow = makeRow(entry);
        newRow.dataset.entryName = entry.name;
        newRow.dataset.entryKey = key;
        list.replaceChild(newRow, row);
        row = newRow;
        byName.set(entry.name, row);
      }
    } else {
      row = makeRow(entry);
      row.dataset.entryName = entry.name;
      row.dataset.entryKey = key;
      byName.set(entry.name, row);
    }

    // Refresh progress text in place (row was reused, key excludes percentages).
    updateRowProgress(row, entry);

    // Ensure the row sits at position i without moving it unnecessarily.
    const atI = list.children[i] as HTMLElement | undefined;
    if (atI !== row) {
      list.insertBefore(row, atI ?? null);
    }
  }

  // Remove rows for entries that no longer exist.
  for (const [name, el] of byName) {
    if (!seen.has(name)) el.remove();
  }

  // Empty-state placeholder.
  const emptyEl = list.querySelector<HTMLElement>("[data-empty]");
  if (entries.length === 0 && !emptyEl) {
    const empty = document.createElement("p");
    empty.dataset.empty = "1";
    empty.textContent = "No media added yet";
    empty.className = "vid-empty";
    list.prepend(empty);
  } else if (entries.length > 0 && emptyEl) {
    emptyEl.remove();
  }
}

/** Reconcile the "view"-mode thumbnail grid in place — mirror of reconcileList,
 *  keyed by entry id, reusing cells whose cellKey is unchanged (no img reload). */
export function reconcileGrid(grid: HTMLElement, entries: MediaEntry[]) {
  const byId = new Map<string, HTMLElement>();
  for (const child of Array.from(grid.children) as HTMLElement[]) {
    if (child.dataset.entryId) byId.set(child.dataset.entryId, child);
  }

  const seen = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    seen.add(entry.id);
    const key = cellKey(entry);
    let cell = byId.get(entry.id);

    if (!cell || cell.dataset.cellKey !== key) {
      const newCell = makeThumbCell(entry, insertName);
      newCell.dataset.entryId = entry.id;
      newCell.dataset.cellKey = key;
      // Drag the cell to reorder (shared registry order → the list reorders too).
      attachReorder(newCell, newCell, entry, "x");
      if (cell) grid.replaceChild(newCell, cell);
      cell = newCell;
      byId.set(entry.id, cell);
    }

    // Progress badge (bottom-right) refreshed in place — cellKey excludes
    // progress, so the cell (and its <img>) isn't rebuilt each tick.
    updateCellProgress(cell, entry);

    const atI = grid.children[i] as HTMLElement | undefined;
    if (atI !== cell) grid.insertBefore(cell, atI ?? null);
  }

  for (const [id, el] of byId) {
    if (!seen.has(id)) el.remove();
  }

  // Empty-state placeholder (spans the whole grid width).
  const emptyEl = grid.querySelector<HTMLElement>("[data-empty]");
  if (entries.length === 0 && !emptyEl) {
    const empty = document.createElement("p");
    empty.dataset.empty = "1";
    empty.textContent = "No media added yet";
    empty.className = "vid-empty";
    empty.style.gridColumn = "1 / -1";
    grid.appendChild(empty);
  } else if (entries.length > 0 && emptyEl) {
    emptyEl.remove();
  }
}

// --- Drag to reorder (Pointer Events → mouse, touch, and pen alike), with a
// live preview: the dragged element is moved among its siblings as you drag, so
// you see where it lands. The registry isn't touched until release, when
// moveMediaBefore commits the previewed order (so both panes + the URL update);
// a cancelled drag is restored by the final render().
//
// Touch: a short press-and-hold lifts the item (so ordinary finger-scrolling of
// the list still works — moving before the hold aborts to a scroll), and page
// scroll is suppressed only while a drag is actually active. ---
const DRAG_THRESHOLD = 6;   // px of movement to start a mouse drag / abort a touch hold
const TOUCH_HOLD_MS = 220;  // press-and-hold before a touch drag lifts

type DragState = {
  name: string; el: HTMLElement; pane: HTMLElement; axis: "x" | "y";
  pointerId: number; startX: number; startY: number;
  isTouch: boolean; active: boolean; holdTimer?: ReturnType<typeof setTimeout>;
  offsetX: number; offsetY: number; clone?: HTMLElement;
};
let drag: DragState | null = null;

function preventTouchScroll(e: TouchEvent) { if (drag?.active) e.preventDefault(); }

/** Position the floating clone so the same point stays under the cursor. */
function moveClone(x: number, y: number) {
  if (!drag?.clone) return;
  drag.clone.style.left = `${x - drag.offsetX}px`;
  drag.clone.style.top = `${y - drag.offsetY}px`;
}

function beginActive() {
  if (!drag || drag.active) return;
  clearTimeout(drag.holdTimer);
  drag.active = true;
  // The real element becomes an empty placeholder (holding the slot); a fixed-
  // position clone rides the cursor. Only the placeholder moves in flow, so
  // there's no reflow-vs-hit-test churn.
  const rect = drag.el.getBoundingClientRect();
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  const clone = drag.el.cloneNode(true) as HTMLElement;
  clone.classList.add("drag-clone");
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  // cloneNode copies input *attributes*, not live values (name/url are set as
  // properties), so mirror them over — otherwise the row clone shows blank fields.
  const src = drag.el.querySelectorAll("input");
  const dst = clone.querySelectorAll("input");
  src.forEach((inp, i) => { if (dst[i]) dst[i].value = inp.value; });
  document.body.appendChild(clone);
  drag.clone = clone;
  moveClone(drag.startX, drag.startY);
  drag.el.classList.add("drag-placeholder");
  document.addEventListener("touchmove", preventTouchScroll, { passive: false });
}

/** Slot the dragged element before/after whichever item is under the pointer. */
function previewAt(x: number, y: number) {
  if (!drag) return;
  const under = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = under?.closest<HTMLElement>(drag.axis === "x" ? ".thumb-cell" : ".vid-row");
  // Only react when over an actual item. Over a gap/empty area elementFromPoint
  // returns the pane (target null) → do nothing, rather than flinging it to the
  // end. The end is still reachable by hovering the last item (it's "after" the
  // dragged one, so the direction rule appends).
  if (!target || target === drag.el || target.parentElement !== drag.pane) return;
  // Just hovering an item moves the dragged one to that slot; the side is set by
  // direction (is the target currently after or before the dragged element), not
  // the target's midpoint — so there's no dead half. After the move the dragged
  // element sits under the cursor, so the early-return above stops it oscillating.
  const after = !!(drag.el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  const ref = after ? target.nextElementSibling : target;
  if (ref !== drag.el && drag.el.nextElementSibling !== ref) drag.pane.insertBefore(drag.el, ref);
}

function onPointerMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved <= DRAG_THRESHOLD) return;
    if (drag.isTouch) { finishDrag(false); return; } // moved before the hold → let it scroll
    beginActive();
  }
  moveClone(e.clientX, e.clientY);
  previewAt(e.clientX, e.clientY);
}

function onPointerUp(e: PointerEvent) {
  if (drag && e.pointerId === drag.pointerId) finishDrag(true);
}
function onPointerCancel(e: PointerEvent) {
  if (drag && e.pointerId === drag.pointerId) finishDrag(false);
}

function finishDrag(commit: boolean) {
  if (!drag) return;
  const { el, name, active, clone } = drag;
  clearTimeout(drag.holdTimer);
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  document.removeEventListener("pointercancel", onPointerCancel);
  document.removeEventListener("touchmove", preventTouchScroll);
  drag = null;
  if (!active) return; // never lifted → it was a tap/scroll; leave the click alone
  clone?.remove();
  el.classList.remove("drag-placeholder");
  if (commit) {
    const next = el.nextElementSibling as HTMLElement | null;
    const beforeName = next ? (next.dataset.entryName ?? next.dataset.flipKey ?? null) : null;
    moveMediaBefore(name, beforeName);
  }
  // Swallow the click that a mouse-up/tap fires right after a real drag, so the
  // drop doesn't also insert the clip's name.
  const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); clearTimeout(t); };
  document.addEventListener("click", swallow, { capture: true, once: true });
  const t = setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 350);
  render(); // normalise DOM to the registry (commit applied it; a cancel restores it)
}

/** Wire `handle` to start a reorder of `item` (the row or cell) on press. */
function attachReorder(handle: HTMLElement, item: HTMLElement, entry: MediaEntry, axis: "x" | "y") {
  handle.addEventListener("pointerdown", (e) => {
    if (drag || e.button !== 0 || !e.isPrimary) return;
    const pane = item.parentElement;
    if (!pane) return;
    drag = {
      name: entry.name, el: item, pane, axis,
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      isTouch: e.pointerType === "touch", active: false, offsetX: 0, offsetY: 0,
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    if (drag.isTouch) drag.holdTimer = setTimeout(beginActive, TOUCH_HOLD_MS);
  });
}

function makeRow(entry: MediaEntry): HTMLElement {
  const row = document.createElement("div");
  row.className = "vid-row";

  const isStream = entry.type === "stream";

  // Thumbnail / stream status dot. Clicking it inserts the name at the cursor
  // (same as the grid); flip-key pairs it with the grid cell for the transition.
  const thumb = document.createElement("div");
  thumb.className = "vid-thumb";
  thumb.dataset.flipKey = entry.name;
  thumb.title = `Insert "${entry.name}"`;
  thumb.addEventListener("click", () => insertName(entry.name));
  if (isStream) {
    const active = isStreamActive(entry.name);
    const dot = document.createElement("span");
    dot.className = "vid-status-dot";
    dot.style.background = active ? "#4c4" : "#666"; // dynamic: active vs disconnected
    dot.title = active ? "Active" : "Disconnected";
    thumb.appendChild(dot);
  } else if (entry.unavailable) {
    // Source failed to load/decode — show a warning glyph instead of a thumbnail.
    const warn = document.createElement("span");
    warn.className = "vid-thumb-warn";
    warn.textContent = "⚠";
    warn.style.color = "#e8a13a"; // dynamic state — kept inline like the stream dot
    warn.style.fontSize = "18px";
    warn.title = "Won't play — couldn't decode this source. It may be an unsupported format (e.g. 10-bit HEVC from an iPhone), corrupt, or offline.";
    thumb.appendChild(warn);
  } else if (entry.thumbnail) {
    const img = document.createElement("img");
    img.src = entry.thumbnail; // styled via `.vid-thumb img`
    img.draggable = false; // so dragging the thumb reorders the row, not the image
    thumb.appendChild(img);
  }
  row.appendChild(thumb);

  // Name input
  const nameInput = document.createElement("input");
  nameInput.value = entry.name;
  nameInput.className = "vid-name";
  nameInput.addEventListener("blur", () => {
    const newName = nameInput.value.trim();
    if (newName && newName !== entry.name) {
      const finalName = renameMedia(entry.name, newName);
      if (finalName) nameInput.value = finalName;
    }
  });
  row.appendChild(nameInput);

  if (isStream) {
    // Stream type label + reconnect/stop
    const label = document.createElement("span");
    label.textContent = entry.streamKind ?? "stream";
    label.className = "vid-stream-label";
    row.appendChild(label);

    const active = isStreamActive(entry.name);
    if (active) {
      const stopBtn = document.createElement("button");
      stopBtn.textContent = "Stop";
      stopBtn.className = "vid-btn-stop";
      stopBtn.addEventListener("click", () => { stopStream(entry.name); render(); });
      row.appendChild(stopBtn);
    } else {
      const reconnBtn = document.createElement("button");
      reconnBtn.textContent = "Reconnect";
      reconnBtn.className = "vid-btn-reconnect";
      reconnBtn.addEventListener("click", async () => {
        try {
          if (entry.streamKind === "webcam") {
            await startWebcam(entry.name, entry.deviceId);
          } else {
            await startScreenCapture(entry.name);
          }
          render();
        } catch (e: any) {
          showToast(e.message ?? "Reconnect failed");
        }
      });
      row.appendChild(reconnBtn);
    }
  } else {
    // URL input
    const urlInput = document.createElement("input");
    urlInput.value = entry.url;
    urlInput.className = "vid-url";
    urlInput.addEventListener("blur", () => {
      const newUrl = urlInput.value.trim();
      if (newUrl && newUrl !== entry.url) {
        updateUrl(entry.name, newUrl);
        if (isYouTubeUrl(newUrl)) downloadYouTube(entry.name);
      }
    });
    row.appendChild(urlInput);

    // Status indicators. Progress text comes from progressText() so the initial
    // build and the in-place updateRowProgress() refresh never diverge.
    const progress = progressText(entry);
    if (progress) {
      const indicator = document.createElement("span");
      indicator.className = entry.downloading ? "vid-indicator dl" : "vid-indicator";
      indicator.textContent = progress.text;
      indicator.title = progress.title;
      if (progress.small) indicator.style.fontSize = "16px";
      row.appendChild(indicator);
    } else if (entry.error) {
      const retryBtn = document.createElement("button");
      retryBtn.textContent = "↻";
      retryBtn.title = entry.error;
      retryBtn.className = "vid-btn-retry";
      retryBtn.addEventListener("click", () => {
        updateEntry(entry.name, { error: undefined });
        if (entry.pendingFile) {
          uploadToServer(entry.name, entry.pendingFile).catch(() => {/* error stored in entry */});
        } else {
          downloadYouTube(entry.name);
        }
      });
      row.appendChild(retryBtn);
    }
  }

  // Delete button
  const delBtn = document.createElement("button");
  delBtn.textContent = "×";
  delBtn.className = "vid-btn-delete";
  delBtn.addEventListener("click", () => {
    if (isStream) removeStream(entry.name);
    else removeMedia(entry.name);
  });
  row.appendChild(delBtn);

  // Drag by the thumbnail to reorder the row up/down (shared registry order → the
  // grid reorders too). On touch, press-and-hold the thumbnail to lift it.
  attachReorder(thumb, row, entry, "y");

  return row;
}

function makeFooterBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className = "pd-btn-flat";
  btn.addEventListener("click", onClick);
  return btn;
}

function showToast(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.className = "pd-toast";
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; }, 1500);
  setTimeout(() => el.remove(), 1800);
}
