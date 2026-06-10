import {
  getServerUrl,
  setServerUrl,
  getServerStatus,
  getServerHealth,
  getServerError,
  subscribe,
  probeHealth,
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
  wrapper.className = "server-wrapper";

  const button = document.createElement("button");
  button.className = "pd-btn-flat server-btn";

  const dot = document.createElement("span");
  dot.className = "server-dot";
  button.append(document.createTextNode("Server "), dot);
  wrapper.appendChild(button);

  const popover = document.createElement("div");
  popover.className = "server-popover";
  wrapper.appendChild(popover);

  const blurb = document.createElement("div");
  blurb.className = "server-blurb";
  blurb.innerHTML = `Optional companion server for YouTube downloads and local-file uploads.
    <a href="https://github.com/v21/picodevil-server#readme" target="_blank" rel="noopener" class="server-link">What is this?</a>`;
  popover.appendChild(blurb);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "http://localhost:47426";
  urlInput.className = "pd-input server-url";
  popover.appendChild(urlInput);

  const warning = document.createElement("div");
  warning.className = "server-warning";
  popover.appendChild(warning);

  /** Tracks the last compatibility verdict so onBlur knows whether to save. */
  let lastCompat: CompatibilityResult = { ok: true, level: "info" };

  function refresh() {
    const url = getServerUrl();
    const status = getServerStatus();
    const health = getServerHealth();
    const err = getServerError();
    const c = STATUS_COLOURS[status];
    dot.style.background = c.dot;
    let tip: string;
    if (!url) tip = "server: not configured";
    else if (status === "ok" && health) tip = `server: connected (v${health.version})`;
    else if (status === "checking") tip = "server: checking…";
    else if (status === "error") tip = `server: offline${err ? ` — ${err}` : ""}`;
    else tip = "server: not checked";
    button.title = tip;
  }

  function applyCompat(c: CompatibilityResult) {
    lastCompat = c;
    if (!c.message) {
      warning.style.display = "none";
      return;
    }
    warning.style.display = "block";
    warning.textContent = c.message;
    if (c.level === "error") {
      warning.style.background = "#3a1a1a";
      warning.style.color = "#fcc";
    } else if (c.level === "warn") {
      warning.style.background = "#3a2e1a";
      warning.style.color = "#fc8";
    } else {
      warning.style.background = "#1a2a3a";
      warning.style.color = "#8cf";
    }
  }

  function updateCompat() {
    const trimmed = urlInput.value.trim();
    if (!trimmed) {
      lastCompat = { ok: true, level: "info" };
      warning.style.display = "none";
      return;
    }
    applyCompat(checkCompatibility(trimmed));
  }

  /** Commit the current input value to localStorage. setServerUrl probes automatically. */
  function commit() {
    const trimmed = urlInput.value.trim();
    const current = getServerUrl() ?? "";
    if (trimmed === "") {
      if (current !== "") setServerUrl(null);
      return;
    }
    if (lastCompat.level === "error") return; // refuse hard errors
    if (trimmed !== current) {
      setServerUrl(trimmed); // changed → persist (setServerUrl probes)
    } else if (getServerStatus() === "unknown") {
      // Unchanged URL, but we never probed it — on a public page we defer the
      // startup probe of a localhost server to avoid an unsolicited
      // local-network permission prompt. The user has now opened this box (their
      // chance to point it elsewhere) and closed it on this URL, so run the
      // liveness check they've implicitly authorised.
      probeHealth().catch(() => {/* status set internally */});
    }
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
    // Test against the open value, not "none": the closed state is now the
    // class default (inline display is "" until first toggled).
    if (popover.style.display !== "flex") openPopover();
    else closePopover();
  });

  // Close on outside click
  function onDocClick(e: MouseEvent) {
    if (!wrapper.contains(e.target as Node)) closePopover();
  }
  document.addEventListener("click", onDocClick);

  urlInput.addEventListener("input", updateCompat);
  urlInput.addEventListener("blur", commit);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); urlInput.blur(); }
    else if (e.key === "Escape") { closePopover(); }
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
