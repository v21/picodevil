


next steps:
/ persist state between refreshes
/ ~ is transparent
- sample bank pane
/ multiple videos
- position videos on screen
- grid logic
- tap to set cps


bugs:
- animated GIFs don't play (only first frame shown)
  - canvas `drawImage()` from an `<img>` element only captures the first frame of animated GIFs in Chrome
  - possible fixes: (a) render image screens as DOM `<img>` overlays instead of canvas (stacking order gets tricky with mixed screen types), (b) client-side GIF frame decoding with a library like gifuct-js (needs CORS proxy for cross-origin URLs)

code quality:
- extract video playback logic from main.ts render loop 
- make uzuEval less fragile (auto-thread new API functions instead of manual arg list)
- show eval errors in the editor, not just console
- fix timing: changing CPS mid-performance causes discontinuous jump (need phase adjustment)