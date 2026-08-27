/* Entry point for the static (GitHub Pages) single-player build.
 * Bundles the authoritative game engine and exposes a WebSocket-compatible
 * LocalSocket that runs the whole "server" inside the browser. */
const { Game } = require('../server/game');
const { Bot } = require('../server/bot');
const { CIVS, UNITS, BUILDINGS, TECHS, GAME, BOAT, UPGRADES } = require('../server/data');

const BOT_NAMES = ['Ada', 'Brutus', 'Cleo', 'Darius', 'Elena', 'Falco', 'Gaius', 'Hilda', 'Ivar', 'Juno'];
const sanitize = s => String(s || '').replace(/[<>]/g, '').slice(0, 20);

class LocalSocket {
  constructor() {
    this.readyState = 1;
    this.onmessage = null;
    this.onclose = null;
    this.playerId = `p${Math.random().toString(36).slice(2, 10)}`;
    this.room = null;
    this.nextBot = 1;
    setTimeout(() => {
      this._emit({ type: 'defs', civs: CIVS, units: UNITS, buildings: BUILDINGS, techs: TECHS, game: GAME, boat: BOAT, upgrades: UPGRADES, you: this.playerId });
      this._emit({ type: 'rooms', rooms: [] });
    }, 0);
  }

  _emit(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
  }

  _lobby() {
    const r = this.room;
    this._emit({
      type: 'lobby', roomId: r.id,
      players: r.players.map(p => ({ id: p.id, name: p.name, civ: p.civ, isBot: p.isBot, botLevel: p.botLevel, host: p.id === this.playerId })),
      started: !!r.game,
    });
  }

  send(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const r = this.room;
    const g = r?.game;
    switch (m.type) {
      case 'listRooms': this._emit({ type: 'rooms', rooms: [] }); break;
      case 'createRoom':
        this.room = {
          id: 'LOCAL', game: null, bots: [],
          players: [{ id: this.playerId, name: sanitize(m.name) || 'Player', civ: m.civ || 'valdorn', isBot: false }],
        };
        this._lobby();
        break;
      case 'setCiv': {
        const me = r?.players.find(p => p.id === this.playerId);
        if (me && !r.game && CIVS[m.civ]) { me.civ = m.civ; this._lobby(); }
        break;
      }
      case 'addBot': {
        if (!r || r.game || r.players.length >= GAME.maxPlayers) break;
        const civKeys = Object.keys(CIVS);
        r.players.push({
          id: `bot${this.nextBot}`, name: `${BOT_NAMES[this.nextBot % BOT_NAMES.length]} (bot)`,
          civ: civKeys[Math.floor(Math.random() * civKeys.length)],
          isBot: true, botLevel: ['peaceful', 'easy', 'medium', 'hard', 'insane', 'passive'].includes(m.level) ? m.level : 'medium',
        });
        this.nextBot++;
        this._lobby();
        break;
      }
      case 'removeBot': {
        if (!r || r.game) break;
        const i = r.players.findIndex(p => p.isBot);
        if (i >= 0) { r.players.splice(i, 1); this._lobby(); }
        break;
      }
      case 'start': this._start({ winMode: m.winMode, speed: m.speed, mapSize: m.mapSize, mapType: m.mapType }); break;
      case 'action': {
        if (!g) break;
        const pid = this.playerId;
        if (m.action === 'move') g.actMove(pid, m.unitId, m.q, m.r);
        else if (m.action === 'stop') g.actStop(pid, m.unitId);
        else if (m.action === 'autoattack') g.actAutoAttack(pid, m.unitId, m.range ?? (m.on ? 3 : 0));
        else if (m.action === 'autotrain') g.actAutoTrain(pid, m.cityId, m.unit);
        else if (m.action === 'cityrally') g.actCityRally(pid, m.cityId, m.q, m.r);
        else if (m.action === 'cityautoattack') g.actCityAutoAttack(pid, m.cityId, m.radius);
        else if (m.action === 'train') g.actTrain(pid, m.cityId, m.unit);
        else if (m.action === 'build') g.actBuild(pid, m.cityId, m.building);
        else if (m.action === 'research') g.actResearch(pid, m.tech);
        else if (m.action === 'upgrade') g.actUpgrade(pid, m.kind, m.target);
        else if (m.action === 'found') g.actFoundCity(pid, m.unitId);
        else if (m.action === 'ally') g.actAlly(pid, m.target, !!m.accept);
        break;
      }
      case 'chat': {
        if (!g) break;
        const msg = g.actChat(this.playerId, m.text, !!m.alliesOnly);
        if (msg && (!msg.to || msg.to.includes(this.playerId))) this._emit({ type: 'chat', msg });
        break;
      }
    }
  }

  _start(opts = {}) {
    const r = this.room;
    if (!r || r.game || r.players.length < 2) return;
    r.game = new Game(r.players.map(p => ({ id: p.id, name: p.name, civ: p.civ, isBot: p.isBot, botLevel: p.botLevel })), opts);
    r.bots = r.players.filter(p => p.isBot).map(p => new Bot(r.game, p.id));
    const sentTiles = new Set();
    let lastIncome = Date.now();
    r.interval = setInterval(() => {
      const g = r.game;
      const now = Date.now();
      if (now - lastIncome >= 1000) { lastIncome = now; g.income(); g.autoTrainTick(); }
      g.autoAttackTick();
      g.moveUnits();
      for (const b of r.bots) b.step(now);
      g.checkEnd();
      g.events = g.events.filter(e => now - e.ts < 4000);
      this._emit(g.viewFor(this.playerId, sentTiles));
      g.dirtyTiles.clear();
      if (g.over) clearInterval(r.interval);
    }, 300);
    this._lobby();
  }
}

window.LocalSocket = LocalSocket;
