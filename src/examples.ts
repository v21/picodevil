export interface Example {
  name: string;
  code: string;
  /** Opt in to greeting a first-time visitor on a fresh session. Opt-in: only
   *  examples set `true` join the autostart pool. Omitted (or `false`) keeps an
   *  example out — `false` is used to flag *why* it's excluded (e.g.
   *  heavily-flashing ones that shouldn't be shown without a warning). */
  autostart?: boolean;
}

export const examples: Example[] = [
  {
    name: "rgb",
    autostart: true,
    code: `// by v21

$: S("<rgb1 rgb2 rgb3>")
  .alpha(slider(1.00))
  .objectfit("tilecenter")
  .scrollX(rand.segment(1))
  .scrollY(sine.slow("5"))
  .rotate(saw.slow(10))
  .scale("<1.5 2.5>/4".lerp())

// \`prev\` grabs the previous rendered frame 
$: s("prev").scale(.95).barrel(.01).alpha(.9)

`,
  },
  {
    name: "space_tv",
    autostart: true,
    code: `// by v21

$: s("#222")

// H prefix means it doesn't render directly
Hscan: s("scanlines").objectfit("tile").scale(10)

$: s("issexercise1, issexercise2, issexercise3, issdock, issmodule, tvsnow, testcard")
.sync()
.shuffleindex(rand.segment(1))
.stack(s("scan").blend("multiply").alpha(.4))
.often(speed(-1))
.rows(3)
.cols(4)
.gridMod()
.scale(.9)
.barrel(.7)
.sometimes(croph(-1))
.sometimes(cropw(-1))
`
  }
  ,
  {
    name: "canalslices",
    autostart: true,
    code: `// by v21
 $: s("canalboat")
.syncStack(5)
.shuffleIndex()
.cols(5)
.rows(1)
.gridMod()`
  },
  {
    name: "ducks",
    autostart: true,
    code: `// by v21

setCps(0.125)

 $: s("ducks")
.speed("<1 .5*2 -1 -.5*2>")
.chop(8)
.rev()
`
  },
  {
    name:"picodevil",
    autostart: true,
    code:`// by v21


$: s("text:_picodevil_")
.objectfit("tile")
.fontpicker('BIZ UDPMincho')
.rotate(saw.slow(100))
.fontsize(48)
.scale(2)


$: s("prev")
  .alpha(.9975)
  .pixelate(8)
  .huerot("-.01 .01".fast(10))


$: s("text:picodevil")
.fontpicker('Shantell Sans')
.fontaxis('INFM', "0 100 50".lerp())
.fontaxis('BNCE', sine.range(-100,100).fast(2))
.fontaxis('wght', sine.range(300,800).fast(1.5))
.fontaxis('ital', sine.range(0,1).slow(10))
.fontsize(500)
.fontcolor("red")
.x(sine.range(.4,.6).slow(5))
.y(cosine.range(.4,.6).slow(2))
`
  },{
    "name":"colour grids (flashing)",
    "autostart": false,
    "code":`// by v21

$: s("prev")
$: s("<#f00 #0f0 #00f prev>,<white black ~>")
.rowscols("<1 3 4 11 32>")
.stackN("4 2 8 1")
.late(choose(0, 1/3, .5, 2/3).segment(choose(.25, .5, 1).segment(1)))
.late(choose(0, 0, 0, 0, 1, -1, 2, 3).segment(choose(.25, .5, 1).segment(1)))
.stackN("2 4 3")
.rarely(fast(2))
.stackN("<1 4>")
.someCycles(rev())
.index()
.gridMod()`
  }
];

/** Examples eligible to autostart on a fresh session — opt-in, only those
 *  flagged `autostart: true`. */
export function autostartExamples(): Example[] {
  return examples.filter(e => e.autostart === true);
}

/**
 * Code to show a first-time visitor on a fresh session: a random
 * autostart-eligible example, or "" if none are eligible. `pick` chooses an
 * index in [0, n) and is injectable so tests can be deterministic.
 */
export function pickAutostartCode(
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  const eligible = autostartExamples();
  if (eligible.length === 0) return "";
  return eligible[pick(eligible.length)].code;
}

export function setupExamples(container: HTMLElement) {
  container.innerHTML = "";
  const list = document.createElement("ul");
  list.className = "examples-list";
  for (const ex of examples) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "pd-btn";
    btn.textContent = ex.name;
    btn.addEventListener("click", () => {
      // Reset tempo first so an example without setCps() runs at the default,
      // rather than inheriting the previous example's cps. The example's own
      // setCps() (if any) runs during eval below and wins.
      (window as any).pdResetCps?.();
      window.pdSetCode(ex.code, true); // load the example and evaluate it
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  container.appendChild(list);
}
