// Static game definitions shared with the client via the "defs" message.

const CIVS = {
  imperius: {
    name: 'Imperius', color: '#e05252',
    desc: '+25% gold income, cheaper buildings (-10%)',
    goldMult: 1.25, buildDiscount: 0.9,
  },
  bardur: {
    name: 'Bardur', color: '#5290e0',
    desc: '+25% food income, warriors +2 attack',
    foodMult: 1.25, warriorAtkBonus: 2,
  },
  oumaji: {
    name: 'Oumaji', color: '#e0c352',
    desc: 'Units move 25% faster, starts with a scout',
    speedMult: 0.75, startScout: true,
  },
  quetzali: {
    name: 'Quetzali', color: '#52c47a',
    desc: '+30% city defense, walls are free after research',
    defMult: 1.3, freeWalls: true,
  },
  zebasi: {
    name: 'Zebasi', color: '#b06cd9',
    desc: '+30% science, starts with Farming researched',
    sciMult: 1.3, startTech: 'farming',
  },
};

const TERRAIN = {
  water:    { move: false, food: 0, wood: 0, stone: 0, gold: 0 },
  grass:    { move: true,  food: 2, wood: 0, stone: 0, gold: 1 },
  forest:   { move: true,  food: 1, wood: 2, stone: 0, gold: 0 },
  hill:     { move: true,  food: 0, wood: 0, stone: 2, gold: 1 },
  mountain: { move: false, food: 0, wood: 0, stone: 0, gold: 0 },
};

// bonus resource on a tile doubles that yield & gives points when city works it
const BONUSES = ['fruit', 'game', 'ore', 'crop', 'fish'];

const UNITS = {
  warrior:  { name: 'Warrior',  cost: { food: 30, gold: 10 }, hp: 20, atk: 6, def: 4, moveMs: 1400, tech: null },
  scout:    { name: 'Scout',    cost: { food: 20, gold: 10 }, hp: 12, atk: 2, def: 2, moveMs: 800,  tech: null, vision: 2 },
  defender: { name: 'Defender', cost: { food: 25, stone: 15 }, hp: 28, atk: 3, def: 8, moveMs: 1800, tech: 'masonry' },
  archer:   { name: 'Archer',   cost: { food: 25, wood: 20 }, hp: 16, atk: 8, def: 3, moveMs: 1400, tech: 'archery' },
  knight:   { name: 'Knight',   cost: { food: 40, gold: 35 }, hp: 24, atk: 11, def: 5, moveMs: 900, tech: 'chivalry' },
  catapult: { name: 'Catapult', cost: { wood: 45, stone: 30 }, hp: 14, atk: 16, def: 1, moveMs: 2200, tech: 'engineering' },
  settler:  { name: 'Settler',  cost: { food: 60, gold: 30 }, hp: 10, atk: 0, def: 1, moveMs: 1800, tech: 'expansion' },
};

const BUILDINGS = {
  farm:    { name: 'Farm',    cost: { wood: 20 },            income: { food: 3 },    tech: 'farming', points: 5 },
  sawmill: { name: 'Sawmill', cost: { gold: 20 },            income: { wood: 3 },    tech: null, points: 5 },
  mine:    { name: 'Mine',    cost: { wood: 25 },            income: { stone: 3 },   tech: 'masonry', points: 5 },
  market:  { name: 'Market',  cost: { wood: 25, stone: 10 }, income: { gold: 4 },    tech: 'trade', points: 10 },
  library: { name: 'Library', cost: { wood: 30 },            income: { science: 3 }, tech: 'writing', points: 10 },
  walls:   { name: 'Walls',   cost: { stone: 30 },           defBonus: 6,            tech: 'masonry', points: 5 },
  temple:  { name: 'Temple',  cost: { gold: 40, stone: 20 }, pointsPerSec: 1,        tech: 'philosophy', points: 20 },
};

const TECHS = {
  farming:     { name: 'Farming',     cost: 8,  req: null,        unlocks: 'Farm building' },
  writing:     { name: 'Writing',     cost: 10, req: null,        unlocks: 'Library building' },
  masonry:     { name: 'Masonry',     cost: 12, req: null,        unlocks: 'Mine, Walls, Defender' },
  archery:     { name: 'Archery',     cost: 14, req: null,        unlocks: 'Archer unit' },
  trade:       { name: 'Trade',       cost: 16, req: 'writing',   unlocks: 'Market building' },
  expansion:   { name: 'Expansion',   cost: 18, req: 'farming',   unlocks: 'Settler unit (found cities)' },
  chivalry:    { name: 'Chivalry',    cost: 22, req: 'archery',   unlocks: 'Knight unit' },
  philosophy:  { name: 'Philosophy',  cost: 24, req: 'writing',   unlocks: 'Temple (+1 pt/sec)' },
  engineering: { name: 'Engineering', cost: 26, req: 'masonry',   unlocks: 'Catapult unit' },
  banking:     { name: 'Banking',     cost: 28, req: 'trade',     unlocks: '+50% gold income' },
};

const GAME = {
  durationMs: 10 * 60 * 1000,
  pointsToWin: 1000,
  tickMs: 1000,
  peaceMs: 90 * 1000, // no city attacks in the first 90s
  mapRadius: 11,
  maxPlayers: 4,
  points: { tech: 15, city: 50, kill: 10, tileExplored: 0.1 },
};

module.exports = { CIVS, TERRAIN, BONUSES, UNITS, BUILDINGS, TECHS, GAME };
