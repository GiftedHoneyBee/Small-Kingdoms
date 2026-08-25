/* Mini Empires client */
const $ = id => document.getElementById(id);
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

let DEFS = null, myId = null, state = null;
const tileMap = new Map();
let needsDraw = true;
let selectedCiv = 'imperius';
let selected = null; // {kind:'units', ids:[]} | {kind:'city', id}
let groupDest = null; // current group move destination
let cam = { x: 0, y: 0, scale: 34 };
const seenEvents = new Set();

const TERRAIN_COLORS = {
  water: '#1d4e79', grass: '#4e8f3c', forest: '#2d6b2a', hill: '#8a7b52', mountain: '#6b6f78',
};
const BONUS_ICONS = { fruit: '🍇', game: '🦌', ore: '⛏️', crop: '🌾', fish: '🐟' };
const PLAYER_COLORS = ['#e05252', '#5290e0', '#e0c352', '#52c47a'];
let colorById = {};
function assignColors(list) {
  colorById = {};
  list.forEach((p, i) => { colorById[p.id] = PLAYER_COLORS[i % PLAYER_COLORS.length]; });
}
const UNIT_ICONS = { warrior: '⚔️', scout: '👁️', defender: '🛡️', archer: '🏹', knight: '🐎', catapult: '💣', settler: '🚩' };

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'defs') { DEFS = m; myId = m.you; renderCivList(); }
  else if (m.type === 'rooms') renderRooms(m.rooms);
  else if (m.type === 'lobby') renderLobby(m);
  else if (m.type === 'state') { onState(m); }
  else if (m.type === 'chat') addChat(m.msg);
  else if (m.type === 'error') alert(m.text);
};
ws.onclose = () => { document.title = 'Disconnected — Mini Empires'; };

// ---------------- Lobby ----------------
function renderCivList() {
  const el = $('civ-list');
  el.innerHTML = '';
  for (const [k, c] of Object.entries(DEFS.civs)) {
    const d = document.createElement('div');
    d.className = 'civ' + (k === selectedCiv ? ' selected' : '');
    d.innerHTML = `<b style="color:${c.color}">${c.name}</b> <small>${c.desc}</small>`;
    d.onclick = () => { selectedCiv = k; renderCivList(); ws.send(JSON.stringify({ type: 'setCiv', civ: k })); };
    el.appendChild(d);
  }
}

function renderRooms(list) {
  const el = $('room-list');
  if (!list.length) { el.innerHTML = '<em>No open games — create one!</em>'; return; }
  el.innerHTML = '';
  for (const r of list) {
    const d = document.createElement('div');
    d.className = 'room-row';
    d.innerHTML = `<span>${r.host}'s game (${r.count}/4)</span>`;
    const b = document.createElement('button');
    b.textContent = 'Join';
    b.onclick = () => ws.send(JSON.stringify({ type: 'joinRoom', roomId: r.id, name: $('name-input').value, civ: selectedCiv }));
    d.appendChild(b);
    el.appendChild(d);
  }
}

$('create-btn').onclick = () => ws.send(JSON.stringify({ type: 'createRoom', name: $('name-input').value, civ: selectedCiv }));
$('add-bot-btn').onclick = () => ws.send(JSON.stringify({ type: 'addBot', level: $('bot-level').value }));
$('remove-bot-btn').onclick = () => ws.send(JSON.stringify({ type: 'removeBot' }));
$('start-btn').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
setInterval(() => { if (!state && $('lobby-room').classList.contains('hidden')) ws.readyState === 1 && ws.send(JSON.stringify({ type: 'listRooms' })); }, 2500);

let isHost = false;
function renderLobby(m) {
  $('lobby-setup').classList.add('hidden');
  $('lobby-room').classList.remove('hidden');
  $('room-id').textContent = m.roomId;
  isHost = m.players.some(p => p.id === myId && p.host);
  $('host-controls').style.display = isHost ? 'flex' : 'none';
  const el = $('room-players');
  el.innerHTML = '';
  assignColors(m.players);
  for (const p of m.players) {
    const d = document.createElement('div');
    d.className = 'p-row';
    const civ = DEFS.civs[p.civ];
    d.innerHTML = `<b style="color:${colorById[p.id]}">${p.name}</b> — ${civ.name}${p.isBot ? ` (${p.botLevel})` : ''}${p.host ? ' 👑' : ''}`;
    el.appendChild(d);
  }
}

// ---------------- Game state ----------------
function onState(s) {
  const first = !state;
  state = s;
  for (const t of s.tiles) tileMap.set(`${t.q},${t.r}`, t);
  needsDraw = true;
  assignColors(s.players);
  if (first) {
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
    resize();
    centerOnHome();
  }
  updateHud();
  if (s.over && s.winner) showGameOver();
}

function centerOnHome() {
  const c = state.cities.find(c => c.ownerId === myId);
  if (c) { const p = hexToPx(c.q, c.r); cam.x = p.x; cam.y = p.y; }
}

function myColor(pid) {
  return colorById[pid] || '#888';
}

function updateHud() {
  for (const k of ['food', 'wood', 'stone', 'gold', 'science']) {
    $('res-' + k).textContent = `${{ food: '🍎', wood: '🪵', stone: '🪨', gold: '🪙', science: '🔬' }[k]} ${state.res[k]}`;
  }
  const s = Math.ceil(state.timeLeft / 1000);
  $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const me = state.players.find(p => p.id === myId);
  $('mypoints').textContent = `⭐ ${me.points} / ${state.pointsToWin}`;

  // players panel (only rebuild when contents change)
  const pp = $('players-panel');
  const ppKey = JSON.stringify(state.players);
  if (pp.dataset.key === ppKey) { renderSelectPanel(); renderTechModal(); pushEvents(); return; }
  pp.dataset.key = ppKey;
  pp.innerHTML = '<h4>Players</h4>';
  for (const p of state.players) {
    const d = document.createElement('div');
    d.className = 'player-row' + (p.alive ? '' : ' dead');
    d.innerHTML = `<span class="dot" style="background:${colorById[p.id]}"></span>
      <span>${p.name}${p.id === myId ? ' (you)' : ''}</span> <span>⭐${p.points}</span>`;
    if (p.id !== myId && p.alive) {
      const b = document.createElement('button');
      if (p.requestedAlly) { b.textContent = 'Accept ally'; b.onclick = () => sendAction({ action: 'ally', target: p.id, accept: true }); }
      else if (p.isAlly) { b.textContent = 'Break ally'; b.onclick = () => sendAction({ action: 'ally', target: p.id, accept: false }); }
      else { b.textContent = 'Propose ally'; b.onclick = () => sendAction({ action: 'ally', target: p.id, accept: false }); }
      d.appendChild(b);
    }
    pp.appendChild(d);
  }

  renderSelectPanel();
  renderTechModal();
  pushEvents();
}

function pushEvents() {
  for (const ev of state.events) {
    if (seenEvents.has(ev)) continue;
    seenEvents.add(ev);
    const d = document.createElement('div');
    d.textContent = ev;
    $('events').appendChild(d);
    setTimeout(() => d.remove(), 6000);
    setTimeout(() => seenEvents.delete(ev), 8000);
  }
}

function sendAction(a) { ws.send(JSON.stringify({ type: 'action', ...a })); }

let selectKey = '';
function renderSelectPanel(force = false) {
  const el = $('select-panel');
  const k = JSON.stringify([selected, selected && (selected.kind === 'units'
    ? selected.ids.map(id => state.units.find(u => u.id === id))
    : state.cities.find(c => c.id === selected.id)), state.res, state.techs]);
  if (!force && k === selectKey) return;
  selectKey = k;
  if (!selected) { el.innerHTML = '<em>Select one of your units or cities. Click more of your units to group them; click a tile to move. Esc deselects.</em>'; return; }
  if (selected.kind === 'units') {
    const us = selected.ids.map(id => state.units.find(u => u.id === id)).filter(Boolean);
    selected.ids = us.map(u => u.id);
    if (!us.length) { selected = null; renderSelectPanel(true); return; }
    if (us.length === 1) {
      const u = us[0];
      const def = DEFS.units[u.type];
      el.innerHTML = `<h4>${UNIT_ICONS[u.type]} ${def.name}</h4>HP ${u.hp}/${u.maxHp} · ATK ${def.atk} · DEF ${def.def}<br><small>Click a tile to move (click destination again to cancel). Click more of your units to group. Double-click a selected unit to select all of that type. Esc deselects.</small>`;
    } else {
      el.innerHTML = `<h4>${us.length} units selected</h4>` +
        us.map(u => `${UNIT_ICONS[u.type]} ${DEFS.units[u.type].name} (${u.hp}/${u.maxHp})`).join('<br>') +
        `<br><small>Click a tile to move them all (click it again to cancel). Esc deselects.</small>`;
    }
    const allAuto = us.every(u => u.autoAttack);
    const aa = document.createElement('button');
    aa.className = 'act-btn';
    aa.textContent = allAuto ? '⚔️ Auto-attack: ON (≤3 tiles)' : '⚔️ Auto-attack: OFF';
    aa.onclick = () => { for (const u of us) sendAction({ action: 'autoattack', unitId: u.id, on: !allAuto }); };
    el.appendChild(aa);
    addDeselectBtn(el);
    for (const u of us) {
      if (u.type === 'settler') {
        const b = document.createElement('button');
        b.className = 'act-btn'; b.textContent = '🏙️ Found city here';
        b.onclick = () => sendAction({ action: 'found', unitId: u.id });
        el.appendChild(b);
      }
    }
  } else {
    const c = state.cities.find(c => c.id === selected.id);
    if (!c || c.ownerId !== myId) { selected = null; renderSelectPanel(true); return; }
    el.innerHTML = `<h4>🏙️ ${c.name}${c.capital ? ' ★' : ''}</h4>HP ${c.hp}/${c.maxHp}<br>Buildings: ${c.buildings.length ? c.buildings.join(', ') : 'none'}<br><b>Train units</b>`;
    for (const [k, d] of Object.entries(DEFS.units)) {
      const locked = d.tech && !state.techs.includes(d.tech);
      const b = document.createElement('button');
      b.className = 'act-btn';
      b.textContent = `${UNIT_ICONS[k]} ${d.name} — ${costStr(d.cost)}${locked ? ` 🔒${DEFS.techs[d.tech].name}` : ''}`;
      b.disabled = locked || !canAfford(d.cost);
      b.onclick = () => sendAction({ action: 'train', cityId: c.id, unit: k });
      el.appendChild(b);
    }
    const bh = document.createElement('div'); bh.innerHTML = '<b>Build</b>'; el.appendChild(bh);
    for (const [k, d] of Object.entries(DEFS.buildings)) {
      const built = c.buildings.includes(k);
      const locked = d.tech && !state.techs.includes(d.tech);
      const b = document.createElement('button');
      b.className = 'act-btn';
      b.textContent = built ? `✅ ${d.name}` : `🏗️ ${d.name} — ${costStr(d.cost)}${locked ? ` 🔒${DEFS.techs[d.tech].name}` : ''}`;
      b.disabled = built || locked || !canAfford(d.cost);
      b.onclick = () => sendAction({ action: 'build', cityId: c.id, building: k });
      el.appendChild(b);
    }
    const at = document.createElement('div');
    at.innerHTML = '<b>Auto-train</b> ';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">Off</option>' + Object.entries(DEFS.units)
      .map(([k, d]) => `<option value="${k}"${c.autoTrain === k ? ' selected' : ''}>${d.name}</option>`).join('');
    sel.onchange = () => sendAction({ action: 'autotrain', cityId: c.id, unit: sel.value || null });
    at.appendChild(sel);
    el.appendChild(at);
    addDeselectBtn(el);
  }
}

function deselect() {
  selected = null;
  groupDest = null;
  needsDraw = true;
  renderSelectPanel(true);
}

function addDeselectBtn(el) {
  const b = document.createElement('button');
  b.className = 'act-btn';
  b.textContent = '❌ Deselect (Esc)';
  b.onclick = deselect;
  el.appendChild(b);
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected) deselect();
});

function costStr(cost) { return Object.entries(cost).map(([k, v]) => `${{ food: '🍎', wood: '🪵', stone: '🪨', gold: '🪙' }[k]}${v}`).join(' '); }
function canAfford(cost) { return Object.entries(cost).every(([k, v]) => state.res[k] >= v); }

// tech modal
$('tech-btn').onclick = () => { $('tech-modal').classList.remove('hidden'); renderTechModal(); };
$('tech-close').onclick = () => $('tech-modal').classList.add('hidden');
let techKey = '';
function renderTechModal() {
  if ($('tech-modal').classList.contains('hidden') || !state) return;
  const k = JSON.stringify([state.res.science, state.techs]);
  if (k === techKey) return;
  techKey = k;
  $('sci-have').textContent = `— 🔬 ${state.res.science}`;
  const el = $('tech-list');
  el.innerHTML = '';
  for (const [k, t] of Object.entries(DEFS.techs)) {
    const have = state.techs.includes(k);
    const reqOk = !t.req || state.techs.includes(t.req);
    const d = document.createElement('div');
    d.className = 'tech-row' + (have ? ' done' : '');
    d.innerHTML = `<div><b>${t.name}</b> (🔬${t.cost})<small>${t.unlocks}${t.req ? ` · requires ${DEFS.techs[t.req].name}` : ''}</small></div>`;
    const b = document.createElement('button');
    b.textContent = have ? 'Done' : 'Research';
    b.disabled = have || !reqOk || state.res.science < t.cost;
    b.onclick = () => sendAction({ action: 'research', tech: k });
    d.appendChild(b);
    el.appendChild(d);
  }
}

// chat
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    ws.send(JSON.stringify({ type: 'chat', text: e.target.value.trim(), alliesOnly: $('chat-allies').checked }));
    e.target.value = '';
  }
});
function addChat(msg) {
  const d = document.createElement('div');
  if (msg.alliesOnly) d.className = 'ally';
  d.innerHTML = `<b>${msg.from}${msg.alliesOnly ? ' [allies]' : ''}:</b> ${escapeHtml(msg.text)}`;
  $('chat-log').appendChild(d);
  $('chat-log').scrollTop = 1e9;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showGameOver() {
  const go = $('gameover');
  if (!go.classList.contains('hidden')) return;
  go.classList.remove('hidden');
  $('winner-text').textContent = state.winner.id === myId ? '🏆 You win!' : `${state.winner.name} wins!`;
  $('final-scores').innerHTML = state.players
    .slice().sort((a, b) => b.points - a.points)
    .map(p => `<div>${p.name} — ⭐${p.points}${p.alive ? '' : ' (eliminated)'}</div>`).join('');
}

// ---------------- Canvas ----------------
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
function resize() { canvas.width = innerWidth; canvas.height = innerHeight; needsDraw = true; }
addEventListener('resize', resize); resize();

function hexToPx(q, r) {
  return { x: cam.scale * Math.sqrt(3) * (q + r / 2), y: cam.scale * 1.5 * r };
}
function pxToHex(x, y) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / cam.scale;
  const r = (2 / 3 * y) / cam.scale;
  // cube round
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - (-q - r));
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

let dragging = false, dragMoved = false, last = null;
canvas.addEventListener('mousedown', (e) => { dragging = true; dragMoved = false; last = { x: e.clientX, y: e.clientY }; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
  cam.x -= dx; cam.y -= dy;
  needsDraw = true;
  last = { x: e.clientX, y: e.clientY };
});
addEventListener('mouseup', () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  cam.scale = Math.max(14, Math.min(70, cam.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
  needsDraw = true;
});
canvas.addEventListener('click', (e) => {
  if (dragMoved || !state) return;
  const wx = e.clientX - canvas.width / 2 + cam.x;
  const wy = e.clientY - canvas.height / 2 + cam.y;
  const { q, r } = pxToHex(wx, wy);
  handleTileClick(q, r);
});
canvas.addEventListener('dblclick', (e) => {
  if (!state) return;
  const wx = e.clientX - canvas.width / 2 + cam.x;
  const wy = e.clientY - canvas.height / 2 + cam.y;
  const { q, r } = pxToHex(wx, wy);
  const unit = state.units.find(u => u.q === q && u.r === r);
  if (unit && unit.ownerId === myId) {
    // select all own units of the same type
    selected = { kind: 'units', ids: state.units.filter(u => u.ownerId === myId && u.type === unit.type).map(u => u.id) };
    needsDraw = true;
    renderSelectPanel(true);
  }
});

function handleTileClick(q, r) {
  const unit = state.units.find(u => u.q === q && u.r === r);
  const city = state.cities.find(c => c.q === q && c.r === r);

  if (selected && selected.kind === 'units') {
    if (unit && unit.ownerId === myId) {
      if (selected.ids.includes(unit.id)) {
        // clicking an already-selected unit: switch to city under it (if any)
        if (city && city.ownerId === myId) selected = { kind: 'city', id: city.id };
      } else {
        selected.ids.push(unit.id); // add to group
      }
      needsDraw = true;
      renderSelectPanel(true);
      return;
    }
    // clicking the current group destination again cancels the move
    if (groupDest && groupDest.q === q && groupDest.r === r) {
      for (const id of selected.ids) sendAction({ action: 'stop', unitId: id });
      groupDest = null;
      return;
    }
    // move the whole group toward the clicked tile (they keep moving until they arrive)
    groupDest = { q, r };
    for (const id of selected.ids) {
      const su = state.units.find(u => u.id === id);
      if (su && su.ownerId === myId && !(q === su.q && r === su.r)) sendAction({ action: 'move', unitId: id, q, r });
    }
    return;
  }
  if (unit && unit.ownerId === myId) selected = { kind: 'units', ids: [unit.id] };
  else if (city && city.ownerId === myId) selected = { kind: 'city', id: city.id };
  else selected = null;
  needsDraw = true;
  renderSelectPanel(true);
}

function drawHex(x, y, s, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6;
    const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function render() {
  requestAnimationFrame(render);
  if (!state || !needsDraw) return;
  needsDraw = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2 - cam.x, canvas.height / 2 - cam.y);

  for (const t of tileMap.values()) {
    const { x, y } = hexToPx(t.q, t.r);
    drawHex(x, y, cam.scale * 0.96, TERRAIN_COLORS[t.terrain], '#0d1420');
    if (t.bonus && cam.scale > 20) {
      ctx.font = `${cam.scale * 0.55}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(BONUS_ICONS[t.bonus], x, y + cam.scale * 0.2);
    }
    if (t.village) {
      ctx.font = `${cam.scale * 0.7}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('🏕️', x, y + cam.scale * 0.25);
    }
  }

  for (const c of state.cities) {
    const { x, y } = hexToPx(c.q, c.r);
    drawHex(x, y, cam.scale * 0.96, null, myColor(c.ownerId));
    ctx.font = `${cam.scale * 0.8}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(c.capital ? '🏰' : '🏙️', x, y + cam.scale * 0.28);
    ctx.font = `bold ${Math.max(10, cam.scale * 0.32)}px sans-serif`;
    ctx.fillStyle = myColor(c.ownerId);
    ctx.fillText(c.name, x, y - cam.scale * 0.75);
    drawBar(x, y + cam.scale * 0.55, c.hp / c.maxHp);
    if (selected && selected.kind === 'city' && selected.id === c.id) drawHex(x, y, cam.scale * 1.02, null, '#ffffff');
  }

  for (const u of state.units) {
    const { x, y } = hexToPx(u.q, u.r);
    ctx.beginPath();
    ctx.arc(x, y, cam.scale * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = myColor(u.ownerId); ctx.fill();
    ctx.strokeStyle = '#0d1420'; ctx.stroke();
    ctx.font = `${cam.scale * 0.5}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(UNIT_ICONS[u.type], x, y + cam.scale * 0.17);
    drawBar(x, y + cam.scale * 0.55, u.hp / u.maxHp);
    if (selected && selected.kind === 'units' && selected.ids.includes(u.id)) {
      ctx.beginPath(); ctx.arc(x, y, cam.scale * 0.52, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBar(x, y, frac) {
  const w = cam.scale * 0.9;
  ctx.fillStyle = '#222'; ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = frac > 0.5 ? '#6ecb5a' : frac > 0.25 ? '#e0c352' : '#e05252';
  ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), 4);
}
render();
