// AI bots: run on a timer, use the same public actions as human players.
const { UNITS, BUILDINGS, TECHS, TERRAIN } = require('./data');
const { neighbors, hexDist, key } = require('./map');

const LEVELS = {
  passive:  { actMs: 4500, aggro: 0, smart: 0.3, stay: true }, // tutorial opponent: grows economy, units never leave home
  peaceful: { actMs: 2200, aggro: 0, smart: 0.7, avoid: true }, // grows and explores but never attacks and keeps distance
  easy:     { actMs: 3500, aggro: 0.25, smart: 0.4 },
  medium:   { actMs: 2200, aggro: 0.5,  smart: 0.7 },
  hard:     { actMs: 1200, aggro: 0.75, smart: 1.0 },
  insane:   { actMs: 500,  aggro: 0.95, smart: 1.0, unitCap: 3, focus: true }, // acts near-instantly, big armies, focused attacks
};

const CHAT_LINES = [
  'Good luck everyone!', 'My economy is booming.', 'Anyone want an alliance?',
  'Nice map this time.', 'You will regret that!', 'Expanding as we speak...',
];

class Bot {
  constructor(game, pid) {
    this.game = game;
    this.pid = pid;
    const p = game.player(pid);
    this.cfg = LEVELS[p.botLevel] || LEVELS.medium;
    this.lastAct = 0;
    this.lastChat = Date.now();
  }

  step(now) {
    const g = this.game; const p = g.player(this.pid);
    if (!p || !p.alive || g.over) return;
    if (now - this.lastAct < this.cfg.actMs) return;
    this.lastAct = now;

    this.research(p);
    this.build(p);
    this.train(p);
    this.commandUnits(p);
    this.diplomacy(p, now);
  }

  research(p) {
    const g = this.game;
    const order = ['farming', 'writing', 'masonry', 'archery', 'trade', 'expansion', 'chivalry', 'banking', 'philosophy', 'engineering', 'seafaring', 'mountainlore'];
    for (const t of order) {
      if (!p.techs.has(t) && (!TECHS[t].req || p.techs.has(TECHS[t].req)) && p.res.science >= TECHS[t].cost) {
        g.actResearch(p.id, t);
        return;
      }
    }
    // smart bots spend surplus science on unit/building upgrades
    if (this.cfg.smart >= 0.7 && p.res.science > 50) {
      const owned = new Set([...g.units.values()].filter(u => u.ownerId === p.id).map(u => u.type));
      const unit = ['knight', 'archer', 'warrior', 'defender'].find(t => owned.has(t));
      if (unit) { g.actUpgrade(p.id, 'unit', unit); return; }
      const built = this.myCities(p).flatMap(c => c.buildings);
      if (built.length) g.actUpgrade(p.id, 'building', built[Math.floor(Math.random() * built.length)]);
    }
  }

  myCities(p) {
    return [...this.game.cities.values()].filter(c => c.ownerId === p.id);
  }

  build(p) {
    const g = this.game;
    const order = ['farm', 'sawmill', 'library', 'mine', 'market', 'walls', 'temple', 'port'];
    for (const c of this.myCities(p)) {
      for (const b of order) {
        if (c.buildings.includes(b)) continue;
        const def = BUILDINGS[b];
        if (def.tech && !p.techs.has(def.tech)) continue;
        if (g.canAfford(p, def.cost)) { g.actBuild(p.id, c.id, b); return; }
      }
    }
  }

  train(p) {
    const g = this.game;
    const myUnits = [...g.units.values()].filter(u => u.ownerId === p.id);
    const cities = this.myCities(p);
    if (!cities.length) return;
    const c = cities[Math.floor(Math.random() * cities.length)];
    const wantSettler = p.techs.has('expansion') && cities.length < 3 &&
      !myUnits.some(u => u.type === 'settler');
    if (wantSettler && g.canAfford(p, UNITS.settler.cost)) { g.actTrain(p.id, c.id, 'settler'); return; }
    if (myUnits.length < 3 + cities.length * (this.cfg.unitCap || 2)) {
      const prefs = ['knight', 'archer', 'giant', 'defender', 'warrior', 'scout'];
      for (const t of prefs) {
        const def = UNITS[t];
        if (def.tech && !p.techs.has(def.tech)) continue;
        if (Math.random() > this.cfg.smart && t !== 'warrior') continue;
        if (g.canAfford(p, def.cost)) { g.actTrain(p.id, c.id, t); return; }
      }
    }
  }

  commandUnits(p) {
    if (this.cfg.stay) return; // tutorial bot: units guard their city and never roam
    const g = this.game;
    const myUnits = [...g.units.values()].filter(u => u.ownerId === p.id);
    const enemies = [...g.players.values()].filter(o => o.id !== p.id && o.alive && !p.allies.has(o.id));
    const enemyCities = [...g.cities.values()].filter(c => enemies.some(e => e.id === c.ownerId) && p.explored.has(key(c.q, c.r)));
    const villages = g.tileList.filter(t => t.village && p.explored.has(key(t.q, t.r)));

    for (const u of myUnits) {
      if (u.dest) continue;
      if (u.type === 'settler') {
        const spot = this.findSettleSpot(p, u);
        if (spot && u.q === spot.q && u.r === spot.r) g.actFoundCity(p.id, u.id);
        else if (spot) g.actMove(p.id, u.id, spot.q, spot.r);
        continue;
      }
      const nearVillage = villages.sort((a, b) => hexDist(a, u) - hexDist(b, u))[0];
      if (nearVillage && (u.type === 'scout' || Math.random() < 0.5) &&
          (!this.cfg.avoid || !this.nearEnemy(p, nearVillage))) {
        g.actMove(p.id, u.id, nearVillage.q, nearVillage.r);
        continue;
      }
      const peaceOver = Date.now() - g.startTime > 100 * 1000;
      if (peaceOver && Math.random() < this.cfg.aggro && enemyCities.length) {
        // focused bots gang up on the weakest known enemy city; others hit the nearest
        const t = this.cfg.focus
          ? enemyCities.sort((a, b) => a.hp - b.hp || hexDist(a, u) - hexDist(b, u))[0]
          : enemyCities.sort((a, b) => hexDist(a, u) - hexDist(b, u))[0];
        g.actMove(p.id, u.id, t.q, t.r);
        continue;
      }
      // explore: move toward a random unexplored-ish direction
      let cand = g.tileList[Math.floor(Math.random() * g.tileList.length)];
      if (this.cfg.avoid) {
        for (let tries = 0; cand && this.nearEnemy(p, cand) && tries < 8; tries++) {
          cand = g.tileList[Math.floor(Math.random() * g.tileList.length)];
        }
        if (cand && this.nearEnemy(p, cand)) continue; // nowhere safe to go right now
      }
      if (cand && TERRAIN[cand.terrain].move) g.actMove(p.id, u.id, cand.q, cand.r);
    }
  }

  // is a tile within 2 hexes of any enemy unit or city? (peaceful bots keep away)
  nearEnemy(p, t) {
    const g = this.game;
    for (const u of g.units.values()) {
      if (!g.areAllies(p.id, u.ownerId) && hexDist(u, t) <= 2) return true;
    }
    for (const c of g.cities.values()) {
      if (!g.areAllies(p.id, c.ownerId) && hexDist(c, t) <= 2) return true;
    }
    return false;
  }

  findSettleSpot(p, u) {
    const g = this.game;
    let best = null; let bestScore = -1;
    for (const k of p.explored) {
      const t = g.tiles.get(k);
      if (!TERRAIN[t.terrain].move || t.cityId || t.village) continue;
      if ([...g.cities.values()].some(c => hexDist(c, t) < 3)) continue;
      let score = 10 - hexDist(t, u) * 0.5 + (t.bonus ? 3 : 0);
      for (const [nq, nr] of neighbors(t.q, t.r)) {
        const n = g.tiles.get(key(nq, nr));
        if (n && n.bonus) score += 2;
      }
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  diplomacy(p, now) {
    const g = this.game;
    // accept ally requests if not too aggressive
    for (const reqId of [...p.allyRequests]) {
      if (Math.random() < 1 - this.cfg.aggro * 0.8) {
        g.actAlly(p.id, reqId, true);
        g.actChat(p.id, 'Alliance accepted. Together we are stronger!');
      } else {
        p.allyRequests.delete(reqId);
        g.actChat(p.id, 'I work alone.');
      }
    }
    // occasionally propose alliance to the strongest non-ally
    if (Math.random() < 0.05 && this.cfg.aggro < 0.7) {
      const others = [...g.players.values()].filter(o => o.id !== p.id && o.alive && !p.allies.has(o.id));
      if (others.length > 1) {
        const target = others.sort((a, b) => b.points - a.points)[0];
        g.actAlly(p.id, target.id, false);
      }
    }
    if (now - this.lastChat > 45000 && Math.random() < 0.2) {
      this.lastChat = now;
      g.actChat(p.id, CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)]);
    }
  }
}

module.exports = { Bot };
