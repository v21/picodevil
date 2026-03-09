


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