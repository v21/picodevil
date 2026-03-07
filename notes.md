# uzulang video

how to specify where the video is drawn?

I think each vid sets its position itself. in 3D space. in one of 2 coord systems - ortho (Z is depth, 0-1 x y is screen bounds) or perspective (uhhh... more complex. also the perspective can have diff cam params. maybe this comes later and there's a func you can apply to get it into 3D screenspace). anyway, also this makes rotations trivial.

and then... and then there's shorthand for 4up, 2up etc. I guess to swap quickly between them... you just change the Z of something? ooor... something? it's not a property of each video stream it's a property of the whole? but each does wanna control it itself?

so maybe there can be a central pattern each can consume? 

a problem to solve after.


properties of each vid:
- src 
- loop start
- loop end
- (or length - overrides end if set)
- play speed (can be neg)
- position (last set of width height top left right bottom centerX centerY)
- blend mode
- opacity
- tiling??

can also set playhead, which sets both loop properties to that val. if that's the case, speed doesn't apply

can also set position via grid(i, x, y) - puts the vid in the position it'd be in for a grid of x by y

can also do addition etc on these properties

a video can also be an image, in which case it doesn't play

or a live stream from other tab or window or whatever. or a webcam.

each prop can be set via a mini notation pattern
can also be smooth()ed? linear or splined
can also be a JS function with an arg of time - hmm, maybe this is smth where 1 = 1 cycle, and frac is pos within cycle.

global cps setting - which can be fixed or can listen to sounds to pick up beats. or tap it in.


what if a grid prop indexes into an array of videos. would allow a _lot_ of videos playing at once (as long as they played the same)



sample bank pane:
sample name => url
(and a handy shortcut for getting them via a YT url)

```
vid("scales")
.start("0 0 .2 3s 4s 500ms")
.duration("100ms 100ms")
.speed("<1 1 -1 1>")
.


```



```
return video("iDcekQeBGOY.mp4 aGMOFLgB1CU.mp4").speed("0.5 1 -1")



do we wanna reset pos every loop? right now the pos is a drifting variable which can move... we can do this with scrub