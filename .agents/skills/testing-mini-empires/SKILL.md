---
name: testing-mini-empires
description: How to run and test the Mini Empires browser strategy game locally (multiplayer server + static docs build)
---

# Testing Mini Empires

## Running the app
- Multiplayer client: `npm start` (runs `server/index.js`) → http://localhost:3000. Kill old process first: `fuser -k 3000/tcp`.
- Static single-player build: `python3 -m http.server 8080 -d docs` → http://localhost:8080 (uses `docs/local-server.js` as a fake socket; game ID shows "LOCAL").
- `public/` and `docs/` contain near-identical client code; test both when client code changes.

## UI tips
- Settings (⚙️), Wiki, Tutorial buttons only exist on the main menu screen — there is no settings access while in a game. Set graphics style before starting a match.
- Settings persist in sessionStorage key `me-settings` (per-tab, survives F5, not new tabs).
- The lobby "Add bot" button shifts down ~21px each time a player is added — re-locate it between clicks.
- Native `<select>` dropdowns don't change reliably via plain clicks; click to open, then use arrow keys + Enter.
- Double-click your capital tile to select the city; Esc deselects. Chat input is bottom-right.
- To prove animation ("New + animations" mode): take two zoomed captures ~0.5s apart of the same map region and `compare -metric AE a.png b.png diff.png`; diffs localize on unit sprites/flags. Classic mode should yield AE=0.

## Gotchas
- The 🎓 Tutorial starts a real match vs a "passive" bot, but unit-vs-unit combat still happens on collision, so tutorial units can be killed and the capital besieged — move fast or retrain units. If the player's capital falls the match ends and you're dumped back to the menu.
- Tutorial step 3 ("Move & explore") requires revealing ≥12 new tiles; one short move may not be enough — send units to map edges or train a scout.
- Console errors: check via CDP/browser console; the game normally logs nothing.
