import { setupReference } from "./reference";
import { setupMediaLoader } from "./media-loader";

const STORAGE_KEY = "uzuvid-sidebar";

function loadState(): { open?: boolean; tab?: string; width?: number } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch { return {}; }
}

function saveState(updates: Partial<{ open: boolean; tab: string; width: number }>) {
  const state = { ...loadState(), ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setupSidebar() {
  const toggle = document.getElementById("sidebar-toggle")!;
  const panel = document.getElementById("sidebar-panel")!;
  const handle = panel.querySelector<HTMLElement>(".resize-handle")!;
  const saved = loadState();

  // Restore open state
  if (saved.open) {
    panel.classList.add("open");
    toggle.classList.add("open");
    toggle.textContent = "›";
  }

  // Restore width
  if (saved.width) {
    panel.style.width = saved.width + "px";
  }

  toggle.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    toggle.classList.toggle("open", open);
    toggle.textContent = open ? "›" : "‹";
    saveState({ open });
  });

  // Drag left edge to resize
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;

    const onMove = (e: MouseEvent) => {
      const w = Math.max(200, startWidth + (startX - e.clientX));
      panel.style.width = w + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveState({ width: panel.offsetWidth });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Populate tabs
  const refTab = document.getElementById("tab-reference");
  if (refTab) setupReference(refTab);
  const videosTab = document.getElementById("tab-videos");
  if (videosTab) setupMediaLoader(videosTab);

  // Tabs
  const tabs = panel.querySelectorAll<HTMLButtonElement>(".tabs button");

  // Restore active tab
  if (saved.tab) {
    tabs.forEach((t) => t.classList.remove("active"));
    panel.querySelectorAll<HTMLElement>(".tab-content").forEach((el) => el.classList.remove("active"));
    tabs.forEach((t) => {
      if (t.dataset.tab === saved.tab) t.classList.add("active");
    });
    const tabEl = document.getElementById(`tab-${saved.tab}`);
    if (tabEl) tabEl.classList.add("active");
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      panel.querySelectorAll<HTMLElement>(".tab-content").forEach((el) => {
        el.classList.toggle("active", el.id === `tab-${tab.dataset.tab}`);
      });
      saveState({ tab: tab.dataset.tab });
    });
  });
}
