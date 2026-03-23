


next steps:
/ persist state between refreshes
/ ~ is transparent
- sample bank pane
/ multiple videos
- position videos on screen
- grid logic
- tap to set cps
- function reference


- modI - func applied to original pattern

seti and modI should wrap if index is over grid size

bugs:
- animated GIFs don't play (only first frame shown)
  - canvas `drawImage()` from an `<img>` element only captures the first frame of animated GIFs in Chrome
  - possible fixes: (a) render image screens as DOM `<img>` overlays instead of canvas (stacking order gets tricky with mixed screen types), (b) client-side GIF frame decoding with a library like gifuct-js (needs CORS proxy for cross-origin URLs)

code quality:
/ extract video playback logic from main.ts render loop 
/ show eval errors in the editor, not just console
/ fix timing: changing CPS mid-performance causes discontinuous jump (need phase adjustment)






matching strudel:
- our methods should be proper functions - they should be able to be applied via something like `off`. function composition over OOP builder pattern
- i guess the check is if `bind` works
- write up the idea that we need to sample per-frame rather than determine durations of events and keep things entirely within that
- but do understand the overlay() combinator more - i'm sus!
- move so that each property is atomic, and it's at frame evaluation time that we collect the parameters from each property. 
- but! we can use the onset idea from strudel for doing things like creating video elements etc. this allows us to reset the playhead on each event

- can we drop out? and implictly imply it for any values that are output? or, alternatively, borrow strudel's $: prefix - use this as a z-index order implicitly

also later:
/ switch to fraction based time, where we can - Strudel uses Fractions internally, we pass them through correctly

draw a tree of current render state, and update that as we iterate through time. good way to see how values change over time






# after

- we can add a pre-warm system - it looks ahead in the pattern and tells us which videos need to be created, ahead of time, so we have them ready and warmed when we need them
- this can also thread into pooling - it can also, if it's sophisticated, tell us what video resources will be freed by then. if we've got a video moving across a grid, that can be done with one or two elements


- we should also scrap the idea that each video has it's own playhead position - set this entirely from the patterns


- something to feed in a unique randomness to each instance of a pattern within a grid


# small things
/ where are we injecting p() ? is ti the right place
/ scale can just call scaleX and scaleY
/ once we've moved stuff across - do a pass on what's cruft left from the migration
- run full test suite each time before offering to commit
- when we hit `Uncaught TypeError: screen.queryArc is not a function` that shouldn't block rendering in future evals
/ stop making useless screenshots
/ when running monkey tests - also replay old ones
/ change lerp and spline to take patterns
/ shift to hypothesis style testing - like monkey testing but with shrinking & Claude expects to treat the failures seriously and use thm as a test suite
/ add synonyms for x/y width/height (top, left, w, h)
/ make everything give an error if the inputs are something that aren't understood - as far as possible within patterns
- add in `stack` - and a load of other pattern funcs, so they're available in the editor. also add to monkey tests
/ update Claude with my revealed preferences


- allow setting each pattern in a stack (either kind) to have a different seed for randomness. or just apply a function like `(x, i) => x.add(i)`

/ add curry, compose, stack, cat (and variants)
add all and each


if it fails, keep rendering the old one


add methods to crop to certain part of the source image/vid

gridStack.scale(.5) should shrink the grid, not the videos within
same with .x


shape:
natural
square
landscape (16:9)
portrait (9:16)
circle
blob (animates)
hex


circleStack (arranges stuff in a circle, there's an offset param if you want it to spin, and a radius one too (defaults to .4))


gridStack should take a single source, and if we only pass in col it should duplicate it for rows



array functions!

we should be able to use a pattern to pluck elements from an array by index. maybe we can already, tbh

we should be able to zip x sequences together

we should be able to insert a value at index i into a generator. at an array of indexes

let's also have grid() set the seed




from:
https://github.com/switchangel/strudel-scripts/blob/main/prebake.strudel


/* Executes a function when a specific control key matches a specific value. For example

$: s("bd hh sd hh").filtval("s", "bd", x => x.duck(2))

To only have the kicks trigger the sidechain

*/
register('filtval', (key, val, func, pat) => {
  return pat.when(
    pat.fmap((v) => v[key] === val),
    func,
  );
});


- we could use this to set `i` on grid children, then only trigger stuff for particular `i`s

look at bind functions - they talk about patterns of patterns
node_modules/@strudel/core/pattern.mjs:266
can we do this instead of arrays-of-functions?

but it needs to apply to the output of the gridstack, because inside they haven't been set yet



what if we sample temporal sequences in order to make them spatial. use current cycle, sample across it `i` times. 

Claude:
```
but it would mean i could reuse existing pattern-of-pattern functions rather than reinventing them?

i guess if i sampled the pattern passed to gridStack across the length of a single cycle (taking `i` number of equally spaced samples), then that could work? to turn a temporal sequence into a spatial one?
Read grid-stack.ts
Yes, exactly right. The core of your idea:


// sample the pattern at N evenly-spaced points to get N child patterns
const childAt = (pat, i, n) => pat.queryArc(i/n, (i+1)/n)[0]?.value
Then gridStack becomes:


export function gridStack(children, cols=2, rows=cols) {
  return new Pattern((state) => {
    const { begin, end } = state.span;
    const c = resolveNum(cols, begin, end);
    const r = resolveNum(rows, begin, end);
    const n = c * r;
    const childPats = Array.from({length: n}, (_, i) =>
      children.queryArc(i/n, (i+1)/n)[0]?.value
    ).filter(Boolean);
    return stack(...childPats.map((child, i) =>
      child.gridModulo(i, n, c, r)
    )).query(state);
  });
}
And the user-facing API becomes:


gridStack(sequence(color("red"), video("a.mp4"), color("blue")), 2, 2)
// or even with mini notation:
gridStack(mini("red green blue").color(), 3, 1)
What you get:

Arrays-of-patterns disappear — just pass sequence(...) or any pattern whose values are patterns
The existing iterable path also goes away
cols×rows sampling reuses Strudel's sequencing as a spatial lookup table
The "cycles children" behaviour falls out naturally from how mininotation sequences work
One wrinkle: the sampling happens at [0, 1/n, 2/n...] in cycle-space, which is relative time. If the outer pattern changes across cycles (e.g. slowcat(p1, p2)), different cycles would assign different children to cells. That could be a feature or a surprise — worth deciding whether gridStack should always sample at cycle 0, or at the current begin.

The current code has three separate code paths (array, single pattern, iterable) — this collapses it to one. That's a meaningful simplification and it's much more "Strudel way."
```

would lose the cycling/indexing children default behaviour - instead it would, for `gridStack(mini("red green blue").color(), 3, 3)` create red at the top of the screen, green in the middle, and blue at the bottom. but you could do something with fast to fix that. or you could sample at the start of each cycle and then do `gridStack("<red green blue>".color(), 3, 1)`. or maybe that's `slowGridStack`.

and then also pass in i & row, col?
also want a way to represent the nested nature of the grids? don't know how this works...



... hm.
or, simpler:

`allatonce` takes a pattern, queries it over (0,1) and it makes every hap last the entire cycle


`stackN(n, ...pats)` takes a pattern and stacks it with itself n times
if passed an array of patterns, it cycles through the patterns to make up to N


`index(...pats)` takes a pattern or a list of patterns
it stacks the patterns
it adds `i` to each currently active pattern at the current query time
and adds `count` to each (the numbers of patterns active)

if we call it like this: `index(["a b", "e f"], ["c d"])` it flattens the array structure - same as `index("a b", "e f", "c d")`


`indexCycle(...pats)` takes a pattern or a list of patterns
it labels haps in their natural order, iterating and adding i
and adds `count` to each (the numbers of patterns)

`indexWith(iLabel, countLabel,  ...pats)`
does the same as `index` but it uses label instead of `i`

`indexCycleWith(iLabel, countLabel, ...pats)`
does the same as `indexCycle` but it uses label instead of `i`

.count(n)
sets count to n (can be a pattern, obv)

.i(i)
sets i to i (can be a pattern, obv)

.rows(n)
sets rows to n (can be a pattern, obv)

.cols(n)
sets cols to n (can be a pattern, obv)

.rowscols(n)
sets rows and cols to n (can be a pattern, obv)

.grid(rows, cols, i)
sets x,y, w, & h such that it's in the right place for a grid rows wide and cols tall, with index i (within existing x, y, w & h). also accept negative indexes, counting back from the end - last write wins rules. all the arguments are optional - they'll be taken from the value if they're not set on the method. if only one of rows or cols is set, the other one is taken to be 1. if neither is set, default to 2x2


.gridMod(rows, cols, i, count)
sets x,y, w, & h such that it's in the right place for a grid rows wide and cols tall, with index i (within existing x, y, w & h). it repeats elements after it hits count (unless they happen to be present - but the repeat starts when the count is hit). also accepts negative indexes - last write wins. all the arguments are optional - they'll be taken from the value if they're not set on the method. if only one of rows or cols is set, the other one is taken to be 1. if neither is set, default to 2x2



and we can also use plain old `stack` and `fmod` to set extra elements:




so then: we can do:
```js
stack(video("blue.mp4 goslings.mp4"), video("red.mp4 scales.mp4")).indexNow().stack(video("last.mp4").i(11)).rowscols("3 4").grid()
```

and we'll get a grid which alternates between checkerboard arrangements of blue and red, and goslings and scales, and which, every cycle, alternates between being 3x3 and 4x4. and then the bottom right cell is always last.mp4






.radius

.startOffset

.circleCount

.circle(radius, startOffset, circleCount, i)
like grid but places each screen where it would be if they were all arranged in a circle. radius is expected to be 0-0.5 (screen coords), start offset goes from 0-1 (turns). count is the number of elements to place in the complete circle. all arguments optional, in which case they're taken from values

.circleMod(radius, startOffset, circleCount, count, i)
like gridMod, but for circles. as above.

.autoseed()
does the same as `index`, but sets `seed` on them instead, hashing their index and their values


`allatonce` takes a pattern, queries it over (0,1) and it makes every hap last the entire cycle


`stackN(n, ...pats)` takes a pattern and stacks it with itself n times
if passed an array of patterns, it cycles through the patterns to make up to N




sync()
sets start to the current time in the cycle, so that videos appear to play freely, rather than resetting at the end of events



video element system:
- we have a pool of video elements we can pull from for displayed screens
- when getting a video element for a newly shown screen, try to find one which is both showing the right video, and at the right seek position
- if multiple screens are showing the same video at the same seek position, at the same speed, they can share it (this is quite common with the way we do stacks)
- maybe we wan tto use this same logic for canvas elements and images?
- also we probably want to pull videos in as blobs so we can create new video elements quicker. idk - maybe this isn't worth doing and the browser cache mechanisms are better
- next step, and here's the cool bit: we query a little ahead of the current position, to understand what screens will soon be displayed. we can then get these warmed up in advance, seeked to the right place, etc

does the pool matching work when looping a short section of the clip?
does the pool matching take into account sync?
yes - we use `video playback identity (src+speed+start+end+eventBegin).`
(possibly we can do better?)


does the video sharing take into account slight drift between the video clock and the strudel clock? or isn't that a thing?

does prewarm create elements when the pool already has some? does it prefer to seek rather than make new elements?

perform experiments to test what the correct scoring function is
perform experiments to test what the correct look ahead function is


autoseed doesn't work. can it work?? can we make a new RNG function, like precise is new?
could we bundle this behaviour into stackN etc?


video loader:
it's a list of elements that maps onto a js dict
it looks like [tiny thumbnail] | name | url | [delete button]
you can edit the name and urls
there's a box to add a url at the top
when you add a URL the name is populated with the filename without an extension
if there's a name collision, then add a postfix with a number to it
if you paste a YT video url, we send it to the server and replace with the url the server gives us
if you use a video name in video it checks against the video list to resolve the url - skipping urlBase entirely
oh, also it should work for images, too
also we want an export button and an import button - import adds to the list, export exports the whole list. i think it just copies JSON to the clipboard. oh, and a clear button, with a confirm step.


.start(0.5).end(0.7).start(0.5) should leave start at 0.6 - if this is possible?



currently working on:
/ videos no longer reset at new events - fixed?
/ add `screen` function - takes a loaded video url, or a colour, or an image

fix up sidebar so it works nicer

betetr way to sequence multiple clips which have their own properties set, so they play in order - add sequence to top level?

better way to do the iframe transcoding for locally downloaded files via the media panel


oh - we could use filtval on i to replace a grid square! rather than stacking a replacement i... oh. only if we'd done stackN. so not in the general case.


what if gridMod etc implicity ran index(), except it didn't overwrite previously set index on elements?


# randomness

look at: 
https://strudel.cc/learn/random-modifiers/
and 
https://strudel.cc/learn/signals/

since we have a different default mode for combining patterns, many of these are no longer useful - for example, `note("c2 g2!2 d2 f1").s(choose("sine", "triangle", "bd:6"))` works in Strudel - each note gets a new sound assigned, but `$: screen("snowball/3,snowballs/4").alpha(choose(.2, .7))` doesn't make sense - each frame gets an new alpha assigned. but if we did `$: screen("snowball/3,snowballs/4").alpha(sine.range(.2, .7))` then that would be the desired behaviour. and similarly, `$: screen("snowball/3,snowballs/4").alpha(".1 .2 .3 .7)` would also do the right thing (step through opacities while showing the current videos). there's a thing here where the natural behaviour is a little bit of one and a little bit of the other - that's a good thing, that's what's interesting about this project!

anyway - let's make a plan for replacing many of the random functions within Strudel. we want them to take a per-event value. while others evaluate per frame. in fact, as a first step: what functions are there that use randomness? which ones use signals? make a table and then i can indicate what behaviour i want for each.

the other aspect to this is that uzuvid has a lot more simultaneous instances of the same pattern going on. in fact, there's both explict and implicit stacking - places where we deliberately duplicate a pattern (`stackN`) and places where we implicitly duplicate it (`gridMod`). we want to make these parallel copies show different things when a random function is applied to them - at the very least across `stackN`, and maybe also things like `gridMod`. i think ideally we drop the idea of `autoseed` all together and just change fundamentally how randomness is dealt with - replacing a bunch of the random functions with our own. but then the functions we do want to leave intact will also have to work with that...

the larger context here is that i am fine with deviating from the known random functions in Strudel for ones which fit our way of working, if that's better. obviously, use what we can --


wait, can we use the existing random seed also as an input to the random seed? that should mean a nested pattern of grids-within-grids shouldn't sync up...


## grid stacking context

scale after grid mod should scale the grid? no, actually scale doesn't operate on that, it's on videos


/ add rotateX, rotateY, rotateZ
/ operates on turns



Strudel methods don't use setMixParam - this might be surprising?
check how Strudel methods compose now we're using out own custom combinator.


/support chop
/chunk

/need to rename fit, so we can support fit
/also loopAt etc

/check - how does strudel handle the begin:0, end:1 stuff?
/.scrub(v).chop(8) - why does this return black?

adding streams:
- add live thumbnail
- can we seek in them at all? no



if we hit an error, keep running the old code!


/ why do we have both poolkey and sharekey?

play audio


/ change sync to set offset in fractions of the video (or absolute times)

/allow searching the reference, and make the text bigger!


/ add a function to load a video to the library from code
change examples to use stuff from the library
then add to examples, to make them self contained


move webcam & screen buttons to next line.



/ a bunch of errors to do with set.mix clipping stuff to a single cycle rather than allowing it to be more than one cycle long. can we change this behaviour fundamentally?


/ instead of querying a small span, can we query at a single instant? yes. implement this.


change tests to not download from YT - should run faster? or i guess they're hitting the media server cache, so this shouldn't actually be an issue

/ can we remove _onset entirely? yes





after playing for a while, running `$: s("snowball").chop(8).alpha(0.5)` gives a white flash and a pulse out of position between each chop. doesn't seem to recur on refresh

`$: s("snowball").slow(8).chop(8).scrub(sine)` does not scrub within each slice - only shows single frame for each

`$: s("snowball").scrub(sine).chop(8)` also only shows a single frame (the same as `$: s("snowball").scrub(0.5)`)

when i run 
```
$: s("snowball").begin(.5).end(.6).fit()
$: s("snowball").begin(.5).end(.6).fit().chop(8).blend("difference")
```
i can see little ghosts from minor differences between the two outcomes. shouldn't they be coming from the same video element?


can we make it so `$: s("snowball").slow(4).sync().speed("1 2")` makes it so that the speed changes, but it continues from the current play position as it does so? like, sync() should compose on top of existing pattern modifiers. this might be a bigger design task, to understand how that should work at an underlying level.

loopAt(2).slow(4) should differ from slow(4).loopAt(2) - i think. first should play the whole video in 8 cycles, second should fit the whole video into 2 cycles
maybe not - we do our loopAt differently to Strudel, they have a unit system and we don't. let's check on their unit system


write an explanation of createMixParam. give examples of it working on: single values, discrete patterns (of cycle length 0, 1/3, 1/2, 1, 2, 16), signals, random values. for both sides of the operator. all the combinations of those values.

/ add slider()





.tile() - like grid but it places every stacked pattern in it's own cell, varying the number of elements in a row to achieve this

.stackFlat() - flatten nested stacked patterns

.shuffleStack("1 2 3 4") - randomise order of stacked patterns - uses pattern as seeds for randomisation, and pattern for when rand events span - so "1 2 3 4" changes 4 times a cycle, and repeats random pattern every cycle. without any arg, randomises once per cycle.


`$: s("snowball").sync().begin(saw).speed(1)` - flickers

/ can we unify some of the inverted range handling code? it seems like it's spread across a bunch of places, when it should all behave the same






nested grids

what if... gridMod and grid and all the rest also set some `nesting` param? or maybe we even have some valur which represents nesting of patterns, visually. like, `screen` gives all screens an id, and then we can set a `parent` value which refers to one of those when we do repeated gridMod or whatever calls? and then we use that parent value



what if gridMod() etc overrode `i` when it did layout - but i guess two sibling gridMods wouldn't be able to coordinate on assigning `i`. 

what if... gridMod gave all screens it was laying out a value like `layoutParent`: `uuid` (same uuid for each screen laid out with gridMod). then index and all similar `i` assigning functions logically groups all stacks with the same `uuid` set as a single child when assigning indexes? 

i guess shuffleStack could be unaffected, it doesn't touch `i` or `count`. 

this would be a lightweight way to get a scene graph type situation - but still functionally applying values at each step. the downside is the magic in gridMod and index etc. but that feels okay, if it operates a way that feels natural.

maybe come up with several cases when evaluating options. we want:
- nested grids
- circle in a grid
- fucking with a deeply nested screen within a grid-of-grids
- animating everything positionally at the end
- maybe others?


---




toOps -

doesn't seem to be working
make a function form
add to sidebar ref
mulTo("x", 2) when x isn't set will set to 0, but should set to 2 - identity for mul is 1, not 0



