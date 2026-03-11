export function setupSidebar() {
  const toggle = document.getElementById("sidebar-toggle")!;
  const panel = document.getElementById("sidebar-panel")!;
  const handle = panel.querySelector<HTMLElement>(".resize-handle")!;

  toggle.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    toggle.textContent = open ? "›" : "‹";
  });

  // Drag left edge to resize
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;

    const onMove = (e: MouseEvent) => {
      panel.style.width = Math.max(200, startWidth + (startX - e.clientX)) + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Tabs
  const tabs = panel.querySelectorAll<HTMLButtonElement>(".tabs button");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      panel.querySelectorAll<HTMLElement>(".tab-content").forEach((el) => {
        el.classList.toggle("active", el.id === `tab-${tab.dataset.tab}`);
      });
    });
  });
}
