import data from "virtual:reference-data";

interface RefEntry {
  name: string;
  description: string;
  params: string[];
  examples: string[];
  aliases: string[];
  isMethod: boolean;
}

interface RefCategory {
  name: string;
  entries: RefEntry[];
}

export function setupReference(container: HTMLElement) {
  const categories = data as RefCategory[];

  // Two-column layout: nav (left) + detail (right)
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;height:100%;";

  const navCol = document.createElement("div");
  navCol.style.cssText = "width:110px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid #333;";

  // Search box at top of nav column
  const searchBox = document.createElement("input");
  searchBox.type = "text";
  searchBox.placeholder = "search…";
  searchBox.style.cssText = "background:#1a1a1a;color:#ccc;border:1px solid #fff;border-radius:3px;padding:5px 8px;margin:0;font-size:12px;outline:none;flex-shrink:0;";
  navCol.appendChild(searchBox);

  const nav = document.createElement("div");
  nav.style.cssText = "flex:1;overflow-y:auto;padding:8px 0;font-size:12px;";

  const detail = document.createElement("div");
  detail.style.cssText = "flex:1;overflow-y:auto;padding:8px 12px;";

  // Track all elements for filtering
  const filterItems: { query: string; navHead: HTMLElement; navLink: HTMLElement; detailHead: HTMLElement; detailEntry: HTMLElement; cat: string }[] = [];
  const catNavHeads = new Map<string, HTMLElement>();
  const catDetailHeads = new Map<string, HTMLElement>();

  // Build nav + detail
  for (const cat of categories) {
    // Nav heading
    const navHead = document.createElement("div");
    navHead.textContent = cat.name;
    navHead.style.cssText = "color:#888;font-size:11px;padding:6px 8px 2px;text-transform:uppercase;";
    nav.appendChild(navHead);
    catNavHeads.set(cat.name, navHead);

    // Detail heading
    const detailHead = document.createElement("h3");
    detailHead.textContent = cat.name;
    detailHead.id = `ref-cat-${cat.name.replace(/\W/g, "")}`;
    detailHead.style.cssText = "color:#fff;font-size:13px;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #333;";
    detail.appendChild(detailHead);
    catDetailHeads.set(cat.name, detailHead);

    for (const entry of cat.entries) {
      const entryId = `ref-${entry.name}`;

      // Nav link
      const navLink = document.createElement("a");
      navLink.textContent = entry.isMethod ? `.${entry.name}()` : `${entry.name}()`;
      navLink.href = `#${entryId}`;
      navLink.style.cssText = "display:block;color:#aaa;padding:2px 8px;text-decoration:none;cursor:pointer;";
      navLink.addEventListener("click", (e) => {
        e.preventDefault();
        const target = detail.querySelector(`#${entryId}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      navLink.addEventListener("mouseenter", () => (navLink.style.color = "#fff"));
      navLink.addEventListener("mouseleave", () => (navLink.style.color = "#aaa"));
      nav.appendChild(navLink);

      // Detail entry
      const entryEl = document.createElement("div");
      entryEl.id = entryId;
      entryEl.style.cssText = "margin-bottom:16px;";

      const sig = entry.isMethod ? `.${entry.name}(${entry.params.length ? "..." : ""})` : `${entry.name}(${entry.params.length ? "..." : ""})`;
      const nameEl = document.createElement("div");
      nameEl.style.cssText = "color:#fff;font-size:13px;font-weight:bold;";
      nameEl.textContent = sig;
      if (entry.aliases.length) {
        const aliasSpan = document.createElement("span");
        aliasSpan.style.cssText = "color:#666;font-weight:normal;font-size:12px;margin-left:8px;";
        aliasSpan.textContent = `aliases: ${entry.aliases.map((a) => (entry.isMethod ? `.${a}()` : `${a}()`)).join(", ")}`;
        nameEl.appendChild(aliasSpan);
      }
      entryEl.appendChild(nameEl);

      const descEl = document.createElement("div");
      descEl.style.cssText = "color:#bbb;font-size:12px;margin:4px 0;";
      descEl.textContent = entry.description;
      entryEl.appendChild(descEl);

      if (entry.params.length) {
        const paramsEl = document.createElement("div");
        paramsEl.style.cssText = "color:#888;font-size:11px;margin:2px 0;";
        paramsEl.textContent = entry.params.join(" | ");
        entryEl.appendChild(paramsEl);
      }

      for (const ex of entry.examples) {
        const exEl = document.createElement("pre");
        exEl.style.cssText = "background:rgba(255,255,255,0.05);color:#ccc;padding:6px 8px;border-radius:3px;font-size:11px;margin:4px 0;overflow-x:auto;white-space:pre-wrap;";
        exEl.textContent = ex;
        entryEl.appendChild(exEl);
      }

      detail.appendChild(entryEl);

      // Searchable text: name, aliases, description
      const queryText = [entry.name, ...entry.aliases, entry.description].join(" ").toLowerCase();
      filterItems.push({ query: queryText, navLink, navHead, detailHead, detailEntry: entryEl, cat: cat.name });
    }
  }

  // Filter logic
  searchBox.addEventListener("input", () => {
    const term = searchBox.value.toLowerCase().trim();
    const visibleCats = new Set<string>();

    for (const item of filterItems) {
      const match = !term || item.query.includes(term);
      item.navLink.style.display = match ? "block" : "none";
      item.detailEntry.style.display = match ? "" : "none";
      if (match) visibleCats.add(item.cat);
    }

    // Show/hide category headings based on whether any entry in them is visible
    for (const [catName, el] of catNavHeads) {
      el.style.display = visibleCats.has(catName) ? "" : "none";
    }
    for (const [catName, el] of catDetailHeads) {
      el.style.display = visibleCats.has(catName) ? "" : "none";
    }
  });

  navCol.appendChild(nav);
  wrap.appendChild(navCol);
  wrap.appendChild(detail);
  container.innerHTML = "";
  container.appendChild(wrap);
}
