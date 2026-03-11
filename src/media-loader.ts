import {
  getAllEntries, addMedia, removeMedia, renameMedia, updateUrl, updateEntry,
  isYouTubeUrl, downloadYouTube, exportAll, importAll, clearAll, setOnChange,
  type MediaEntry,
} from "./media-registry";

let container: HTMLElement;

export function setupMediaLoader(el: HTMLElement) {
  container = el;
  setOnChange(render);
  render();

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
        const url = URL.createObjectURL(file);
        const name = file.name.replace(/\.[^.]+$/, "");
        addMedia(url, name);
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
  container.innerHTML = "";

  // Add bar
  const addBar = document.createElement("div");
  addBar.style.cssText = "display:flex;gap:4px;padding:8px;border-bottom:1px solid #333;";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "paste URL to add...";
  input.style.cssText = "flex:1;background:#1a1a1a;color:#ccc;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:16px;";

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

  addBar.appendChild(input);
  addBar.appendChild(addBtn);
  container.appendChild(addBar);

  // List
  const list = document.createElement("div");
  list.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;";

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

  // Footer buttons
  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;gap:4px;padding:8px;border-top:1px solid #333;flex-wrap:wrap;";

  footer.appendChild(makeFooterBtn("Export", () => {
    navigator.clipboard.writeText(exportAll()).then(
      () => showToast("Copied to clipboard"),
      () => showToast("Copy failed"),
    );
  }));

  footer.appendChild(makeFooterBtn("Import", () => {
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
  footer.appendChild(clearBtn);

  container.appendChild(footer);
}

function makeRow(entry: MediaEntry): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:16px;";

  // Thumbnail
  const thumb = document.createElement("div");
  thumb.style.cssText = "width:40px;height:30px;flex-shrink:0;background:#222;border-radius:2px;overflow:hidden;";
  if (entry.thumbnail) {
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
  if (entry.downloading) {
    const spinner = document.createElement("span");
    spinner.textContent = "⏳";
    spinner.style.cssText = "flex-shrink:0;font-size:16px;";
    row.appendChild(spinner);
  } else if (entry.error) {
    const retryBtn = document.createElement("button");
    retryBtn.textContent = "↻";
    retryBtn.title = entry.error;
    retryBtn.style.cssText = "background:none;border:none;color:#f88;cursor:pointer;font-size:18px;flex-shrink:0;padding:0 2px;";
    retryBtn.addEventListener("click", () => {
      updateEntry(entry.name, { error: undefined });
      downloadYouTube(entry.name);
    });
    row.appendChild(retryBtn);
  }

  // Delete button
  const delBtn = document.createElement("button");
  delBtn.textContent = "×";
  delBtn.style.cssText = "background:none;border:none;color:#666;cursor:pointer;font-size:20px;flex-shrink:0;padding:0 2px;";
  delBtn.addEventListener("mouseenter", () => { delBtn.style.color = "#f66"; });
  delBtn.addEventListener("mouseleave", () => { delBtn.style.color = "#666"; });
  delBtn.addEventListener("click", () => removeMedia(entry.name));
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
