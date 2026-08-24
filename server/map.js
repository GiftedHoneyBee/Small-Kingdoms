// Random hex map generation (axial coordinates, pointy-top).
const { TERRAIN, BONUSES, GAME } = require('./data');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q, r) => `${q},${r}`;
const hexDist = (a, b) =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

function generateMap(seed) {
  const rnd = mulberry32(seed);
  const R = GAME.mapRadius;
  const tiles = new Map();

  // noise-ish terrain: a few random "blob" centers per terrain type
  const blobs = [];
  const types = ['forest', 'forest', 'hill', 'hill', 'water', 'water', 'water', 'mountain'];
  for (const t of types) {
    blobs.push({
      t,
      q: Math.round((rnd() * 2 - 1) * R),
      r: Math.round((rnd() * 2 - 1) * R),
      size: 2 + rnd() * 3.5,
    });
  }

  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const distEdge = R - hexDist({ q, r }, { q: 0, r: 0 });
      let terrain = 'grass';
      // ocean ring at the edge
      if (distEdge <= 0 || (distEdge === 1 && rnd() < 0.55)) terrain = 'water';
      else {
        let best = null; let bestScore = 0;
        for (const b of blobs) {
          const d = hexDist({ q, r }, b);
          const score = b.size - d + rnd() * 1.6;
          if (score > bestScore) { bestScore = score; best = b.t; }
        }
        if (best && bestScore > 1.2) terrain = best;
      }
      let bonus = null;
      if (TERRAIN[terrain].move && rnd() < 0.14) {
        bonus = BONUSES[Math.floor(rnd() * BONUSES.length)];
      }
      tiles.set(key(q, r), {
        q, r, terrain, bonus,
        village: false, cityId: null,
      });
    }
  }

  // start positions: 4 spread out land tiles
  const starts = [];
  const angles = [0.125, 0.375, 0.625, 0.875].map(a => a * Math.PI * 2 + rnd() * 0.5);
  for (const ang of angles) {
    let placed = null;
    for (let rad = Math.floor(R * 0.62); rad >= 2 && !placed; rad--) {
      const q = Math.round(Math.cos(ang) * rad);
      const r = Math.round(Math.sin(ang) * rad - (Math.cos(ang) * rad) / 2);
      const t = tiles.get(key(q, r));
      if (t && TERRAIN[t.terrain].move) placed = t;
    }
    if (!placed) placed = [...tiles.values()].find(t => TERRAIN[t.terrain].move && !starts.includes(t));
    placed.terrain = 'grass'; placed.bonus = null;
    starts.push(placed);
  }

  // neutral villages to capture
  let villages = 0;
  const tileArr = [...tiles.values()];
  while (villages < 6) {
    const t = tileArr[Math.floor(rnd() * tileArr.length)];
    if (!TERRAIN[t.terrain].move || t.village) continue;
    if (starts.some(s => hexDist(t, s) < 4)) continue;
    if (tileArr.some(o => o.village && hexDist(t, o) < 4)) continue;
    t.village = true; t.bonus = null;
    villages++;
  }

  return { tiles, starts, seed };
}

module.exports = { generateMap, neighbors, hexDist, key, DIRS };
