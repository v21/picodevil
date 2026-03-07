


next steps:
/ persist state between refreshes
- ~ is transparent
- sample bank pane
- multiple videos
- position videos on screen
- grid logic
- tap to set cps


code quality:
- extract video playback logic from main.ts render loop 
- make uzuEval less fragile (auto-thread new API functions instead of manual arg list)
- show eval errors in the editor, not just console
- fix timing: changing CPS mid-performance causes discontinuous jump (need phase adjustment)