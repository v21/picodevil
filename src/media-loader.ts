import {
  getAllEntries, addMedia, removeMedia, renameMedia, updateUrl, updateEntry,
  isYouTubeUrl, downloadYouTube, exportAll, importAll, clearAll, setOnChange,
  uploadToServer, addFromServer, missingFromServer, type MediaEntry, type SourceItem,
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

export function setupMediaLoader(el: HTMLElement) {
  container = el;
  setOnChange(render);
  setStreamOnChange(render);
  // Re-render when the server connection status changes so the "Load all"
  // footer button appears/disappears in step with the connection.
  subscribeServer(render);
  render();

  // Fetch the defaults bundle once. The "Defaults" button only shows when this
  // resolves AND it contains media not already in the list, so a failed/blocked
  // fetch simply leaves the button hidden.
  fetch(DEFAULTS_URL)
    .then(res => res.ok ? res.json() : null)
    .then(items => {
      if (Array.isArray(items)) { defaultSources = items; render(); }
    })
    .catch(() => {/* offline or CORS-blocked — button stays hidden */});

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
        const entry = addMedia(blobUrl, name);
        if (getServerUrl() && getServerStatus() !== "error") {
          uploadToServer(entry.name, file).catch(() => {/* error stored in entry */});
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
  const prevScrollTop = container.querySelector<HTMLElement>("[data-list]")?.scrollTop ?? 0;
  container.innerHTML = "";

  // Add bar
  const addBar = document.createElement("div");
  addBar.style.cssText = "display:flex;gap:4px;padding:8px;border-bottom:1px solid #333;flex-wrap:wrap;";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "paste URL to add...";
  // min-width:0 lets the flex:1 input shrink below its intrinsic width so the
  // row doesn't overflow (and force a horizontal scrollbar) on a narrow sidebar.
  input.style.cssText = "flex:1;min-width:0;background:#1a1a1a;color:#ccc;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:16px;";

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add";
  addBtn.style.cssText = "background:#333;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:16px;";
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
  camBtn.style.cssText = "background:#333;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:16px;";
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
  screenBtn.style.cssText = "background:#333;color:#ccc;border:1px solid #555;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:16px;";
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
  container.appendChild(addBar);

  // List
  const list = document.createElement("div");
  list.dataset.list = "1";
  // min-height:0 lets this flex child shrink below its content so only the list
  // scrolls — without it, a taller (wrapped) footer pushes an extra scrollbar
  // onto the whole videos tab.
  list.style.cssText = "flex:1;min-height:0;overflow-y:auto;padding:4px 0;";

  const entries = getAllEntries();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No media added yet";
    empty.style.cssText = "color:#555;font-size:16px;padding:12px;text-align:center;";
    list.appendChild(empty);
  }

  for (const entry of entries) {
    list.appendChild(makeRow(entry));
  }

  container.appendChild(list);
  list.scrollTop = prevScrollTop;

  // Footer buttons. Two groups: management/add actions on the left, server actions
  // on the right. The footer wraps as a whole and the right group is a single flex
  // child pushed over with margin-left:auto — so when the sidebar is too narrow for
  // one line, the entire right group drops to a second (still right-aligned) line
  // rather than buttons breaking at arbitrary points.
  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;gap:4px;padding:8px;border-top:1px solid #333;flex-wrap:wrap;align-items:center;";

  const leftGroup = document.createElement("div");
  leftGroup.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;";
  footer.appendChild(leftGroup);

  const rightGroup = document.createElement("div");
  rightGroup.style.cssText = "display:flex;gap:4px;align-items:center;margin-left:auto;";
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
      clearBtn.style.color = "#aaa";
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

  container.appendChild(footer);
}

function makeRow(entry: MediaEntry): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:16px;";

  const isStream = entry.type === "stream";

  // Thumbnail / stream status dot
  const thumb = document.createElement("div");
  thumb.style.cssText = "width:40px;height:30px;flex-shrink:0;background:#222;border-radius:2px;overflow:hidden;display:flex;align-items:center;justify-content:center;";
  if (isStream) {
    const active = isStreamActive(entry.name);
    const dot = document.createElement("span");
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${active ? "#4c4" : "#666"};`;
    dot.title = active ? "Active" : "Disconnected";
    thumb.appendChild(dot);
  } else if (entry.thumbnail) {
    const img = document.createElement("img");
    img.src = entry.thumbnail;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;";
    thumb.appendChild(img);
  }
  row.appendChild(thumb);

  // Name input
  const nameInput = document.createElement("input");
  nameInput.value = entry.name;
  nameInput.style.cssText = "width:140px;background:transparent;color:#ccc;border:1px solid transparent;padding:2px 4px;border-radius:2px;font-size:16px;";
  nameInput.addEventListener("focus", () => { nameInput.style.borderColor = "#555"; });
  nameInput.addEventListener("blur", () => {
    nameInput.style.borderColor = "transparent";
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
    label.style.cssText = "flex:1;color:#888;font-size:14px;";
    row.appendChild(label);

    const active = isStreamActive(entry.name);
    if (active) {
      const stopBtn = document.createElement("button");
      stopBtn.textContent = "Stop";
      stopBtn.style.cssText = "background:none;border:1px solid #555;color:#f88;cursor:pointer;font-size:14px;padding:2px 8px;border-radius:3px;flex-shrink:0;";
      stopBtn.addEventListener("click", () => { stopStream(entry.name); render(); });
      row.appendChild(stopBtn);
    } else {
      const reconnBtn = document.createElement("button");
      reconnBtn.textContent = "Reconnect";
      reconnBtn.style.cssText = "background:none;border:1px solid #555;color:#8c8;cursor:pointer;font-size:14px;padding:2px 8px;border-radius:3px;flex-shrink:0;";
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
    urlInput.style.cssText = "flex:1;min-width:0;background:transparent;color:#888;border:1px solid transparent;padding:2px 4px;border-radius:2px;font-size:14px;";
    urlInput.addEventListener("focus", () => { urlInput.style.borderColor = "#555"; });
    urlInput.addEventListener("blur", () => {
      urlInput.style.borderColor = "transparent";
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
      indicator.style.cssText = "flex-shrink:0;font-size:13px;color:#aaa;";
      row.appendChild(indicator);
    } else if (entry.downloading) {
      // Two-phase YouTube progress: "downloading: 45%" then "transcoding: 13%".
      // Falls back to ⏳ before the first /ready poll reports a phase.
      const indicator = document.createElement("span");
      indicator.style.cssText = "flex-shrink:0;font-size:12px;color:#aaa;white-space:nowrap;";
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
      retryBtn.style.cssText = "background:none;border:none;color:#f88;cursor:pointer;font-size:18px;flex-shrink:0;padding:0 2px;";
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
  delBtn.style.cssText = "background:none;border:none;color:#666;cursor:pointer;font-size:20px;flex-shrink:0;padding:0 2px;";
  delBtn.addEventListener("mouseenter", () => { delBtn.style.color = "#f66"; });
  delBtn.addEventListener("mouseleave", () => { delBtn.style.color = "#666"; });
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
  btn.style.cssText = "background:#222;color:#aaa;border:1px solid #444;padding:4px 12px;border-radius:3px;cursor:pointer;font-size:14px;";
  btn.addEventListener("mouseenter", () => { btn.style.color = "#fff"; });
  btn.addEventListener("mouseleave", () => { btn.style.color = "#aaa"; });
  btn.addEventListener("click", onClick);
  return btn;
}

function showToast(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:20px;right:20px;background:#333;color:#ccc;padding:8px 16px;border-radius:4px;font-size:12px;z-index:100;transition:opacity 0.3s;";
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; }, 1500);
  setTimeout(() => el.remove(), 1800);
}
