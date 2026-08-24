// Real-time game engine. All mutation happens here; server/index.js routes
// socket messages to actions, bots call the same actions.
const { CIVS, TERRAIN, UNITS, BUILDINGS, TECHS, GAME } = require('./data');
const { generateMap, neighbors, hexDist, key } = require('./map');

let nextId = 1;
const uid = p => `${p}${nextId++}`;

const CITY_NAMES = ['Aldor', 'Bruma', 'Cintra', 'Doria', 'Elmyr', 'Fenwick', 'Gale', 'Harn', 'Ilium', 'Jorvik', 'Kessel', 'Lyra'];

class Game {
  constructor(playersInfo, seed = (Math.random() * 1e9) | 0) {
    this.id = uid('g');
    this.seed = seed;
    const { tiles, starts } = generateMap(seed);
    this.tiles = tiles;
    this.units = new Map();
    this.cities = new Map();
    this.players = new Map();
    this.chatLog = [];
    this.events = []; // per-tick notifications
    this.startTime = Date.now();
    this.over = false;
    this.winner = null;
    this.dirtyTiles = new Set();
    this.cityNameIdx = 0;

    playersInfo.forEach((info, i) => {
      const p = {
        id: info.id, name: info.name, civ: info.civ in CIVS ? info.civ : 'imperius',
        isBot: !!info.isBot, botLevel: info.botLevel || 'medium',
        res: { food: 40, wood: 25, stone: 15, gold: 25, science: 0 },
        techs: new Set(), explored: new Set(), points: 0, kills: 0,
        alive: true, allies: new Set(), allyRequests: new Set(),
      };
      const civ = CIVS[p.civ];
      if (civ.startTech) p.techs.add(civ.startTech);
      this.players.set(p.id, p);
      const start = starts[i];
      this.foundCityAt(p, start.q, start.r, true);
      this.spawnUnit(p.id, 'warrior', start.q, start.r);
      if (civ.startScout) this.spawnUnit(p.id, 'scout', start.q, start.r);
    });
  }

  // ---------- helpers ----------
  tile(q, r) { return this.tiles.get(key(q, r)); }
  player(id) { return this.players.get(id); }
  timeLeft() { return Math.max(0, GAME.durationMs - (Date.now() - this.startTime)); }
  areAllies(a, b) { return a === b || this.player(a)?.allies.has(b); }

  unitAt(q, r) {
    for (const u of this.units.values()) if (u.q === q && u.r === r) return u;
    return null;
  }

  buildOccupancy() {
    const occ = new Map();
    for (const u of this.units.values()) occ.set(key(u.q, u.r), u);
    return occ;
  }

  cityAt(q, r) {
    const t = this.tile(q, r);
    return t && t.cityId ? this.cities.get(t.cityId) : null;
  }

  reveal(p, q, r, radius) {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.abs(dq + dr) > radius) continue;
        const k = key(q + dq, r + dr);
        if (this.tiles.has(k) && !p.explored.has(k)) {
          p.explored.add(k);
          p.points += GAME.points.tileExplored;
        }
      }
    }
  }

  spawnUnit(ownerId, type, q, r) {
    // place on tile or nearest free neighbor
    let spot = null;
    const t0 = this.tile(q, r);
    const cands = t0 && t0.cityId ? [...neighbors(q, r), [q, r]] : [[q, r], ...neighbors(q, r)];
    for (const [cq, cr] of cands) {
      const t = this.tile(cq, cr);
      if (t && TERRAIN[t.terrain].move && !this.unitAt(cq, cr)) { spot = [cq, cr]; break; }
    }
    if (!spot) return null;
    const def = UNITS[type];
    const u = {
      id: uid('u'), ownerId, type, q: spot[0], r: spot[1],
      hp: def.hp, maxHp: def.hp, nextMoveAt: 0, dest: null,
    };
    this.units.set(u.id, u);
    const p = this.player(ownerId);
    this.reveal(p, u.q, u.r, def.vision || 1);
    return u;
  }

  foundCityAt(p, q, r, isCapital = false) {
    const t = this.tile(q, r);
    const c = {
      id: uid('c'), ownerId: p.id, q, r,
      name: CITY_NAMES[this.cityNameIdx++ % CITY_NAMES.length],
      buildings: [], hp: isCapital ? 60 : 40, maxHp: isCapital ? 60 : 40, capital: isCapital,
    };
    t.cityId = c.id; t.village = false;
    this.dirtyTiles.add(key(q, r));
    this.cities.set(c.id, c);
    p.points += GAME.points.city;
    this.reveal(p, q, r, 2);
    return c;
  }

  canAfford(p, cost, mult = 1) {
    return Object.entries(cost).every(([k, v]) => p.res[k] >= Math.ceil(v * mult));
  }
  pay(p, cost, mult = 1) {
    for (const [k, v] of Object.entries(cost)) p.res[k] -= Math.ceil(v * mult);
  }

  // ---------- player actions ----------
  actMove(pid, unitId, tq, tr) {
    const u = this.units.get(unitId);
    if (!u || u.ownerId !== pid || this.over) return;
    if (!this.tiles.has(key(tq, tr))) return;
    u.dest = { q: tq, r: tr };
  }

  actTrain(pid, cityId, type) {
    const p = this.player(pid); const c = this.cities.get(cityId);
    const def = UNITS[type];
    if (!p || !c || !def || c.ownerId !== pid || this.over || !p.alive) return;
    if (def.tech && !p.techs.has(def.tech)) return;
    if (!this.canAfford(p, def.cost)) return;
    this.pay(p, def.cost);
    this.spawnUnit(pid, type, c.q, c.r);
  }

  actBuild(pid, cityId, building) {
    const p = this.player(pid); const c = this.cities.get(cityId);
    const def = BUILDINGS[building];
    if (!p || !c || !def || c.ownerId !== pid || this.over || !p.alive) return;
    if (c.buildings.includes(building)) return;
    if (def.tech && !p.techs.has(def.tech)) return;
    const civ = CIVS[p.civ];
    let mult = civ.buildDiscount || 1;
    if (building === 'walls' && civ.freeWalls) mult = 0;
    if (!this.canAfford(p, def.cost, mult)) return;
    this.pay(p, def.cost, mult);
    c.buildings.push(building);
    if (def.defBonus) { c.maxHp += def.defBonus * 2; c.hp += def.defBonus * 2; }
    p.points += def.points;
  }

  actResearch(pid, tech) {
    const p = this.player(pid); const def = TECHS[tech];
    if (!p || !def || this.over || !p.alive) return;
    if (p.techs.has(tech)) return;
    if (def.req && !p.techs.has(def.req)) return;
    if (p.res.science < def.cost) return;
    p.res.science -= def.cost;
    p.techs.add(tech);
    p.points += GAME.points.tech;
  }

  actFoundCity(pid, unitId) {
    const p = this.player(pid); const u = this.units.get(unitId);
    if (!p || !u || u.ownerId !== pid || u.type !== 'settler' || this.over) return;
    const t = this.tile(u.q, u.r);
    if (!t || t.cityId) return;
    for (const c of this.cities.values()) if (hexDist(c, u) < 3) return;
    this.units.delete(u.id);
    this.foundCityAt(p, u.q, u.r);
    this.pushEvent(`${p.name} founded a new city!`);
  }

  actAlly(pid, targetId, accept) {
    const p = this.player(pid); const t = this.player(targetId);
    if (!p || !t || pid === targetId || this.over) return;
    if (accept) {
      if (p.allyRequests.has(targetId)) {
        p.allyRequests.delete(targetId);
        p.allies.add(targetId); t.allies.add(pid);
        this.pushEvent(`${p.name} and ${t.name} formed an alliance!`);
      }
    } else if (p.allies.has(targetId)) {
      p.allies.delete(targetId); t.allies.delete(pid);
      this.pushEvent(`${p.name} broke the alliance with ${t.name}!`);
    } else {
      t.allyRequests.add(pid);
      this.pushEvent(`${p.name} proposed an alliance to ${t.name}.`, [targetId, pid]);
    }
  }

  actChat(pid, text, alliesOnly = false) {
    const p = this.player(pid);
    if (!p || !text) return;
    const msg = {
      from: p.name, fromId: pid, text: String(text).slice(0, 200),
      alliesOnly, ts: Date.now(),
      to: alliesOnly ? [pid, ...p.allies] : null,
    };
    this.chatLog.push(msg);
    if (this.chatLog.length > 100) this.chatLog.shift();
    return msg;
  }

  pushEvent(text, toIds = null) {
    this.events.push({ text, to: toIds, ts: Date.now() });
  }

  // ---------- tick ----------
  tick() {
    if (this.over) return;
    this.events = this.events.filter(e => Date.now() - e.ts < 5000);
    this.income();
    this.moveUnits();
    this.checkEnd();
  }

  income() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const civ = CIVS[p.civ];
      const inc = { food: 0.6, wood: 0.5, stone: 0, gold: 0.5, science: 0.7 };
      let cityIdx = 0;
      for (const c of this.cities.values()) {
        if (c.ownerId !== p.id) continue;
        // each extra city yields diminishing returns to soften exponential snowballing
        const eff = Math.pow(0.8, cityIdx++);
        inc.food += 1.5 * eff; inc.gold += 0.75 * eff;
        // tiles around city
        for (const [nq, nr] of [[c.q, c.r], ...neighbors(c.q, c.r)]) {
          const t = this.tile(nq, nr);
          if (!t) continue;
          const y = TERRAIN[t.terrain];
          const mult = t.bonus ? 2 : 1;
          inc.food += (y.food * mult * eff) / 8;
          inc.wood += (y.wood * mult * eff) / 8;
          inc.stone += (y.stone * mult * eff) / 8;
          inc.gold += (y.gold * mult * eff) / 8;
        }
        for (const b of c.buildings) {
          const bd = BUILDINGS[b];
          if (bd.income) for (const [k, v] of Object.entries(bd.income)) inc[k] += v * eff;
          if (bd.pointsPerSec) p.points += bd.pointsPerSec;
        }
        // cities slowly heal
        c.hp = Math.min(c.maxHp, c.hp + 1);
      }
      if (civ.goldMult) inc.gold *= civ.goldMult;
      if (civ.foodMult) inc.food *= civ.foodMult;
      if (civ.sciMult) inc.science *= civ.sciMult;
      if (p.techs.has('banking')) inc.gold *= 1.5;
      for (const k of Object.keys(inc)) p.res[k] = Math.min(999, p.res[k] + inc[k]);
    }
  }

  moveUnits() {
    const now = Date.now();
    const occMap = this.buildOccupancy();
    for (const u of [...this.units.values()]) {
      if (!u.dest || now < u.nextMoveAt) continue;
      if (u.q === u.dest.q && u.r === u.dest.r) { u.dest = null; continue; }
      const p = this.player(u.ownerId);
      // greedy step toward dest
      let best = null; let bestD = Infinity;
      for (const [nq, nr] of neighbors(u.q, u.r)) {
        const t = this.tile(nq, nr);
        if (!t || !TERRAIN[t.terrain].move) continue;
        const occ = occMap.get(key(nq, nr));
        if (occ && this.areAllies(u.ownerId, occ.ownerId)) continue;
        const d = hexDist({ q: nq, r: nr }, u.dest);
        if (d < bestD) { bestD = d; best = { q: nq, r: nr, occ }; }
      }
      if (!best || bestD >= hexDist(u, u.dest) + 1) { u.dest = null; continue; }
      const civ = CIVS[p.civ];
      u.nextMoveAt = now + UNITS[u.type].moveMs * (civ.speedMult || 1);

      if (best.occ) { this.fight(u, best.occ); if (!this.units.has(best.occ.id)) occMap.delete(key(best.occ.q, best.occ.r)); continue; }
      const city = this.cityAt(best.q, best.r);
      if (city && !this.areAllies(u.ownerId, city.ownerId)) {
        this.attackCity(u, city);
        continue;
      }
      occMap.delete(key(u.q, u.r));
      u.q = best.q; u.r = best.r;
      occMap.set(key(u.q, u.r), u);
      this.reveal(p, u.q, u.r, UNITS[u.type].vision || 1);
      const t = this.tile(u.q, u.r);
      if (t.village) this.captureVillage(p, u, t);
    }
  }

  captureVillage(p, u, t) {
    this.foundCityAt(p, t.q, t.r);
    this.pushEvent(`${p.name} captured a village!`);
    // unit steps aside so city tile is clear for defense logic
  }

  fight(att, def) {
    const ap = this.player(att.ownerId); const dp = this.player(def.ownerId);
    const aDef = UNITS[att.type]; const dDef = UNITS[def.type];
    let atk = aDef.atk + (att.type === 'warrior' ? (CIVS[ap.civ].warriorAtkBonus || 0) : 0);
    const defCity = this.cityAt(def.q, def.r);
    let defense = dDef.def * (CIVS[dp.civ].defMult || 1) * (defCity ? 1.5 : 1);
    const dmg = Math.max(2, Math.round(atk - defense / 2 + Math.random() * 4));
    def.hp -= dmg;
    if (def.hp <= 0) {
      this.units.delete(def.id);
      ap.points += GAME.points.kill; ap.kills++;
      this.pushEvent(`${ap.name}'s ${aDef.name} killed ${dp.name}'s ${dDef.name}!`);
    } else {
      const retal = Math.max(1, Math.round(dDef.atk * 0.6 - aDef.def / 2 + Math.random() * 3));
      att.hp -= retal;
      if (att.hp <= 0) {
        this.units.delete(att.id);
        dp.points += GAME.points.kill; dp.kills++;
      }
    }
  }

  attackCity(u, city) {
    if (Date.now() - this.startTime < GAME.peaceMs) return; // early peace period
    const ap = this.player(u.ownerId); const cp = this.player(city.ownerId);
    const aDef = UNITS[u.type];
    const walls = city.buildings.includes('walls') ? BUILDINGS.walls.defBonus : 0;
    const atk = aDef.atk * (u.type === 'catapult' ? 1.5 : 1);
    const dmg = Math.max(1, Math.round(atk - (3 + walls) / 2 * (CIVS[cp.civ].defMult || 1) + Math.random() * 3));
    city.hp -= dmg;
    u.hp -= Math.max(1, Math.round(3 + walls / 2 - aDef.def / 3));
    if (u.hp <= 0) { this.units.delete(u.id); return; }
    if (city.hp <= 0) {
      city.ownerId = u.ownerId;
      city.hp = Math.round(city.maxHp / 2);
      ap.points += GAME.points.city;
      cp.points = Math.max(0, cp.points - GAME.points.city);
      this.pushEvent(`${ap.name} conquered ${city.name} from ${cp.name}!`);
      if (![...this.cities.values()].some(c => c.ownerId === cp.id)) {
        cp.alive = false;
        for (const un of [...this.units.values()]) if (un.ownerId === cp.id) this.units.delete(un.id);
        this.pushEvent(`${cp.name} has been eliminated!`);
      }
    }
  }

  checkEnd() {
    const alive = [...this.players.values()].filter(p => p.alive);
    const humanOrAll = alive;
    let winner = null;
    if (humanOrAll.length === 1) winner = humanOrAll[0];
    // alliance victory: all alive players mutually allied
    else if (alive.length > 1 && alive.every(p => alive.every(o => o.id === p.id || p.allies.has(o.id)))) {
      winner = alive.reduce((a, b) => (a.points >= b.points ? a : b));
    }
    const overThreshold = alive.filter(p => p.points >= GAME.pointsToWin);
    if (overThreshold.length) winner = overThreshold.reduce((a, b) => (a.points >= b.points ? a : b));
    if (!winner && this.timeLeft() <= 0) {
      winner = alive.reduce((a, b) => (a.points >= b.points ? a : b), alive[0]);
    }
    if (winner) {
      this.over = true;
      this.winner = { id: winner.id, name: winner.name };
      this.pushEvent(`${winner.name} wins the game!`);
    }
  }

  // ---------- serialization ----------
  viewFor(pid, sentTiles = null) {
    const p = this.player(pid);
    if (!p) return null;
    const visibleTiles = [];
    for (const k of p.explored) {
      if (sentTiles && sentTiles.has(k) && !this.dirtyTiles.has(k)) continue;
      const t = this.tiles.get(k);
      if (sentTiles) sentTiles.add(k);
      visibleTiles.push({
        q: t.q, r: t.r, terrain: t.terrain, bonus: t.bonus,
        village: t.village, cityId: t.cityId,
      });
    }
    const units = [...this.units.values()]
      .filter(u => p.explored.has(key(u.q, u.r)))
      .map(u => ({ id: u.id, ownerId: u.ownerId, type: u.type, q: u.q, r: u.r, hp: Math.round(u.hp), maxHp: u.maxHp }));
    const cities = [...this.cities.values()]
      .filter(c => p.explored.has(key(c.q, c.r)))
      .map(c => ({ id: c.id, ownerId: c.ownerId, q: c.q, r: c.r, name: c.name, hp: Math.round(c.hp), maxHp: c.maxHp, buildings: c.buildings, capital: c.capital }));
    const players = [...this.players.values()].map(o => ({
      id: o.id, name: o.name, civ: o.civ, isBot: o.isBot, alive: o.alive,
      points: Math.round(o.points),
      isAlly: p.allies.has(o.id),
      requestedAlly: p.allyRequests.has(o.id),
    }));
    return {
      type: 'state',
      you: pid,
      res: Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.floor(v)])),
      techs: [...p.techs],
      tiles: visibleTiles, units, cities, players,
      timeLeft: this.timeLeft(),
      over: this.over, winner: this.winner,
      events: this.events.filter(e => !e.to || e.to.includes(pid)).map(e => e.text),
      pointsToWin: GAME.pointsToWin,
    };
  }
}

module.exports = { Game };
