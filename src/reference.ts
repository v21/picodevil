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

  const wrap = document.createElement("div");
  wrap.className = "ref-wrap";

  const navCol = document.createElement("div");
  navCol.className = "ref-nav-col";

  const searchBox = document.createElement("input");
  searchBox.type = "text";
  searchBox.placeholder = "search…";
  searchBox.className = "ref-search";
  navCol.appendChild(searchBox);

  const nav = document.createElement("div");
  nav.className = "ref-nav";

  const detail = document.createElement("div");
  detail.className = "ref-detail";

  // Track all elements for filtering
  const filterItems: { query: string; navLink: HTMLElement; detailEntry: HTMLElement; cat: string }[] = [];
  const catNavHeads = new Map<string, HTMLElement>();
  const catDetailHeads = new Map<string, HTMLElement>();

  for (const cat of categories) {
    const navHead = document.createElement("div");
    navHead.textContent = cat.name;
    navHead.className = "ref-nav-head";
    nav.appendChild(navHead);
    catNavHeads.set(cat.name, navHead);

    const detailHead = document.createElement("h3");
    detailHead.textContent = cat.name;
    detailHead.id = `ref-cat-${cat.name.replace(/\W/g, "")}`;
    detailHead.className = "ref-detail-head";
    detail.appendChild(detailHead);
    catDetailHeads.set(cat.name, detailHead);

    for (const entry of cat.entries) {
      const entryId = `ref-${entry.name}`;

      const navLink = document.createElement("a");
      navLink.textContent = entry.isMethod ? `.${entry.name}()` : `${entry.name}()`;
      navLink.href = `#${entryId}`;
      navLink.className = "ref-nav-link";
      navLink.addEventListener("click", (e) => {
        e.preventDefault();
        const target = detail.querySelector(`#${entryId}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(navLink);

      const entryEl = document.createElement("div");
      entryEl.id = entryId;
      entryEl.className = "ref-entry";

      const sig = entry.isMethod ? `.${entry.name}(${entry.params.length ? "..." : ""})` : `${entry.name}(${entry.params.length ? "..." : ""})`;
      const nameEl = document.createElement("div");
      nameEl.className = "ref-entry-name";
      nameEl.textContent = sig;
      if (entry.aliases.length) {
        const aliasSpan = document.createElement("span");
        aliasSpan.className = "ref-entry-aliases";
        aliasSpan.textContent = `aliases: ${entry.aliases.map((a) => (entry.isMethod ? `.${a}()` : `${a}()`)).join(", ")}`;
        nameEl.appendChild(aliasSpan);
      }
      entryEl.appendChild(nameEl);

      const descEl = document.createElement("div");
      descEl.className = "ref-entry-desc";
      const paragraphs = entry.description.split("\n\n");
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const p = paragraphs[pi].trim();
        if (!p) continue;
        if (pi > 0) descEl.appendChild(document.createElement("br"));
        const span = document.createElement("span");
        span.textContent = p;
        descEl.appendChild(span);
      }
      entryEl.appendChild(descEl);

      if (entry.params.length) {
        const paramsEl = document.createElement("div");
        paramsEl.className = "ref-entry-params";
        paramsEl.textContent = entry.params.join(" | ");
        entryEl.appendChild(paramsEl);
      }

      for (const ex of entry.examples) {
        const exEl = document.createElement("pre");
        exEl.className = "ref-entry-example";
        exEl.textContent = ex;
        entryEl.appendChild(exEl);
      }

      detail.appendChild(entryEl);

      const queryText = [entry.name, ...entry.aliases, entry.description].join(" ").toLowerCase();
      filterItems.push({ query: queryText, navLink, detailEntry: entryEl, cat: cat.name });
    }
  }

  // Filter logic
  searchBox.addEventListener("input", () => {
    const term = searchBox.value.toLowerCase().trim();
    const visibleCats = new Set<string>();

    for (const item of filterItems) {
      const match = !term || item.query.includes(term);
      item.navLink.style.display = match ? "" : "none";
      item.detailEntry.style.display = match ? "" : "none";
      if (match) visibleCats.add(item.cat);
    }

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
