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

// area multiplier relative to the "normal" map
const MAP_SIZES = {
  tiny: 0.25, small: 0.5, normal: 1, big: 2, huge: 4, gigantic: 10,
};
const MAP_TYPES = ['pangea', 'continents', 'islands', 'lakes', 'dryland', 'mountainpass'];

// smooth 2D value noise (hash grid + smoothstep interpolation)
function makeNoise(rnd) {
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (xi, yi) => perm[(perm[xi & 255] + yi) & 255] / 255;
  const smooth = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, octaves = 3) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };
}

// per-map-type generation parameters
const TYPE_PARAMS = {
  //             waterFrac: target share of the map covered by water
  //             edgeFall:  how strongly the map edge pushes toward ocean
  //             freq:      noise frequency (higher = smaller landmasses)
  //             mtnFrac:   target share of land turned into mountains
  //             ridged:    mountains form connected ridges instead of specks
  pangea:       { waterFrac: 0.50, edgeFall: 0.55, freq: 0.09, mtnFrac: 0.12, ridged: false },
  continents:   { waterFrac: 0.45, edgeFall: 0.30, freq: 0.13, mtnFrac: 0.13, ridged: false },
  islands:      { waterFrac: 0.68, edgeFall: 0.25, freq: 0.22, mtnFrac: 0.08, ridged: false },
  lakes:        { waterFrac: 0.25, edgeFall: 0.05, freq: 0.18, mtnFrac: 0.10, ridged: false },
  dryland:      { waterFrac: 0.03, edgeFall: 0.02, freq: 0.12, mtnFrac: 0.12, ridged: false },
  mountainpass: { waterFrac: 0.12, edgeFall: 0.10, freq: 0.11, mtnFrac: 0.33, ridged: true },
};

function generateMap(seed, opts = {}) {
  const rnd = mulberry32(seed);
  const sizeMult = MAP_SIZES[opts.mapSize] ?? 1;
  const type = MAP_TYPES.includes(opts.mapType) ? opts.mapType : 'continents';
  const R = Math.max(5, Math.round(GAME.mapRadius * Math.sqrt(sizeMult)));
  const P = TYPE_PARAMS[type];
  const elevNoise = makeNoise(rnd);
  const mtnNoise = makeNoise(rnd);
  const bioNoise = makeNoise(rnd);
  const tiles = new Map();

  // pass 1: compute continuous fields for every tile
  const cells = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      // axial -> cartesian for smooth noise
      const x = (q + r / 2) * P.freq, y = r * 0.866 * P.freq;
      const edge = hexDist({ q, r }, { q: 0, r: 0 }) / R; // 0 center .. 1 edge
      const elev = elevNoise(x, y, 3) - Math.pow(edge, 2.2) * P.edgeFall;
      let m = mtnNoise(x * 1.4, y * 1.4, 3);
      if (P.ridged) m = 1 - Math.abs(2 * m - 1); // ridged: high along noise midlines -> connected ranges
      cells.push({ q, r, edge, elev, m, b: bioNoise(x * 2, y * 2, 2) });
    }
  }
  // percentile thresholds so target fractions hold regardless of noise distribution
  const sortedElev = cells.map(c => c.elev).sort((a, b) => a - b);
  const waterLvl = sortedElev[Math.min(cells.length - 1, Math.floor(cells.length * P.waterFrac))];
  const sortedM = cells.map(c => c.m).sort((a, b) => a - b);
  const mtnCut = sortedM[Math.min(cells.length - 1, Math.floor(cells.length * (1 - P.mtnFrac)))];
  const elevSpan = (sortedElev[cells.length - 1] - sortedElev[0]) || 1;

  const land = [];
  for (const c of cells) {
    let terrain;
    if (c.edge >= 0.995 && type !== 'dryland') terrain = 'water'; // thin ocean rim
    else if (c.elev < waterLvl) {
      terrain = 'water';
      // lakes/islands maps: small islands can poke out of big water bodies
      if ((type === 'lakes' || type === 'islands') && c.elev > waterLvl - elevSpan * 0.03 && rnd() < 0.3) terrain = 'grass';
    } else if (c.m > mtnCut) terrain = 'mountain';
    else if (c.b > 0.62) terrain = 'forest';
    else if (c.b < 0.34) terrain = 'hill';
    else terrain = 'grass';
    let bonus = null;
    if (TERRAIN[terrain].move && rnd() < 0.14) bonus = BONUSES[Math.floor(rnd() * BONUSES.length)];
    const t = { q: c.q, r: c.r, terrain, bonus, village: false, cityId: null };
    tiles.set(key(c.q, c.r), t);
    if (TERRAIN[terrain].move) land.push(t);
  }

  // start positions: spread out land tiles with a decent connected area
  const starts = [];
  const nStarts = Math.min(10, Math.max(2, opts.players || 4));
  const angles = Array.from({ length: nStarts }, (_, i) => ((i + 0.5) / nStarts) * Math.PI * 2 + rnd() * (Math.PI / nStarts));
  for (const ang of angles) {
    let placed = null;
    for (let rad = Math.floor(R * 0.62); rad >= 2 && !placed; rad--) {
      const q = Math.round(Math.cos(ang) * rad);
      const r = Math.round(Math.sin(ang) * rad - (Math.cos(ang) * rad) / 2);
      const t = tiles.get(key(q, r));
      if (t && TERRAIN[t.terrain].move && regionSize(tiles, t, 12) >= 12 && !starts.includes(t)) placed = t;
    }
    if (!placed) {
      placed = land.find(t => !starts.includes(t) && regionSize(tiles, t, 12) >= 12) ||
        land.find(t => !starts.includes(t)) || land[0];
    }
    placed.terrain = 'grass'; placed.bonus = null;
    // guarantee at least 2 walkable neighbors so units can spawn/leave
    let open = 0;
    for (const [nq, nr] of neighbors(placed.q, placed.r)) {
      const n = tiles.get(key(nq, nr));
      if (!n) continue;
      if (TERRAIN[n.terrain].move) open++;
      else if (open < 2) { n.terrain = 'grass'; n.bonus = null; open++; }
    }
    starts.push(placed);
  }

  // neutral villages to capture (scale with map area)
  const wanted = Math.max(4, Math.round(6 * sizeMult));
  let villages = 0; let attempts = 0;
  const tileArr = [...tiles.values()];
  while (villages < wanted && attempts++ < 4000) {
    const t = tileArr[Math.floor(rnd() * tileArr.length)];
    if (!TERRAIN[t.terrain].move || t.village) continue;
    if (starts.some(s => hexDist(t, s) < 4)) continue;
    if (tileArr.some(o => o.village && hexDist(t, o) < 4)) continue;
    t.village = true; t.bonus = null;
    villages++;
  }

  return { tiles, starts, seed };
}

// flood-fill up to `cap` walkable tiles reachable from t
function regionSize(tiles, t, cap) {
  const seen = new Set([key(t.q, t.r)]);
  const stack = [t];
  while (stack.length && seen.size < cap) {
    const cur = stack.pop();
    for (const [nq, nr] of neighbors(cur.q, cur.r)) {
      const k = key(nq, nr);
      if (seen.has(k)) continue;
      const n = tiles.get(k);
      if (n && TERRAIN[n.terrain].move) { seen.add(k); stack.push(n); }
    }
  }
  return seen.size;
}

module.exports = { generateMap, neighbors, hexDist, key, DIRS, MAP_SIZES, MAP_TYPES };
