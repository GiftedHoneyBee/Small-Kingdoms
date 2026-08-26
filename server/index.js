const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');
const { Bot } = require('./bot');
const { CIVS, UNITS, BUILDINGS, TECHS, GAME, BOAT, UPGRADES } = require('./data');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false, lastModified: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store'),
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // roomId -> room
let nextRoom = 100;
let nextBot = 1;

const BOT_NAMES = ['Ada', 'Brutus', 'Cleo', 'Darius', 'Elena', 'Falco', 'Gaius', 'Hilda', 'Ivar', 'Juno'];

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function lobbyState(room) {
  return {
    type: 'lobby',
    roomId: room.id,
    players: room.players.map(p => ({
      id: p.id, name: p.name, civ: p.civ, isBot: p.isBot, botLevel: p.botLevel, host: p.id === room.hostId,
    })),
    started: !!room.game,
  };
}

function broadcastLobby(room) {
  for (const p of room.players) if (p.ws) send(p.ws, lobbyState(room));
}

function roomList() {
  return {
    type: 'rooms',
    rooms: [...rooms.values()].filter(r => !r.game && r.players.length < GAME.maxPlayers)
      .map(r => ({ id: r.id, count: r.players.length, host: r.players.find(p => p.id === r.hostId)?.name })),
  };
}

function startGame(room, opts = {}) {
  if (room.game || room.players.length < 2) return;
  room.game = new Game(room.players.map(p => ({
    id: p.id, name: p.name, civ: p.civ, isBot: p.isBot, botLevel: p.botLevel,
  })), opts);
  room.bots = room.players.filter(p => p.isBot).map(p => new Bot(room.game, p.id));
  room.sentTiles = new Map(); // playerId -> Set of tile keys already sent
  for (const p of room.players) room.sentTiles.set(p.id, new Set());
  let lastIncome = Date.now();
  room.interval = setInterval(() => {
    const g = room.game;
    const now = Date.now();
    if (now - lastIncome >= 1000) { lastIncome = now; g.income(); g.autoTrainTick(); }
    g.autoAttackTick();
    g.moveUnits();
    for (const b of room.bots) b.step(now);
    g.checkEnd();
    g.events = g.events.filter(e => now - e.ts < 4000);
    for (const p of room.players) {
      if (p.ws) send(p.ws, g.viewFor(p.id, room.sentTiles.get(p.id)));
    }
    g.dirtyTiles.clear();
    if (g.over) {
      clearInterval(room.interval);
      setTimeout(() => rooms.delete(room.id), 60000);
    }
  }, 300);
  broadcastLobby(room);
}

wss.on('connection', (ws) => {
  ws.playerId = `p${Math.random().toString(36).slice(2, 10)}`;
  ws.roomId = null;
  send(ws, { type: 'defs', civs: CIVS, units: UNITS, buildings: BUILDINGS, techs: TECHS, game: GAME, boat: BOAT, upgrades: UPGRADES, you: ws.playerId });
  send(ws, roomList());

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = rooms.get(ws.roomId);
    const g = room?.game;

    switch (m.type) {
      case 'listRooms': send(ws, roomList()); break;

      case 'createRoom': {
        const id = `R${nextRoom++}`;
        const r = { id, hostId: ws.playerId, players: [], game: null, bots: [] };
        rooms.set(id, r);
        r.players.push({ id: ws.playerId, name: sanitize(m.name) || 'Player', civ: m.civ || 'valdorn', isBot: false, ws });
        ws.roomId = id;
        broadcastLobby(r);
        break;
      }

      case 'joinRoom': {
        const r = rooms.get(m.roomId);
        if (!r || r.game || r.players.length >= GAME.maxPlayers) { send(ws, { type: 'error', text: 'Cannot join that room.' }); break; }
        r.players.push({ id: ws.playerId, name: sanitize(m.name) || 'Player', civ: m.civ || 'valdorn', isBot: false, ws });
        ws.roomId = r.id;
        broadcastLobby(r);
        break;
      }

      case 'setCiv': {
        const me = room?.players.find(p => p.id === ws.playerId);
        if (me && !room.game && CIVS[m.civ]) { me.civ = m.civ; broadcastLobby(room); }
        break;
      }

      case 'addBot': {
        if (!room || room.game || room.hostId !== ws.playerId) break;
        if (room.players.length >= GAME.maxPlayers) break;
        const civKeys = Object.keys(CIVS);
        room.players.push({
          id: `bot${nextBot}`, name: `${BOT_NAMES[nextBot % BOT_NAMES.length]} (bot)`,
          civ: civKeys[Math.floor(Math.random() * civKeys.length)],
          isBot: true, botLevel: ['peaceful', 'easy', 'medium', 'hard', 'insane', 'passive'].includes(m.level) ? m.level : 'medium', ws: null,
        });
        nextBot++;
        broadcastLobby(room);
        break;
      }

      case 'removeBot': {
        if (!room || room.game || room.hostId !== ws.playerId) break;
        const i = room.players.findIndex(p => p.isBot);
        if (i >= 0) { room.players.splice(i, 1); broadcastLobby(room); }
        break;
      }

      case 'start': {
        if (room && room.hostId === ws.playerId) startGame(room, { winMode: m.winMode, speed: m.speed, mapSize: m.mapSize, mapType: m.mapType });
        break;
      }

      case 'action': {
        if (!g) break;
        const pid = ws.playerId;
        if (m.action === 'move') g.actMove(pid, m.unitId, m.q, m.r);
        else if (m.action === 'stop') g.actStop(pid, m.unitId);
        else if (m.action === 'autoattack') g.actAutoAttack(pid, m.unitId, m.range ?? (m.on ? 3 : 0));
        else if (m.action === 'autotrain') g.actAutoTrain(pid, m.cityId, m.unit);
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
        const msg = g.actChat(ws.playerId, m.text, !!m.alliesOnly);
        if (msg) {
          for (const p of room.players) {
            if (p.ws && (!msg.to || msg.to.includes(p.id))) send(p.ws, { type: 'chat', msg });
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    const me = room.players.find(p => p.id === ws.playerId);
    if (me) me.ws = null;
    if (!room.game) {
      room.players = room.players.filter(p => p.id !== ws.playerId);
      if (room.players.every(p => p.isBot)) rooms.delete(room.id);
      else {
        if (room.hostId === ws.playerId) room.hostId = room.players.find(p => !p.isBot)?.id;
        broadcastLobby(room);
      }
    }
  });
});

function sanitize(s) {
  return String(s || '').replace(/[<>]/g, '').slice(0, 20);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mini Empires running on http://localhost:${PORT}`));
