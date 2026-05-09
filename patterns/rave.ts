
$: s("all").scale("1.01").grey(slider(3.66, -2, 5))
.huerot(sine.range(-.01,.01).slow(10))

$: s("<algorhythms3:.4:.5 algorhythms2:.8:.9>/2").fit().mulOn('speed',"<1 -1>")
  .w(sine.range(-.5,1).slow(2)).h(sine.range(-.5,1))
  
  .alpha(slider(0.711))

$: s("algoravelogo").objectfit("none")
  .w(sine.range(-.5,1).slow(2)).h(sine.range(-.5,1))
  .alpha(slider(1.00))
.blend("add")

$: s("speedracer").rolling()
  .speed(sine.slow(5).range(.1,2))
  .w(sine.range(.5,1).slow(100)).h(sine.range(.5,1).slow(100))
  .alpha(slider(0.423))