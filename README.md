# picodevil

This is a livecoding tool that runs in the browser. It allows you to sample, cut up, and generally fuck about with videos. It's based on Strudel, adapting it's capabilites to make more sense for visuals than for audio.

It's built by [V Buckenham](https://vbuckenham.com/) - hello! Let me know if you find bugs or make anything cool with it! 

This is my first time building a tool where I have used LLM assistance in a major way. Sorry if that upsets you! I feel uncertain about it for many reasons! But here we are.

## How to use

The easiest way to use Picodevil is to go to the hosted version at [picodevil.com](https://picodevil.com/). You can poke at the examples in the right hand sidebar, load them up, change some stuff, and then press Ctrl-Enter to see the results.

You can also load videos by opening the sidebar - click the little arrow on the right hand side of the window. You can also see the command reference in there!

There's also a optional server, which will let you do things like transcode videos so they can be scrubbed backwards, and allow downloading from YouTube - see [picodevil-server](https://github.com/v21/picodevil-server) for details.

## If you want to run it locally

You can do this by cloning this repository (or downloading it), and then running:
`npm run start` in the main folder

Then opening [http://localhost:5173/](http://localhost:5173/) in your browser (currently only tested with Chrome)

## Differences from Strudel

How does it work? Good question.

As said above, it extends Strudel. So many of the methods and conventions of Strudel apply. But when rendering video rather than audio, you end up wanting to show more things simulatenously. You care about the spatial position of items. And you have a different relationship to events.

### First difference: Structure doesn't just come from the left

In general, Strudel operates by setting the pattern of notes from the leftmost pattern, and then mapping the properties of subsequent patterns onto those. Uzuvid instead samples all patterns at the current time, and applies all of them to the current sources. This means that doing something like `s("ducks").scrollx(sine)` will smoothly scroll the video from right to left, rather than only sampling the position whenever the video changes. Whereas in Strudel `s("saw").gain(sine)`, a saw wave will be played every cycle, and it will sound the same throughout because the gain will only be set at the beginning of the sample.

### Second difference: We render frames rather than events

Strudel looks ahead and queues up notes with precise timing. Each note is sent as a new event, with it's timing information attached. uzuvid runs at the browser's preferred framerate (using `requestAnimationFrame` - in practice probably something 60FPS, or 120FPS if you're fancy). We sample all the events playing at the current instant, and we render those. If an event falls between frames, it won't be rendered. If two events are identical, and we miss the end of one and the beginning of another - it will be rendered exactly the same as if the event did not end and begin again. 

### Third difference: uzuvid is more interested in signals & continous events

As we're sampling every frame, it becomes more natural to use continously changing parameters in more places. Varying something by sine makes more sense if you are going to be sampling a new value for sine every frame. 

As such, we've added a few new functions for creating smooth signals - `lerp` and `spline`. These are inspired by `Hydra`'s `smooth`  method - they allow you to convert a discrete pattern into a continous one : `"0 1".lerp()` smoothly moves from 0 to 1 over the course of a cycle (and then back again).

### Fourth difference: indexing elements of a stack

In Strudel, you often create "stacks" of patterns - multiple patterns that run in parallel. In uzuvid, you do this even more so! Frequently, you want to say something like "play this video 16 times in parallel, in a 4x4 grid, and change one of those instances to be a little different". Let's build that up: 

*Play a video*: `$: s("ducks")`

*Play a video 16 times, all in sync*: Use `stackN` - `$: s("ducks").stackN(16)`

*Take these 16 elements and then lay them out side by side on the screen, rather than on top of each other*: You index them, to add `i` and `count` values to each one so that patterns can distinguish between them. This looks like `$: s("ducks").stackN(16).index()`, except actually `stackN` already does an `index` for you, to be helpful. But something like `$: s("ducks, canalboat")` needs an index added.

*Actually put them in a grid pattern*: You can now call `tile` on them to do the layout: `$: s("ducks").stackN(16).tile()`. Tile looks at the `count` value and tries to figure out a grid that will accomodate that many items.

*Wait, but what if I have 15 items stacked?*: Yeah, one row (the last one) has 3 columns instead of 16. If you want a fixed number of rows and columns, you can add `rows` & `cols`, then lay it out with `grid`: `$: s("ducks").stackN(15).rows(4).cols(4).grid()`. Or, if you want the items to repeat after they run out, you can use `gridMod`: `$: s("ducks").stackN(15).rows(4).cols(4).gridMod()`

*Drawing one element*: We can also use `i` and `count` to manually set the index and count on a single element. This lets us draw to a particular point on a grid... So, we could do: 
```js
$: s("ducks").stackN(15).stack(
  s("canalboat").i("<0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15>").count("16")
).rows(4).cols(4).grid()
```
and now there's a video of a canalboat drawing over each cell of the grid of ducks in turn.

### Fifth difference: seeding randomness

One thing you might want to do is to put in a grid of videos and then use something like `sometimes()` to apply extra things to a subset of randomly chosen cells. Strudel has an admirable commitment to determinism, and seeds it's randomness from the onset time of events. This means that all the cells in a grid like above would have the same random seed, and would all pick the same outcome. As such, when you use `index()` (or something that calls it, like `stackN()`), it also sets a `_randSeed` value on the item, and we modify random functions to use that as part of the seed. The upshot of this is that
```js
$: s("ducks").stackN(16).sometimes(speed(-1)).tile()
```
makes a grid of ducks, some of which are moving backwards.

### Sixth difference: stack ordering

The order of a stack matters. What does that mean? It means if you do:
```js
$: s("ducks, canalboat").rows(3).cols(3).gridMod()
```
You'll get a 3x3 grid of ducks and canalboats repeating, with ducks appearing in the corners. But if you do

```js
$: s("canalboat, ducks").rows(3).cols(3).gridMod()
```
You get the canalboat footage in the corners.

If you want to shuffle that order, you can do... well, actually there's only two items, so there's only two orders you can have. We've seen them both already. But if we do 

```js
$: s("canalboat, ducks").stackN(5).rows(3).cols(3).gridMod()
```
Then there's now 10 items, distributed in 9 slots, which looks the same as repeating two of them across those 9 slots. But then if you add
```js
$: s("canalboat, ducks").stackN(5).shuffleIndex().rows(3).cols(3).gridMod()
```
You now shuffle all the `i` values passed through, and now you have a jumble of 5 `ducks` and 5 `canalboat`s in the grid. Which is a nice way to add a bit of interest. By default, this shuffles with a fixed seed, so you always get the same jumble for a given input. If you want to vary that every cycle, you can:
```js
$: s("canalboat, ducks").stackN(5).shuffleIndex(rand.segment(1)).rows(3).cols(3).gridMod()
```
(rand gets rerolled every frame, as we don't have the idea of events - so we need to segment it so we get something fixed for each cycle)

### Seventh difference: Playing with playheads

As with Strudel, by default we play a sample from the beginning, at it's natural speed, for as long as the event that triggers it lasts. This means that our default ducks (`$: s("ducks`) play for one cycle, then reset back to the start, and do this repeatedly. 

You can of course change the speed (`speed`), and you can use Strudel functions like `fit()` to set the speed such that the clip will fit within a single cycle. And ggain, as with Studel, you can change where a video plays from with `begin()` - this takes a value from 0-1, which represents how far through the clip you want to start. You can also set the end of the loop with `end()`, same deal. You can also set this with `duration()` - these two are just different ways of setting the same thing.

There's also a shorthand for this, useful when you're making patterns out of different bits of the same clip: `$: s("ducks:0:.2 ducks:.8")` - this plays ducks twice within a cycle, the first time from 0 to 0.2, the second time from 0.8 to the end.

While retriggering samples from the start repeatedly is good for audio, it's not always the right fit for video. Sometimes you want the video to play according to an underlying clock, even when it's not shown. You can do this with `sync()`, which causes videoclips to play relative to the start of cycle 0. This means they play all the way through before restarting (or til the end of the loop, anyway). 

If you want to use `sync` on two instances of the same clip, but don't want them to match, you can pass in an argument - `sync(0.5)` and `sync(0)` will be half-the-clip-length offset from each other. You could use this like so:
```js
$: stack(s("ducks").sync(0), s("ducks").sync(0.5)).index().tile() 
```
To put two clips of ducks next to each other, each offset in playhead position. Which is a neat effect. In fact, it's such a neat effect that there's a shorthand for it:
```js
$: s("ducks").syncStack(2).tile() 
```
As well as `sync()`, there's also a `rolling()` mode, which works slightly differently. This means that Picodevil doesn't try to manage the position of the playhead, and lets it just... roll through. You can also apply both of these at the same time.

There's also another way to manage the playhead, which isn't actually a new way but really just an inventive way to use `begin()`. If you set `duration(0)` then the video will show a freeze frame. And if you instead drive `begin()`, say with a continuous signal like `sine`, you can scrub through the video - starting slow, rushing through the middle, slowing down at the end, before turning around and going back in reverse. This is neat enough there's a shorthand for it: `scrub()`.

### Eighth difference: It has layers, not just stacks

Let's go back to that idea stack:
```js
$: s("ducks, canalboat")
```
If you try this out, you'll notice that you only see the canalboat footage, and you don't see any ducks. This is because the canalboat footage has been drawn on top of the ducks. But you can draw things with transparency:
```js
$: s("ducks, canalboat").alpha(.5)
```
Hey, look, you can see them both! Kinda dark, because both are only half visible and there's a black background, but you can. Let's make only the canalboat footage transparent:
```js
$: s("ducks")
$: s("canalboat").alpha(.5)
```
Nice. We also have blend modes, so we could instead multiply the two feeds together:
```js
$: s("ducks")
$: s("canalboat").blend("multiply")
```

So far so cool. Now, in Strudel, the different lines following a `$:` are stacked together behind the scenes. We also do this. But, as we said before, in Picodevil, the ordering of stacked layers is important. One way it's important is that we also have some special values you can pass to `s()`. Like `"all"`. When you pass `all`, it renders out the whole screen as rendered so far as a pattern. So, for example:
```js
$: s("ducks").stackN(9).tile()
$: s("all").scale(0.5).grey()
```
Plays the `ducks` video, tiled 9 times, then layers in the center of the screen the same thing but in greyscale.

You can also reference `"prev"`, which gives you the output of the screen on the previous frame. This makes it easy to make feedback patterns:
```js
$: s("prev")
$: s("ducks").alpha(0.03)
```
Gives you a kind of temporal blur, smearing out motion over time.

You can also use the labels to pull particular layers in:
```js
quack: s("ducks").stackN(9).tile()
$: s("quack").cropStack(2,2).tile().scale(.9)
```
Makes that 3x3 grid of ducks, and then on top of that draws that grid, but sliced into a 2x2 grid, and scaled down a bit so you can see the other grid behind.

(Why do we need to use the label rather than just using `all`? Because if we use `all`, we'll sample the canvas even as we're laying out these 4 slices. They're each individual events rendering their own chunk, not a single sample that actually gets sliced up)

If you want to *not* render some things directly, but use them later on, then you can also do that - in the same way that Strudel lets you prefix lines with `M` to mute or `S` to solo, you can also prefix things with `H` to hide:
```js
Hquack: s("ducks").stackN(9).tile()
$: s("quack").cropStack(2,2).tile().scale(.9)`
```
Now you see black between each foreground chunk.
