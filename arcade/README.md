# Arcade

A phone-first launcher for the games in this repo. Built to be bookmarked or
added to the iPhone home screen, where it runs full screen with no Safari chrome.

Live at **https://mioutic.github.io/games/arcade/** once GitHub Pages is enabled
(Settings → Pages → Deploy from a branch).

## Adding a game

Drop a folder into `arcade/games/` with an `index.html` inside, then push:

```
arcade/games/my-game/
  index.html
  game.json      # optional
```

That's the whole process — there is no index to hand-edit. The launcher lists
folders through the GitHub contents API, so a new game shows up on the next
refresh (pull down on the grid, or tap the refresh button).

### game.json

Every field is optional. Without the file, the title is derived from the folder
name and the tile gets a colour picked from the folder name's hash.

```json
{
  "name": "My Game",
  "emoji": "🎯",
  "description": "One line, shown under the title.",
  "color": "#4aa8ff",
  "entry": "index.html"
}
```

## Notes for game authors

Games load in an iframe, so keep them self-contained — relative paths only, no
external CDNs if you want them working offline. For a phone, these help:

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`
- `touch-action: none` on anything you drag or swipe over
- `env(safe-area-inset-*)` padding so nothing hides under the home indicator
- `localStorage` for high scores — it persists per game

`games/reflex/` and `games/snake/` are working examples of all of the above.
