# Small Kingdoms (Mini Empires)

**Play in your browser (single-player vs bots):** https://giftedhoneybee.github.io/Small-Kingdoms/

A real-time (no turns) online multiplayer strategy game for 2–10 players — a mix of
Polytopia, Catan and Forge of Empires. Games last at most 10 minutes.

## Features
- **Online multiplayer** over WebSockets, plus **AI bots** with easy/medium/hard difficulty
- **Random map** every game — 6 sizes (Tiny to Gigantic) and 6 terrain types (Pangea, Continents, Islands, Lakes, Dryland, Mountain pass)
- **6 unique tribes** (Valdorn, Sylvara, Kharim, Thalassi, Grimmark, Aurelia), each with real strengths *and* weaknesses — including the seafaring Thalassi water tribe
- **Fog of war** — explore the map with your units
- **Economy**: food, wood, stone, gold and science income from cities, terrain and buildings
- **Cities**: capture neutral villages or found new cities with settlers, construct 7 building types
- **Tech tree**: 12 technologies unlocking units, buildings and bonuses
- **Armies**: 8 unit types (incl. mountain-climbing Giants), A* pathfinding with congestion avoidance, real-time combat, city sieges, auto-attack radius (3/6/9 tiles)
- **Boats & ports**: build a Port (Seafaring tech) in a coastal city — nearby water lets units board fast ranged boats
- **Diplomacy**: alliances and chat (all players or allies only)
- **Win** by eliminating all opponents, reaching 1500 points, or having the most points when the 10-minute timer ends. The first 90 seconds are a peace period (cities can't be attacked). The host can also pick **Last player standing** mode (no points/timer — play until one player remains).
- **Game speeds**: Bullet (default) or Slow (75% reduced income, 5× slower unit movement)
- **Settings** (session-persistent): graphics style (Classic flat / New blocky / New + animations), show planned movement arrows, auto-select newly trained units
- **In-game wiki** with full stats, shortcuts and mechanics
- **Interactive tutorial**: a guided real practice match vs a passive bot with step boxes, highlighted UI and map markers

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
