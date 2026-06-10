import {
  getAllEntries, addMedia, removeMedia, renameMedia, updateUrl, updateEntry,
  isYouTubeUrl, downloadYouTube, exportAll, importAll, clearAll, setOnChange,
  uploadToServer, addFromServer, missingFromServer, guessTypeFromFile,
  type MediaEntry, type SourceItem,
} from "./media-registry";
import { getServerUrl, getServerStatus, subscribe as subscribeServer } from "./server-config";
import { createServerSettingsButton } from "./server-settings-ui";
import {
  startWebcam, startScreenCapture, stopStream, removeStream,
  isStreamActive, setStreamOnChange, reconnectStreams,
} from "./stream-manager";

let container: HTMLElement;

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
    } catch { /* not valid JSON, let paste proceed normally */ }
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
      try { importAll(text); showToast("Imported from drop"); return; } catch {}
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
  // First render: build the persistent structure (add bar + scrollable list).
  // These are never torn down so the list's scroll position and the add bar's
  // input value survive subsequent renders.
  if (!container.querySelector("[data-add-bar]")) {
    container.appendChild(makeAddBar());
  }

  if (!container.querySelector("[data-list]")) {
    const list = document.createElement("div");
    list.dataset.list = "1";
    list.className = "vid-list";
    container.appendChild(list);
  }

  // Reconcile list items in place — no scroll position lost.
  const list = container.querySelector<HTMLElement>("[data-list]")!;
  reconcileList(list, getAllEntries());

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

/** Stable key representing all visually-relevant fields of an entry.
 *  If the key is unchanged, the row DOM node is reused without modification. */
function entryRenderKey(entry: MediaEntry): string {
  return [
    entry.url,
    entry.type ?? "",
    entry.thumbnail ?? "",
    String(!!entry.downloading),
    entry.phase ?? "",
    String(entry.phasePercent ?? ""),
    String(!!entry.uploading),
    String(entry.uploadProgress ?? ""),
    entry.error ?? "",
    String(!!entry.unavailable),
    entry.streamKind ?? "",
    entry.deviceId ?? "",
    String(entry.type === "stream" ? isStreamActive(entry.name) : false),
  ].join("\0");
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

function makeRow(entry: MediaEntry): HTMLElement {
  const row = document.createElement("div");
  row.className = "vid-row";

  const isStream = entry.type === "stream";

  // Thumbnail / stream status dot
  const thumb = document.createElement("div");
  thumb.className = "vid-thumb";
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

    // Status indicators
    if (entry.uploading) {
      const indicator = document.createElement("span");
      const pct = entry.uploadProgress != null ? Math.round(entry.uploadProgress * 100) : null;
      indicator.textContent = pct != null && pct < 100 ? `↑${pct}%` : "⚙";
      indicator.title = pct != null && pct < 100 ? "Uploading…" : "Transcoding…";
      indicator.className = "vid-indicator";
      row.appendChild(indicator);
    } else if (entry.downloading) {
      // Two-phase YouTube progress: "downloading: 45%" then "transcoding: 13%".
      // Falls back to ⏳ before the first /ready poll reports a phase.
      const indicator = document.createElement("span");
      indicator.className = "vid-indicator dl";
      if (entry.phase && entry.phasePercent != null) {
        const label = entry.phase === "transcode" ? "transcoding" : "downloading";
        indicator.textContent = `${label}: ${Math.round(entry.phasePercent * 100)}%`;
        indicator.title = `${label} in progress`;
      } else {
        indicator.textContent = "⏳";
        indicator.style.fontSize = "16px";
      }
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
