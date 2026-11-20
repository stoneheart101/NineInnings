# Nine Innings

## Mobile is a core principle

Every layout, type, color, and interaction change is reviewed for a narrow phone and a short landscape screen. A desktop-only screen is unfinished.

- The page scrolls once. On a small or short screen, do not put a second scroll inside the game screen.
- The inning scoreboard may scroll sideways on its own. The rest of the page does not.
- Touch targets are at least 44px when the pointer is coarse.
- Inputs stay at least 16px so a phone browser does not zoom the page when a field is focused.
- Use `dvh` and safe-area insets. Do not lock the screen to a 4:3 box when the viewport is short or narrow.
- Hover styles apply only when the device can hover.
- The field green lives in `--field`. Keep it easy on the eyes. Do not use a neon green.
