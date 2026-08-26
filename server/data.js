// Static game definitions shared with the client via the "defs" message.

const CIVS = {
  valdorn: {
    name: 'Valdorn', color: '#e05252',
    desc: 'Warlords: units +15% attack, warriors +2 attack. Weakness: -20% science',
    atkMult: 1.15, warriorAtkBonus: 2, sciMult: 0.8,
  },
  sylvara: {
    name: 'Sylvara', color: '#52c47a',
    desc: 'Forest folk: +50% wood income, buildings -15% cost. Weakness: units 15% slower',
    woodMult: 1.5, buildDiscount: 0.85, speedMult: 1.15,
  },
  kharim: {
    name: 'Kharim', color: '#e0c352',
    desc: 'Desert nomads: units move 30% faster, starts with a scout. Weakness: -25% food income',
    speedMult: 0.7, startScout: true, foodMult: 0.75,
  },
  thalassi: {
    name: 'Thalassi', color: '#52b8c4',
    desc: 'Sea people: starts with Seafaring, boats 30% faster and +3 attack, +25% gold. Weakness: -20% stone, land units -10% attack',
    startTech: 'seafaring', boatMoveMult: 0.7, boatAtkBonus: 3, goldMult: 1.25, stoneMult: 0.8, landAtkMult: 0.9,
  },
  grimmark: {
    name: 'Grimmark', color: '#9aa4b5',
    desc: 'Mountain clans: +50% stone, +25% defense, starts with Masonry, free walls. Weakness: -20% gold, units 10% slower',
    stoneMult: 1.5, defMult: 1.25, startTech: 'masonry', freeWalls: true, goldMult: 0.8, speedMult: 1.1,
  },
  aurelia: {
    name: 'Aurelia', color: '#b06cd9',
    desc: 'Scholars: +40% science, techs cost 15% less. Weakness: units -15% attack',
    sciMult: 1.4, techCostMult: 0.85, atkMult: 0.85,
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
  archer:   { name: 'Archer',   cost: { food: 30, wood: 25 }, hp: 16, atk: 6, def: 3, moveMs: 1400, tech: 'archery', range: 2 },
  knight:   { name: 'Knight',   cost: { food: 40, gold: 35 }, hp: 24, atk: 11, def: 5, moveMs: 900, tech: 'chivalry' },
  catapult: { name: 'Catapult', cost: { wood: 55, stone: 40 }, hp: 14, atk: 16, def: 1, moveMs: 3200, tech: 'engineering', range: 3 },
  settler:  { name: 'Settler',  cost: { food: 60, gold: 30 }, hp: 10, atk: 0, def: 1, moveMs: 1800, tech: 'expansion' },
  giant:    { name: 'Mountain Giant', cost: { food: 80, stone: 60, gold: 50 }, hp: 60, atk: 12, def: 8, moveMs: 2800, tech: 'mountainlore', range: 1, canMountain: true },
};

// stats a unit uses while embarked on a boat (hp is kept from the unit)
const BOAT = { name: 'Boat', atk: 7, def: 3, range: 2, moveMs: 1000 };

const BUILDINGS = {
  farm:    { name: 'Farm',    cost: { wood: 20 },            income: { food: 3 },    tech: 'farming', points: 5 },
  sawmill: { name: 'Sawmill', cost: { gold: 20 },            income: { wood: 3 },    tech: null, points: 5 },
  mine:    { name: 'Mine',    cost: { wood: 25 },            income: { stone: 3 },   tech: 'masonry', points: 5 },
  market:  { name: 'Market',  cost: { wood: 25, stone: 10 }, income: { gold: 4 },    tech: 'trade', points: 10 },
  library: { name: 'Library', cost: { wood: 30 },            income: { science: 3 }, tech: 'writing', points: 10 },
  walls:   { name: 'Walls',   cost: { stone: 30 },           defBonus: 6,            tech: 'masonry', points: 5 },
  temple:  { name: 'Temple',  cost: { gold: 40, stone: 20 }, pointsPerSec: 0.4,      tech: 'philosophy', points: 20 },
  port:    { name: 'Port',    cost: { wood: 30, gold: 25 },  portRange: 3,           tech: 'seafaring', points: 10 },
};

const TECHS = {
  farming:     { name: 'Farming',     cost: 8,  req: null,        unlocks: 'Farm building' },
  writing:     { name: 'Writing',     cost: 10, req: null,        unlocks: 'Library building' },
  masonry:     { name: 'Masonry',     cost: 12, req: null,        unlocks: 'Mine, Walls, Defender' },
  archery:     { name: 'Archery',     cost: 14, req: null,        unlocks: 'Archer unit' },
  trade:       { name: 'Trade',       cost: 16, req: 'writing',   unlocks: 'Market building' },
  expansion:   { name: 'Expansion',   cost: 18, req: 'farming',   unlocks: 'Settler unit (found cities)' },
  chivalry:    { name: 'Chivalry',    cost: 22, req: 'archery',   unlocks: 'Knight unit' },
  philosophy:  { name: 'Philosophy',  cost: 24, req: 'writing',   unlocks: 'Temple (points over time)' },
  engineering: { name: 'Engineering', cost: 26, req: 'masonry',   unlocks: 'Catapult unit' },
  banking:     { name: 'Banking',     cost: 28, req: 'trade',     unlocks: '+50% gold income' },
  seafaring:   { name: 'Seafaring',   cost: 20, req: 'writing',   unlocks: 'Port building (boats on water)' },
  mountainlore:{ name: 'Mountain Lore', cost: 24, req: 'masonry', unlocks: 'Mountain Giant unit' },
};

// unit/building upgrade levels: each level gives +5% (attack/hp/def for units,
// production for buildings); cost in science scales 1.25x per level
const UPGRADES = {
  unitBase: 12, buildingBase: 10, bonusPerLevel: 0.05, costGrowth: 1.25, maxLevel: 20,
};
function upgradeCost(base, level) { return Math.ceil(base * Math.pow(UPGRADES.costGrowth, level)); }
function upgradeMult(level) { return 1 + UPGRADES.bonusPerLevel * (level || 0); }

const GAME = {
  durationMs: 10 * 60 * 1000,
  pointsToWin: 1500,
  tickMs: 1000,
  peaceMs: 90 * 1000, // no city attacks in the first 90s
  mapRadius: 11,
  maxPlayers: 10,
  points: { tech: 12, city: 40, kill: 8, tileExplored: 0.05 },
};

module.exports = { CIVS, TERRAIN, BONUSES, UNITS, BUILDINGS, TECHS, GAME, BOAT, UPGRADES, upgradeCost, upgradeMult };
