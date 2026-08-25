# Small Kingdoms (Mini Empires)

**Play in your browser (single-player vs bots):** https://giftedhoneybee.github.io/Small-Kingdoms/

A real-time (no turns) online multiplayer strategy game for 2–4 players — a mix of
Polytopia, Catan and Forge of Empires. Games last at most 10 minutes.

## Features
- **Online multiplayer** over WebSockets, plus **AI bots** with easy/medium/hard difficulty
- **Random map** every game (terrain blobs, bonus resources, neutral villages)
- **5 civilizations** with different strengths
- **Fog of war** — explore the map with your units
- **Economy**: food, wood, stone, gold and science income from cities, terrain and buildings
- **Cities**: capture neutral villages or found new cities with settlers, construct 7 building types
- **Tech tree**: 10 technologies unlocking units, buildings and bonuses
- **Armies**: 7 unit types, real-time movement and combat, city sieges
- **Diplomacy**: alliances and chat (all players or allies only)
- **Win** by eliminating all opponents, reaching 1500 points, or having the most points when the 10-minute timer ends. The first 90 seconds are a peace period (cities can't be attacked).

## Run

```bash
npm install
npm start
# open http://localhost:3000
```

To play online, host the server anywhere Node.js runs (any PaaS works — it is a single
process, no database) and share the URL. Players create/join games from the lobby;
the host can fill remaining slots with bots.

## Static single-player build (GitHub Pages)

GitHub Pages can only serve static files, so it cannot run the multiplayer WebSocket
server — instead `docs/` contains a build where the whole game engine runs inside the
browser and you play against bots. Rebuild it after changing the game code with:

```bash
./scripts/build-web.sh
```

## Code layout
- `server/data.js` — game definitions (civs, units, buildings, techs, balance)
- `server/map.js` — seeded random hex map generation
- `server/game.js` — game engine (actions, income, movement, combat, win conditions)
- `server/bot.js` — AI players
- `server/index.js` — Express + WebSocket server, lobby/rooms
- `public/` — browser client (canvas renderer + UI)
- `web/entry.js` — in-browser "server" for the static single-player build
- `docs/` — generated static build served by GitHub Pages
