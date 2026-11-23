# Nine Innings

## Responsive layout is a core principle

Every layout, type, color, and interaction change has to work from a narrow phone through a wide desktop. A layout that only fits one size is unfinished.

- The screen fills the viewport and the diamond takes leftover space. The page does not scroll when the scoreboard, lineup, and prompt fit.
- The bottom menu has a stable height from the viewport. The diamond does not resize when that menu's contents change. A taller menu scrolls inside the menu.
- When the viewport is shorter than that content, the screen scrolls. Do not clip the prompt, and do not add a second page scroll.
- Size type and density from the field container. Do not switch the whole layout at one phone breakpoint.
- The lineup, through the home bullpen, sits above the field and the outs.
- The scoreboard fits the field width. Do not make the page scroll sideways.
- Touch targets are at least 44px when the pointer is coarse.
- Inputs stay at least 16px so a phone browser does not zoom the page when a field is focused.
- Use `dvh` and safe-area insets.
- Hover styles apply only when the device can hover.
- Field green is `--field`. Fielders are `--player`. Keep the green easy on the eyes, and keep the fielders dark enough to read on the white bases.
