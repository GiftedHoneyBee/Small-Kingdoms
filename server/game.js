// Real-time game engine. All mutation happens here; server/index.js routes
// socket messages to actions, bots call the same actions.
const { CIVS, TERRAIN, UNITS, BUILDINGS, TECHS, GAME, BOAT, UPGRADES, upgradeCost, upgradeMult } = require('./data');
const { generateMap, neighbors, hexDist, key } = require('./map');

let nextId = 1;
const uid = p => `${p}${nextId++}`;

const CITY_NAMES = ['Aldor', 'Bruma', 'Cintra', 'Doria', 'Elmyr', 'Fenwick', 'Gale', 'Harn', 'Ilium', 'Jorvik', 'Kessel', 'Lyra'];

class Game {
  constructor(playersInfo, opts = {}, seed = (Math.random() * 1e9) | 0) {
    this.id = uid('g');
    this.seed = seed;
    this.winMode = opts.winMode === 'elimination' ? 'elimination' : 'points';
    this.speed = opts.speed === 'slow' ? 'slow' : 'bullet';
    this.incomeMult = this.speed === 'slow' ? 0.25 : 1;
    this.moveMult = this.speed === 'slow' ? 5 : 1;
    const { tiles, starts } = generateMap(seed, { mapSize: opts.mapSize, mapType: opts.mapType, players: playersInfo.length });
    this.mapSize = opts.mapSize || 'normal';
    this.mapType = opts.mapType || 'continents';
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
        id: info.id, name: info.name, civ: info.civ in CIVS ? info.civ : 'valdorn',
        isBot: !!info.isBot, botLevel: info.botLevel || 'medium',
        res: { food: 40, wood: 25, stone: 15, gold: 25, science: 0 },
        techs: new Set(), explored: new Set(), points: 0, kills: 0,
        alive: true, allies: new Set(), allyRequests: new Set(),
        upgrades: { unit: {}, building: {} },
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
  timeLeft() { return this.winMode === 'elimination' ? -1 : Math.max(0, GAME.durationMs - (Date.now() - this.startTime)); }
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
    const civHp = CIVS[this.player(ownerId).civ].hpMult || 1;
    const hp = Math.max(1, Math.round(def.hp * civHp * upgradeMult(this.unitLevel(ownerId, type))));
    const u = {
      id: uid('u'), ownerId, type, q: spot[0], r: spot[1],
      hp, maxHp: hp, nextMoveAt: 0, dest: null, autoAttack: 0,
      boat: false, path: null, pathGoal: null,
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
      autoTrain: null,
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

  actStop(pid, unitId) {
    const u = this.units.get(unitId);
    if (!u || u.ownerId !== pid) return;
    u.dest = null;
  }

  actAutoAttack(pid, unitId, range) {
    const u = this.units.get(unitId);
    if (!u || u.ownerId !== pid) return;
    // detection radius cycles off(0) -> 3 -> 6 -> 9
    u.autoAttack = [0, 3, 6, 9].includes(range) ? range : (range ? 3 : 0);
  }

  unitLevel(pid, type) { return this.player(pid)?.upgrades.unit[type] || 0; }
  buildingLevel(pid, b) { return this.player(pid)?.upgrades.building[b] || 0; }

  // attack value with civ and upgrade modifiers applied
  attackOf(u, stats) {
    const civ = CIVS[this.player(u.ownerId).civ];
    let atk = stats.atk * (civ.atkMult || 1) * upgradeMult(this.unitLevel(u.ownerId, u.type));
    if (u.boat) atk += civ.boatAtkBonus || 0;
    else {
      atk *= civ.landAtkMult || 1;
      if (u.type === 'warrior') atk += civ.warriorAtkBonus || 0;
    }
    return atk;
  }

  // effective combat/movement stats (boat overrides while embarked)
  unitStats(u) {
    const d = UNITS[u.type];
    if (!u.boat) return d;
    return { name: `${d.name} (boat)`, atk: BOAT.atk, def: BOAT.def, range: BOAT.range, moveMs: BOAT.moveMs, vision: d.vision };
  }

  // defense value with civ and upgrade modifiers applied
  defenseOf(u, stats, inCity) {
    const civ = CIVS[this.player(u.ownerId).civ];
    return stats.def * (civ.defMult || 1) * upgradeMult(this.unitLevel(u.ownerId, u.type)) * (inCity ? 1.5 : 1);
  }

  actUpgrade(pid, kind, type) {
    const p = this.player(pid);
    if (!p || this.over || !p.alive) return;
    if (kind !== 'unit' && kind !== 'building') return;
    if (kind === 'unit' ? !UNITS[type] : !BUILDINGS[type]) return;
    const lvl = p.upgrades[kind][type] || 0;
    if (lvl >= UPGRADES.maxLevel) return;
    const cost = upgradeCost(kind === 'unit' ? UPGRADES.unitBase : UPGRADES.buildingBase, lvl);
    if (p.res.science < cost) return;
    p.res.science -= cost;
    p.upgrades[kind][type] = lvl + 1;
    // existing units of that type get the extra hp immediately
    if (kind === 'unit') {
      for (const u of this.units.values()) {
        if (u.ownerId !== pid || u.type !== type) continue;
        const civHp = CIVS[this.player(pid).civ].hpMult || 1;
        const newMax = Math.max(1, Math.round(UNITS[type].hp * civHp * upgradeMult(lvl + 1)));
        u.hp += newMax - u.maxHp;
        u.maxHp = newMax;
      }
    }
  }

  actAutoTrain(pid, cityId, type) {
    const c = this.cities.get(cityId);
    if (!c || c.ownerId !== pid) return;
    c.autoTrain = type && UNITS[type] ? type : null;
  }

  actTrain(pid, cityId, type) {
    const p = this.player(pid); const c = this.cities.get(cityId);
    const def = UNITS[type];
    if (!p || !c || !def || c.ownerId !== pid || this.over || !p.alive) return;
    if (def.tech && !p.techs.has(def.tech)) return;
    if (!this.canAfford(p, def.cost)) return;
    if (!this.hasSpawnSpot(c.q, c.r)) return;
    this.pay(p, def.cost);
    this.spawnUnit(pid, type, c.q, c.r);
  }

  hasSpawnSpot(q, r) {
    for (const [cq, cr] of [[q, r], ...neighbors(q, r)]) {
      const t = this.tile(cq, cr);
      if (t && TERRAIN[t.terrain].move && !this.unitAt(cq, cr)) return true;
    }
    return false;
  }

  autoTrainTick() {
    for (const c of this.cities.values()) {
      if (!c.autoTrain) continue;
      this.actTrain(c.ownerId, c.id, c.autoTrain);
    }
  }

  autoAttackTick() {
    for (const u of this.units.values()) {
      if (!u.autoAttack || u.dest) continue;
      const radius = u.autoAttack;
      const p = this.player(u.ownerId);
      let best = null; let bestD = Infinity;
      for (const e of this.units.values()) {
        if (this.areAllies(u.ownerId, e.ownerId)) continue;
        if (p && !p.explored.has(key(e.q, e.r))) continue;
        const d = hexDist(u, e);
        if (d <= radius && d < bestD) { bestD = d; best = e; }
      }
      if (!best) {
        for (const c of this.cities.values()) {
          if (this.areAllies(u.ownerId, c.ownerId)) continue;
          const d = hexDist(u, c);
          if (d <= radius && d < bestD) { bestD = d; best = c; }
        }
      }
      if (best) u.dest = { q: best.q, r: best.r };
    }
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
    if (building === 'port' && !this.waterNear(c.q, c.r, def.portRange || 3)) return;
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
    const cost = Math.round(def.cost * (CIVS[p.civ].techCostMult || 1));
    if (p.res.science < cost) return;
    p.res.science -= cost;
    p.techs.add(tech);
    p.points += GAME.points.tech;
  }

  actFoundCity(pid, unitId) {
    const p = this.player(pid); const u = this.units.get(unitId);
    if (!p || !u || u.ownerId !== pid || u.type !== 'settler' || this.over) return;
    const t = this.tile(u.q, u.r);
    if (!t || t.cityId || !TERRAIN[t.terrain].move) return;
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
          const up = upgradeMult(this.buildingLevel(p.id, b));
          if (bd.income) for (const [k, v] of Object.entries(bd.income)) inc[k] += v * eff * up;
          if (bd.pointsPerSec) p.points += bd.pointsPerSec * up;
        }
        // cities slowly heal
        c.hp = Math.min(c.maxHp, c.hp + 1);
      }
      if (civ.goldMult) inc.gold *= civ.goldMult;
      if (civ.foodMult) inc.food *= civ.foodMult;
      if (civ.woodMult) inc.wood *= civ.woodMult;
      if (civ.stoneMult) inc.stone *= civ.stoneMult;
      if (civ.sciMult) inc.science *= civ.sciMult;
      if (p.techs.has('banking')) inc.gold *= 1.5;
      for (const k of Object.keys(inc)) p.res[k] = Math.min(999, p.res[k] + inc[k] * this.incomeMult);
    }
  }

  // is there a water tile within `radius` of (q,r)?
  waterNear(q, r, radius) {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const t = this.tile(q + dq, r + dr);
        if (t && t.terrain === 'water') return true;
      }
    }
    return false;
  }

  // water tiles reachable for embarking by `pid`: within port range of an
  // allied city that has a port
  portZones(pid) {
    const zones = new Set();
    const R = BUILDINGS.port.portRange || 3;
    for (const c of this.cities.values()) {
      if (!this.areAllies(pid, c.ownerId) || !c.buildings.includes('port')) continue;
      for (let dq = -R; dq <= R; dq++) {
        for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
          const t = this.tile(c.q + dq, c.r + dr);
          if (t && t.terrain === 'water') zones.add(key(t.q, t.r));
        }
      }
    }
    return zones;
  }

  canEnter(u, t, zones) {
    if (!t) return false;
    if (t.terrain === 'mountain') return !!UNITS[u.type].canMountain && !u.boat;
    if (t.terrain === 'water') return u.boat || zones.has(key(t.q, t.r));
    return true;
  }

  // path-aware enterability: `afloat` is whether the unit would be in a boat
  // when standing on the tile it is stepping FROM. A land unit can plan a
  // route that walks (even backwards) to a port zone, embarks there, crosses
  // any open water and lands elsewhere.
  canEnterFrom(u, afloat, t, zones) {
    if (!t) return false;
    if (t.terrain === 'mountain') return !!UNITS[u.type].canMountain && !afloat;
    if (t.terrain === 'water') return afloat || zones.has(key(t.q, t.r));
    return true;
  }

  // A* toward dest. Allied-occupied tiles cost extra so big groups spread onto
  // longer roads instead of queueing on a narrow one. If the destination is
  // unreachable, returns the path to the closest reachable tile.
  findPath(u, dest, occMap, zones) {
    const startK = key(u.q, u.r);
    const goalK = key(dest.q, dest.r);
    const gScore = new Map([[startK, 0]]);
    const came = new Map();
    const open = [[hexDist(u, dest), 0, u.q, u.r]]; // [f, g, q, r] binary min-heap
    const push = (n) => {
      open.push(n);
      let i = open.length - 1;
      while (i > 0) { const par = (i - 1) >> 1; if (open[par][0] <= open[i][0]) break; [open[par], open[i]] = [open[i], open[par]]; i = par; }
    };
    const pop = () => {
      const top = open[0]; const last = open.pop();
      if (open.length) {
        open[0] = last; let i = 0;
        for (;;) {
          let m = i; const l = 2 * i + 1, rr = 2 * i + 2;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (rr < open.length && open[rr][0] < open[m][0]) m = rr;
          if (m === i) break; [open[i], open[m]] = [open[m], open[i]]; i = m;
        }
      }
      return top;
    };
    let bestK = startK; let bestH = hexDist(u, dest);
    let expanded = 0;
    const closed = new Set();
    while (open.length && expanded < 4000) {
      const [, g, q, r] = pop();
      const k = key(q, r);
      if (closed.has(k)) continue;
      closed.add(k);
      expanded++;
      if (k === goalK) { bestK = k; break; }
      const h = hexDist({ q, r }, dest);
      if (h < bestH) { bestH = h; bestK = k; }
      const curT = this.tile(q, r);
      const afloat = (curT && curT.terrain === 'water') || (k === startK && u.boat);
      for (const [nq, nr] of neighbors(q, r)) {
        const nk = key(nq, nr);
        if (closed.has(nk)) continue;
        const t = this.tile(nq, nr);
        if (!this.canEnterFrom(u, afloat, t, zones)) continue;
        const occ = occMap.get(nk);
        let cost = TERRAIN[t.terrain].moveMult || 1; // slower terrain = pricier road
        if (occ && this.areAllies(u.ownerId, occ.ownerId)) cost += 4; // congestion penalty
        const ng = g + cost;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng);
          came.set(nk, k);
          push([ng + hexDist({ q: nq, r: nr }, dest), ng, nq, nr]);
        }
      }
    }
    if (bestK === startK) return null;
    const path = [];
    let cur = bestK;
    while (cur !== startK) {
      const [q, r] = cur.split(',').map(Number);
      path.unshift({ q, r });
      cur = came.get(cur);
    }
    return path;
  }

  moveUnits() {
    const now = Date.now();
    const occMap = this.buildOccupancy();
    const zoneCache = new Map();
    const zonesFor = (pid) => {
      if (!zoneCache.has(pid)) zoneCache.set(pid, this.portZones(pid));
      return zoneCache.get(pid);
    };
    for (const u of [...this.units.values()]) {
      if (!u.dest || now < u.nextMoveAt) continue;
      if (u.q === u.dest.q && u.r === u.dest.r) { u.dest = null; u.path = null; continue; }
      const p = this.player(u.ownerId);
      const stats = this.unitStats(u);
      // ranged units fire from distance once their destination is within range
      const range = stats.range || 1;
      if (range > 1 && hexDist(u, u.dest) <= range) {
        const target = this.rangedTarget(u, range);
        if (target) {
          const civ2 = CIVS[p.civ];
          u.nextMoveAt = now + stats.moveMs * (u.boat ? (civ2.boatMoveMult || 1) : (civ2.speedMult || 1)) * this.moveMult;
          this.rangedAttack(u, target);
          continue;
        }
      }
      const zones = zonesFor(u.ownerId);
      // (re)plan when there is no path, the goal changed, or the next step is
      // blocked by an allied unit (congestion-aware replan picks another road)
      let step = u.path && u.path.length ? u.path[0] : null;
      const goalChanged = !u.pathGoal || u.pathGoal.q !== u.dest.q || u.pathGoal.r !== u.dest.r;
      const stepBlocked = step && (() => {
        const occ = occMap.get(key(step.q, step.r));
        return (occ && this.areAllies(u.ownerId, occ.ownerId)) || !this.canEnter(u, this.tile(step.q, step.r), zones);
      })();
      if (!step || goalChanged || stepBlocked) {
        u.path = this.findPath(u, u.dest, occMap, zones);
        u.pathGoal = { q: u.dest.q, r: u.dest.r };
        step = u.path && u.path.length ? u.path[0] : null;
      }
      if (!step) {
        // no route at all right now: hold position, keep dest, retry shortly
        u.nextMoveAt = now + 800;
        if (hexDist(u, u.dest) <= 1) { u.dest = null; u.path = null; } // as close as possible
        continue;
      }
      const occ = occMap.get(key(step.q, step.r));
      if (occ && this.areAllies(u.ownerId, occ.ownerId)) {
        // even the replanned road is blocked by a friend right now: wait a bit
        u.nextMoveAt = now + 400;
        continue;
      }
      const civ = CIVS[p.civ];
      const terrMult = TERRAIN[this.tile(step.q, step.r).terrain].moveMult || 1;
      u.nextMoveAt = now + stats.moveMs * terrMult * (u.boat ? (civ.boatMoveMult || 1) : (civ.speedMult || 1)) * this.moveMult;

      if (occ) { this.fight(u, occ); if (!this.units.has(occ.id)) occMap.delete(key(occ.q, occ.r)); continue; }
      const city = this.cityAt(step.q, step.r);
      if (city && !this.areAllies(u.ownerId, city.ownerId)) {
        this.attackCity(u, city);
        continue;
      }
      occMap.delete(key(u.q, u.r));
      u.q = step.q; u.r = step.r;
      u.path.shift();
      occMap.set(key(u.q, u.r), u);
      const t = this.tile(u.q, u.r);
      // embark / disembark
      if (t.terrain === 'water' && !u.boat) u.boat = true;
      else if (t.terrain !== 'water' && u.boat) u.boat = false;
      this.reveal(p, u.q, u.r, UNITS[u.type].vision || 1);
      if (t.village) this.captureVillage(p, u, t);
    }
  }

  rangedTarget(u, range) {
    let best = null; let bestD = Infinity;
    for (const e of this.units.values()) {
      if (this.areAllies(u.ownerId, e.ownerId)) continue;
      const d = hexDist(u, e);
      if (d <= range && d < bestD) { bestD = d; best = { kind: 'unit', t: e }; }
    }
    if (!best) {
      for (const c of this.cities.values()) {
        if (this.areAllies(u.ownerId, c.ownerId)) continue;
        const d = hexDist(u, c);
        if (d <= range && d < bestD) { bestD = d; best = { kind: 'city', t: c }; }
      }
    }
    return best;
  }

  rangedAttack(u, target) {
    const ap = this.player(u.ownerId);
    const aDef = this.unitStats(u);
    if (target.kind === 'unit') {
      const def = target.t;
      const dp = this.player(def.ownerId);
      const dDef = this.unitStats(def);
      const defCity = this.cityAt(def.q, def.r);
      const defense = this.defenseOf(def, dDef, !!defCity);
      const dmg = Math.max(2, Math.round(this.attackOf(u, aDef) - defense / 2 + Math.random() * 4));
      def.hp -= dmg; // no retaliation at range
      if (def.hp <= 0) {
        this.units.delete(def.id);
        ap.points += GAME.points.kill; ap.kills++;
        this.pushEvent(`${ap.name}'s ${aDef.name} shot down ${dp.name}'s ${dDef.name}!`);
      }
    } else {
      const city = target.t;
      if (Date.now() - this.startTime < GAME.peaceMs) return;
      const cp = this.player(city.ownerId);
      const walls = city.buildings.includes('walls') ? BUILDINGS.walls.defBonus * upgradeMult(this.buildingLevel(city.ownerId, 'walls')) : 0;
      const atk = this.attackOf(u, aDef) * (u.type === 'catapult' ? 1.5 : 1);
      const dmg = Math.max(1, Math.round(atk - (3 + walls) / 2 * (CIVS[cp.civ].defMult || 1) + Math.random() * 3));
      city.hp -= dmg; // no counter-damage at range
      if (city.hp <= 0) this.captureCity(u, city);
    }
  }

  captureVillage(p, u, t) {
    this.foundCityAt(p, t.q, t.r);
    this.pushEvent(`${p.name} captured a village!`);
    // unit steps aside so city tile is clear for defense logic
  }

  fight(att, def) {
    const ap = this.player(att.ownerId); const dp = this.player(def.ownerId);
    const aDef = this.unitStats(att); const dDef = this.unitStats(def);
    let atk = this.attackOf(att, aDef);
    const defCity = this.cityAt(def.q, def.r);
    let defense = this.defenseOf(def, dDef, !!defCity);
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
    const aDef = this.unitStats(u);
    const walls = city.buildings.includes('walls') ? BUILDINGS.walls.defBonus * upgradeMult(this.buildingLevel(city.ownerId, 'walls')) : 0;
    const atk = this.attackOf(u, aDef) * (u.type === 'catapult' && !u.boat ? 1.5 : 1);
    const dmg = Math.max(1, Math.round(atk - (3 + walls) / 2 * (CIVS[cp.civ].defMult || 1) + Math.random() * 3));
    city.hp -= dmg;
    u.hp -= Math.max(1, Math.round(3 + walls / 2 - aDef.def / 3));
    if (u.hp <= 0) { this.units.delete(u.id); return; }
    if (city.hp <= 0) this.captureCity(u, city);
  }

  captureCity(u, city) {
    const ap = this.player(u.ownerId); const cp = this.player(city.ownerId);
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

  checkEnd() {
    const alive = [...this.players.values()].filter(p => p.alive);
    const humanOrAll = alive;
    let winner = null;
    if (humanOrAll.length === 1) winner = humanOrAll[0];
    // alliance victory: all alive players mutually allied
    else if (alive.length > 1 && alive.every(p => alive.every(o => o.id === p.id || p.allies.has(o.id)))) {
      winner = alive.reduce((a, b) => (a.points >= b.points ? a : b));
    }
    if (this.winMode !== 'elimination') {
      const overThreshold = alive.filter(p => p.points >= GAME.pointsToWin);
      if (overThreshold.length) winner = overThreshold.reduce((a, b) => (a.points >= b.points ? a : b));
      if (!winner && this.timeLeft() <= 0) {
        winner = alive.reduce((a, b) => (a.points >= b.points ? a : b), alive[0]);
      }
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
      .map(u => ({ id: u.id, ownerId: u.ownerId, type: u.type, q: u.q, r: u.r, hp: Math.round(u.hp), maxHp: u.maxHp, autoAttack: u.autoAttack, boat: u.boat, dest: u.ownerId === pid ? u.dest : null, level: this.unitLevel(u.ownerId, u.type) }));
    const cities = [...this.cities.values()]
      .filter(c => p.explored.has(key(c.q, c.r)))
      .map(c => ({ id: c.id, ownerId: c.ownerId, q: c.q, r: c.r, name: c.name, hp: Math.round(c.hp), maxHp: c.maxHp, buildings: c.buildings, capital: c.capital, autoTrain: c.autoTrain }));
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
      upgrades: p.upgrades,
      tiles: visibleTiles, units, cities, players,
      timeLeft: this.timeLeft(),
      over: this.over, winner: this.winner,
      events: this.events.filter(e => !e.to || e.to.includes(pid)).map(e => e.text),
      pointsToWin: this.winMode === 'elimination' ? null : GAME.pointsToWin,
      winMode: this.winMode, speed: this.speed,
      mapSize: this.mapSize, mapType: this.mapType,
    };
  }
}

module.exports = { Game };
