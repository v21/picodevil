import {
  getServerUrl,
  setServerUrl,
  getServerStatus,
  getServerHealth,
  getServerError,
  probeHealth,
  subscribe,
  checkCompatibility,
  type CompatibilityResult,
} from "./server-config";

const STATUS_COLOURS = {
  unknown: { dot: "#666", text: "#999" },
  checking: { dot: "#cc8", text: "#cc8" },
  ok: { dot: "#4c4", text: "#4c4" },
  error: { dot: "#c44", text: "#c44" },
};

/**
 * Returns a button (live status pill) that opens a popover with the server URL
 * settings. Meant to be appended at the bottom of the Videos sidebar tab.
 *
 * Caller owns lifecycle: call returned `dispose()` when the element is removed
 * from the DOM (cleans up the server-config subscription).
 */
export function createServerSettingsButton(): { el: HTMLElement; dispose: () => void } {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:relative;width:100%;";

  const button = document.createElement("button");
  button.style.cssText = [
    "width:100%",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "background:#1a1a1a",
    "color:#ccc",
    "border:1px solid #333",
    "padding:6px 10px",
    "border-radius:3px",
    "cursor:pointer",
    "font-size:14px",
    "text-align:left",
  ].join(";");

  const dot = document.createElement("span");
  dot.style.cssText = "display:inline-block;width:10px;height:10px;border-radius:50%;flex-shrink:0;";
  const label = document.createElement("span");
  label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const detail = document.createElement("span");
  detail.style.cssText = "color:#666;font-size:12px;";
  button.append(dot, label, detail);
  wrapper.appendChild(button);

  const popover = document.createElement("div");
  popover.style.cssText = [
    "position:absolute",
    "bottom:calc(100% + 4px)",
    "left:0",
    "right:0",
    "background:#161616",
    "border:1px solid #444",
    "border-radius:4px",
    "padding:10px",
    "z-index:10",
    "display:none",
    "flex-direction:column",
    "gap:8px",
    "font-size:13px",
    "color:#bbb",
  ].join(";");
  wrapper.appendChild(popover);

  const blurb = document.createElement("div");
  blurb.style.cssText = "color:#888;font-size:12px;line-height:1.4;";
  blurb.innerHTML = `Optional companion server for YouTube downloads and local-file uploads.
    <a href="https://github.com/v21/picodevil-server#readme" target="_blank" rel="noopener" style="color:#88f;">What is this?</a>`;
  popover.appendChild(blurb);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "http://localhost:47426";
  urlInput.style.cssText = "background:#1a1a1a;color:#ccc;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:14px;width:100%;box-sizing:border-box;";
  popover.appendChild(urlInput);

  const warning = document.createElement("div");
  warning.style.cssText = "font-size:12px;line-height:1.4;padding:6px 8px;border-radius:3px;display:none;";
  popover.appendChild(warning);

  const buttonRow = document.createElement("div");
  buttonRow.style.cssText = "display:flex;gap:6px;";
  const testBtn = makeBtn("Test");
  const saveBtn = makeBtn("Save");
  const clearBtn = makeBtn("Clear");
  buttonRow.append(testBtn, saveBtn, clearBtn);
  popover.appendChild(buttonRow);

  function makeBtn(text: string) {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = "flex:1;background:#2a2a2a;color:#ccc;border:1px solid #444;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:13px;";
    return b;
  }

  function refresh() {
    const url = getServerUrl();
    const status = getServerStatus();
    const health = getServerHealth();
    const err = getServerError();
    const c = STATUS_COLOURS[status];
    dot.style.background = c.dot;
    label.style.color = c.text;
    if (!url) {
      label.textContent = "server: not configured";
      detail.textContent = "";
    } else if (status === "ok" && health) {
      label.textContent = "server: connected";
      detail.textContent = `v${health.version}`;
    } else if (status === "checking") {
      label.textContent = "server: checking…";
      detail.textContent = "";
    } else if (status === "error") {
      label.textContent = "server: offline";
      detail.textContent = err ?? "";
    } else {
      label.textContent = "server: not checked";
      detail.textContent = "";
    }
    if (popover.style.display !== "none") {
      // Only refresh input value when popover isn't open, to avoid wiping
      // user-typed text mid-edit
    }
  }

  function applyCompat(c: CompatibilityResult) {
    if (!c.message) {
      warning.style.display = "none";
      saveBtn.disabled = false;
      testBtn.disabled = false;
      return;
    }
    warning.style.display = "block";
    warning.textContent = c.message;
    if (c.level === "error") {
      warning.style.background = "#3a1a1a";
      warning.style.color = "#fcc";
      saveBtn.disabled = true;
      testBtn.disabled = true;
    } else if (c.level === "warn") {
      warning.style.background = "#3a2e1a";
      warning.style.color = "#fc8";
      saveBtn.disabled = false;
      testBtn.disabled = false;
    } else {
      warning.style.background = "#1a2a3a";
      warning.style.color = "#8cf";
      saveBtn.disabled = false;
      testBtn.disabled = false;
    }
  }

  function updateCompat() {
    if (!urlInput.value.trim()) {
      warning.style.display = "none";
      return;
    }
    applyCompat(checkCompatibility(urlInput.value.trim()));
  }

  function openPopover() {
    urlInput.value = getServerUrl() ?? "";
    updateCompat();
    popover.style.display = "flex";
    urlInput.focus();
  }
  function closePopover() {
    popover.style.display = "none";
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover.style.display === "none") openPopover();
    else closePopover();
  });

  // Close on outside click
  function onDocClick(e: MouseEvent) {
    if (!wrapper.contains(e.target as Node)) closePopover();
  }
  document.addEventListener("click", onDocClick);

  urlInput.addEventListener("input", updateCompat);

  testBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const url = urlInput.value.trim();
    if (!url) return;
    await probeHealth(url);
  });

  saveBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const url = urlInput.value.trim();
    if (!url) return;
    setServerUrl(url);
    await probeHealth(url);
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    urlInput.value = "";
    setServerUrl(null);
    updateCompat();
  });

  const unsubscribe = subscribe(refresh);
  refresh();

  return {
    el: wrapper,
    dispose: () => {
      unsubscribe();
      document.removeEventListener("click", onDocClick);
    },
  };
}
