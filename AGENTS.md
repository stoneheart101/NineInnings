# Nine Innings

## Responsive layout is a core principle

Every layout, type, color, and interaction change has to work from a narrow phone through a wide desktop. A layout that only fits one size is unfinished.

- The header shows the baseball diamond as a logo at the top left, the site name NineInnings beside it, and the coach's name as the user menu on the right when they are signed in. The diamond is not a game view and has no control.
- The diamond scoreboard and the outs counter are not on the page. The nine-slot lineup card lives on the team page. Navigation is a tab row under the header. It does not scroll. The body under that row holds the rest of the work.
- That body fills the viewport under the header and the tab row and is the only scroll region. The header and the tabs stay put. Do not add a second page scroll.
- Size type and density from the field container. Do not switch the whole layout at one phone breakpoint.
- The header has to fit a narrow phone: the site name and coach name can truncate, and the logo stays visible.
- Touch targets are at least 44px when the pointer is coarse.
- Inputs stay at least 16px so a phone browser does not zoom the page when a field is focused.
- Use `dvh` and safe-area insets.
- Hover styles apply only when the device can hover.
- Field green is `--field`. Fielders are `--player`. Keep the green easy on the eyes, and keep the fielders dark enough to read on the white bases.
