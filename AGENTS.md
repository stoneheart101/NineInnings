# Nine Innings

## Responsive layout is a core principle

Every layout, type, color, and interaction change has to work from a narrow phone through a wide desktop. A layout that only fits one size is unfinished.

- The header shows the baseball diamond as a logo at the top left. When you have a team in the open season, that team's name, season, and purse sit to the right of the diamond. The seasons list leaves that spot empty. NineInnings sits above the coach's name in the top right. The diamond is not a game view and has no control.
- The diamond scoreboard and the outs counter are not on the page. Each roster kid has a position picker at the bottom of the card, kept to the left. The default is BENCH, in grey. A chosen position is pink. Positions already held by another kid are grey in the list and can still be chosen, which swaps the two kids. The clubhouse lists available items on its own tab, and the buy button names the cost. DRAFT stays in the menu after the draft is complete, and SEASON says THE DRAFT IS COMPLETE. The commissioner presses PLAY BALL on SEASON to make the season active. SEASON says how often practice games come, how many weeks it lasts, and how many rounds the draft has. SEASON, TEAMS, SCHEDULE, and THE POOL are subtabs on that page. An active season opens on SCHEDULE. On the schedule, your team is blue. In a matchup, your team is pink. A game within 10 days shows each weather chance that is at least 10 percent, highest first. A later game is listed without that forecast. The schedule opens the matchup. Your nine and packed items sit in one box. LOCK is a button at the bottom right of the next scheduled game only. A game after that says LOCK THE NEXT GAME FIRST. The other side sits in a box below, as locked or still open. After both sides lock, the commissioner can press PLAY THIS ONE. The matchup then shows that game's line score, a line for each kid, and a short writeup of the day. A bye is named and is not a game. OPEN A SEASON sits above the seasons. With a season open, the seasons sit in a row on that same screen, the open one is marked, and the season sits under the row. The menu is SEASONS, DRAFT, ROSTER, and CLUBHOUSE. The coach's name opens the rules version, the team list, and SIGN OUT. The row does not scroll. The body under that row holds the rest of the work.
- That body fills the viewport under the header and the tab row and is the only scroll region. The header and the tabs stay put. Do not add a second page scroll.
- Size type and density from the field container. Do not switch the whole layout at one phone breakpoint.
- The header has to fit a narrow phone: the team name, the site name, and the coach name can truncate, and the logo stays visible.
- Touch targets are at least 44px when the pointer is coarse.
- Inputs stay at least 16px so a phone browser does not zoom the page when a field is focused.
- Use `dvh` and safe-area insets.
- Hover styles apply only when the device can hover.
- Field green is `--field`. Fielders are `--player`. Keep the green easy on the eyes, and keep the fielders dark enough to read on the white bases.
