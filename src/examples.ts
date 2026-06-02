const examples: { name: string; code: string }[] = [
  {
    name: "hello",
    code: `$: color("red blue green").rowscols(3).gridMod()`,
  },
];

export function setupExamples(container: HTMLElement) {
  container.innerHTML = "";
  const list = document.createElement("ul");
  list.className = "examples-list";
  for (const ex of examples) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = ex.name;
    btn.addEventListener("click", () => {
      window.pdSetCode(ex.code);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  container.appendChild(list);
}
