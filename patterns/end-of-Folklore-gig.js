

$: s("dvsa16 hlintro")
  .speed(4)
.rolling()
.cropStack("<3 16>","<3 16>")
.grey()
.tile()
// .syncStack(3)
//   .tile()
// .w(sine.range(.1, .2))
// .h(sine.range(.4, .1).slow(.25))
// .croph(saw.range(0, .2).slow(.25))
// .cropw(saw.range(0, .2).slow(.75))
// .pixelate("8 64 128")
.alpha(slider(1.00,0,1))
.blend('screen')





$: s("< droneindoor>/2")
  .fit()
  .speed(-1)
.rolling()
.grey(slider(0.920,0,1))
.pixelate("< 16 32 64>*2")
.alpha(slider(1.00,0,1))
.blend('multiply')



$: s("< beatsaber wipeout>/2")
.grey(slider(1.00,0,1))
  .scrub(saw.slow(3).range(.8,.2))
.alpha(slider(1.00,0,1))
.blend('multiply')
.stackN("4 8 16")
.tile()
.pixelate("<8 1 16>")


$: s("< dbn_sheep2 dbn_fireworks dbn_swim >").grey(slider(0.560,0,1))
  .rolling()
// .begin(".2 .7 .8")
// .addOn('begin', ".3 .1 .7 . 2")
.speed("<4 8 2>")
.pixelate("8 16 4")
// .speed(saw.range(5,3).slow(10))
.alpha(slider(0.0910,0,1))
.syncStack(4)
.tile()







































let sz = slider(0.0760,0,1)

_$: s("dvsa2 dvsa3 dbn_panup").speed(saw.range(.9,1.1)).pixelate("64 2 8 4").gray(slider(1.00,-1,1))
// .cropStack("<8 6 4 2>","<8 6 4 2>")
.cropStack("8,8")
  .syncStack(4)
  .index()
.tile()
.w(sz)
.h(sz)
  .cropw(.5)
.croph(.5)
  .shuffleStack()
.alpha(slider(0.533,0,1))