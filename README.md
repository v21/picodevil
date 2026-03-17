# uzuvid (temporary name)



This is a livecoding tool that runs in the browser. It allows you to sample, cut up, and generally fuck about with videos. It's based on Strudel, adapting it's capabilites to make more sense for visuals than for audio.

It's built by V Buckenham - hello! This is my first time building a tool where I have used LLM assistance in a major way. I feel uncertain about it for many reasons! But here we are.

## How to use

This is currently not hosted anywhere, so to use this, you will need to clone the project and run it locally. 

You can do this by running:
`npm run start` in the main folder
and `npm run start` in the subfolder "server" (needed to download videos from YouTube)

And then opening [http://localhost:5173/](http://localhost:5173/) in your browser (currently only tested with Chrome)

How to write code in it is outside the scope of this readme, but: write some code into the window, and press Ctrl-Enter to execute it. You can load videos by opening the sidebar - click the little arrow on the right hand side of the window. You can also see the command reference in there!

## Differences from Strudel

How does it work? Good question.

As said above, it extends Strudel. So many of the methods and conventions of Strudel apply. But when rendering video rather than audio, you end up wanting to show more things simulatenously. You care about the spatial position of items. And you have a different relationship to events.

### First difference: Structure doesn't just come from the left

In general, Strudel operates by setting the pattern of notes from the leftmost pattern, and then mapping the properties of subsequent patterns onto those. Uzuvid instead takes the intersection of the patterns. A practical example: In Strudel, if a note is playing and the gain is changed halfway through, the note will continue at the same volume, and subsequent notes will have their volume changed instead. In uzuvid, if a video is playing and the alpha of that video is changed halfway through, the change in alpha will take effect immediately.

There are some exceptions. Every time there is a new video event, we start from the `start` point. We don't want this to be reset whenever a different event occurs (not least because the way that Strudel handles events means that they won't last more than a cycle). So we store a special `_onset` value when a video event starts, and use that to calculate the offset instead.

(There's also a `sync()` method you can use to play videos all the way through rather than resetting to the start with every event)

### Second difference: We render frames rather than events

Strudel looks ahead and queues up notes with precise timing. Each note is sent as a new event, with it's timing information attached. uzuvid runs at the browser's preferred framerate (using `requestAnimationFrame`). We sample all the events playing at the current time, and we render those. If an event falls between frames, it won't be rendered. If two events are identical, and we miss the end of one and the beginning of another - it will be rendered exactly the same as if the event did not end and begin again. As you can imagine, this combines usefully with the first event

### Third difference: uzuvid is more interested in signals & continous events

As we're sampling every frame, it becomes more natural to use continously changing parameters in more places. Varying something by sine makes more sense if you are going to be sampling a new value for sine every frame. 

As such, we've added a few new functions for creating smooth signals - `lerp` and `spline`. These are inspired by `Hydra`'s `smooth` method - they allow you to convert a discrete pattern into a continous one.

### Fourth difference: randomness

A lot of the built in random functions are not that helpful when you're sampling every frame. `rand`, for instance, by default ends up creating a new value every frame - you just get flickering. Sometimes you want flickering, but not that much. 

As a result, most of these random functions have been patched so that they use as an input the onset time of the events the apply to, rather than the start of the span that has been queried. This happens via the `_perEvent` tag applied to pattern objects (and via a Proxy wrapper which ensures it survives method chains and allows us to patch this change in when resolving events with `createMixParam`)

### Fifth difference: indexing elements of a stack

In Strudel, you often create "stacks" of patterns - multiple patterns that run in parallel. In uzuvid, you do this even more so! Frequently, you want to say something like "play this video 16 times in parallel, in a 4x4 grid, and change one of those instances to be a little different". This brings about a few questions: 

*How to tell it to render the same thing 16 times in a row?* You use `stackN(16)` on it.

*How to then take these 16 elements and treat them differently for the purposes of positioning them in different places on the screen?* `stackN()` (and `index`, and others) labels each parallel pattern with the values `i` and `count`, allowing future methods to treat each one differently.

*Okay, and how do you actually put them in a grid pattern?* You call `grid` on them. This can be used to place a single video in the place it would be if it was in a grid of `row` rows and `col` columns, with index `i`.

In practice, you don't always need to call `stackN` on videos to make them render side by side - for example, `gridMod` will automatically do that math so that indexes will be cycled as necessary in order to fill all the spaces.

### Sixth difference: I mean it's for rendering video

It has a bunch of functions which relate to rendering visuals on screen, setting timings for videos, positioning in coordinate space etc. Let's get into some of those details more clearly.

## Visuals

### Nested coordinate system stuff
grids within grids

### i-frame encoding so that we can play videos backwards

### 
