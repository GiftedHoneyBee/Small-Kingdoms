/* Mini Empires client */
const $ = id => document.getElementById(id);
const ws = window.LocalSocket
  ? new window.LocalSocket() // static single-player build (GitHub Pages): in-browser server
  : new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

let DEFS = null, myId = null, state = null;
const tileMap = new Map();
let needsDraw = true;
let selectedCiv = 'valdorn';
let selected = null; // {kind:'units', ids:[]} | {kind:'city', id}
let groupDest = null; // current group move destination
let cam = { x: 0, y: 0, scale: 34 };
const seenEvents = new Set();
const knownUnitIds = new Set();

// session-persistent settings
const SETTINGS = Object.assign({ arrows: false, autoSelect: false, graphics: 'new' },
  JSON.parse(sessionStorage.getItem('me-settings') || '{}'));
function saveSettings() { sessionStorage.setItem('me-settings', JSON.stringify(SETTINGS)); }

const TERRAIN_COLORS = {
  water: '#1d4e79', grass: '#4e8f3c', forest: '#2d6b2a', hill: '#8a7b52', mountain: '#6b6f78',
};
const BONUS_ICONS = { fruit: '🍇', game: '🦌', ore: '⛏️', crop: '🌾', fish: '🐟' };
const PLAYER_COLORS = ['#e05252', '#5290e0', '#e0c352', '#52c47a', '#b06cd9', '#e08a3c', '#52c4c4', '#e06cb0', '#9aa4b5', '#8fe052'];
let colorById = {};
function assignColors(list) {
  colorById = {};
  list.forEach((p, i) => { colorById[p.id] = PLAYER_COLORS[i % PLAYER_COLORS.length]; });
}
const UNIT_ICONS = { warrior: '⚔️', scout: '👁️', defender: '🛡️', archer: '🏹', knight: '🐎', catapult: '💣', settler: '🚩', giant: '🧌' };

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
$('start-btn').onclick = () => ws.send(JSON.stringify({ type: 'start', winMode: $('win-mode').value, speed: $('game-speed').value, mapSize: $('map-size').value, mapType: $('map-type').value }));
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
  // auto-select newly trained units (setting)
  const newMine = [];
  for (const u of s.units) {
    if (!knownUnitIds.has(u.id)) {
      knownUnitIds.add(u.id);
      if (!first && u.ownerId === myId) newMine.push(u.id);
    }
  }
  if (SETTINGS.autoSelect && newMine.length) {
    if (selected && selected.kind === 'units') selected.ids.push(...newMine);
    else if (!selected) selected = { kind: 'units', ids: newMine };
    renderSelectPanel(true);
  }
  if (first) {
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
    resize();
    centerOnHome();
    if (TUT.active) renderTutStep();
  }
  updateHud();
  tutCheck();
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
  if (state.winMode === 'elimination') {
    $('timer').textContent = '♾️';
  } else {
    const s = Math.ceil(state.timeLeft / 1000);
    $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const me = state.players.find(p => p.id === myId);
  $('mypoints').textContent = state.pointsToWin ? `⭐ ${me.points} / ${state.pointsToWin}` : `⭐ ${me.points}`;

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
  // don't rebuild the panel while a dropdown in it is open/focused (it would collapse)
  if (!force && el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  selectKey = k;
  if (!selected) { el.innerHTML = '<em>Select one of your units or cities. Click more of your units to group them; click a tile to move. Esc deselects.</em>'; return; }
  if (selected.kind === 'units') {
    const us = selected.ids.map(id => state.units.find(u => u.id === id)).filter(Boolean);
    selected.ids = us.map(u => u.id);
    if (!us.length) { selected = null; renderSelectPanel(true); return; }
    if (us.length === 1) {
      const u = us[0];
      const def = DEFS.units[u.type];
      const boatTag = u.boat ? ` 🛶 in boat (ATK ${DEFS.boat.atk} · range ${DEFS.boat.range})` : '';
      el.innerHTML = `<h4>${UNIT_ICONS[u.type]} ${def.name}${boatTag}</h4>HP ${u.hp}/${u.maxHp} · ATK ${def.atk} · DEF ${def.def}<br><small>Click a tile to move (click destination again to cancel). Click more of your units to group. Double-click a selected unit to select all of that type. Esc deselects.</small>`;
    } else {
      el.innerHTML = `<h4>${us.length} units selected</h4>` +
        us.map(u => `${UNIT_ICONS[u.type]} ${DEFS.units[u.type].name}${u.boat ? ' 🛶' : ''} (${u.hp}/${u.maxHp})`).join('<br>') +
        `<br><small>Click a tile to move them all (click it again to cancel). Esc deselects.</small>`;
    }
    // auto-attack radius cycles off -> 3 -> 6 -> 9 -> off
    const curAa = us[0].autoAttack || 0;
    const nextAa = { 0: 3, 3: 6, 6: 9, 9: 0 }[curAa] ?? 0;
    const aa = document.createElement('button');
    aa.className = 'act-btn';
    aa.textContent = curAa ? `⚔️ Auto-attack: ≤${curAa} tiles (click: ${nextAa ? '≤' + nextAa + ' tiles' : 'off'})` : '⚔️ Auto-attack: OFF (click: ≤3 tiles)';
    aa.onclick = () => { for (const u of us) sendAction({ action: 'autoattack', unitId: u.id, range: nextAa }); };
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

// settings modal
$('settings-btn').onclick = () => $('settings-modal').classList.remove('hidden');
$('settings-close').onclick = () => $('settings-modal').classList.add('hidden');
$('set-arrows').checked = SETTINGS.arrows;
$('set-autoselect').checked = SETTINGS.autoSelect;
$('set-graphics').value = SETTINGS.graphics;
$('set-arrows').onchange = (e) => { SETTINGS.arrows = e.target.checked; saveSettings(); needsDraw = true; };
$('set-autoselect').onchange = (e) => { SETTINGS.autoSelect = e.target.checked; saveSettings(); };
$('set-graphics').onchange = (e) => { SETTINGS.graphics = e.target.value; saveSettings(); needsDraw = true; };

// wiki modal
$('wiki-btn').onclick = () => { renderWiki(); $('wiki-modal').classList.remove('hidden'); };
$('wiki-close').onclick = () => $('wiki-modal').classList.add('hidden');
function renderWiki() {
  if (!DEFS) return;
  const el = $('wiki-content');
  let h = '<h4>Civilizations</h4><table><tr><th>Civ</th><th>Bonus</th></tr>';
  for (const c of Object.values(DEFS.civs)) h += `<tr><td><b>${c.name}</b></td><td>${c.desc}</td></tr>`;
  h += '</table><h4>Units</h4><table><tr><th>Unit</th><th>Cost</th><th>HP</th><th>ATK</th><th>DEF</th><th>Range</th><th>Speed</th><th>Vision</th><th>Requires</th></tr>';
  for (const [k, d] of Object.entries(DEFS.units)) {
    h += `<tr><td>${UNIT_ICONS[k]} <b>${d.name}</b></td><td>${costStr(d.cost)}</td><td>${d.hp}</td><td>${d.atk}</td><td>${d.def}</td><td>${d.range || 1}</td><td>1 tile / ${(d.moveMs / 1000).toFixed(1)}s</td><td>${d.vision || 1}</td><td>${d.tech ? DEFS.techs[d.tech].name : '—'}</td></tr>`;
  }
  h += '</table><h4>Buildings</h4><table><tr><th>Building</th><th>Cost</th><th>Effect</th><th>Points</th><th>Requires</th></tr>';
  for (const d of Object.values(DEFS.buildings)) {
    const eff = d.income ? Object.entries(d.income).map(([k, v]) => `+${v} ${k}/s`).join(', ')
      : d.defBonus ? `+${d.defBonus * 2} city HP` : d.pointsPerSec ? `+${d.pointsPerSec} points/s` : '—';
    h += `<tr><td><b>${d.name}</b></td><td>${costStr(d.cost)}</td><td>${eff}</td><td>${d.points || 0}</td><td>${d.tech ? DEFS.techs[d.tech].name : '—'}</td></tr>`;
  }
  h += '</table><h4>Technologies</h4><table><tr><th>Tech</th><th>Cost</th><th>Unlocks</th><th>Requires</th></tr>';
  for (const t of Object.values(DEFS.techs)) {
    h += `<tr><td><b>${t.name}</b></td><td>🔬${t.cost}</td><td>${t.unlocks}</td><td>${t.req ? DEFS.techs[t.req].name : '—'}</td></tr>`;
  }
  h += `</table><h4>Boats & ports</h4><ul>
    <li>Research <b>Seafaring</b>, then build a <b>Port</b> in a city near water. All water tiles within ${DEFS.buildings.port.portRange} tiles of that city become port waters (shown with ⚓ shading on the map).</li>
    <li>Move a unit onto port waters and it boards a boat 🛶: speed 1 tile/${(DEFS.boat.moveMs / 1000).toFixed(0)}s, ATK ${DEFS.boat.atk}, DEF ${DEFS.boat.def}, range ${DEFS.boat.range}, HP is kept from the unit.</li>
    <li>Boats sail any water once launched. Moving a boat onto land makes the unit disembark.</li>
    <li>The <b>Mountain Giant</b> 🧌 (Mountain Lore tech) is the only unit that can walk over mountains.</li>
  </ul><h4>Map generation</h4><ul>
    <li><b>Sizes:</b> Tiny (25%), Small (50%), Normal, Big (200%), Huge (400%), Gigantic (1000%).</li>
    <li><b>Types:</b> Pangea (one connected landmass, ~50% water) · Continents (large landmasses split by ocean) · Islands (lots of water, small isles) · Lakes (mostly land with big lakes) · Dryland (almost no water) · Mountain pass (~1/3 mountains dividing the land).</li>
  </ul><h4>Controls & shortcuts</h4><ul>
    <li><b>Click</b> a unit to select it; click more of your units to group them.</li>
    <li><b>Click a tile</b> to move the whole selected group there — units pathfind around mountains and water. Click the destination again to cancel.</li>
    <li><b>Double-click a unit</b> to select all your units of that type.</li>
    <li><b>Double-click a city</b> to deselect all units and select the city.</li>
    <li><b>Esc</b> or the Deselect button clears the selection.</li>
    <li><b>Drag</b> to pan the map, <b>mouse wheel</b> to zoom.</li>
    <li><b>Auto-attack</b> button cycles OFF → ≤3 → ≤6 → ≤9 tiles → OFF (units chase enemies they detect in that radius).</li>
    <li><b>Auto-train</b> dropdown in a city keeps training a unit whenever affordable.</li>
    <li><b>Settings</b> (⚙️ in menu): switch between New (blocky) and Classic graphics; movement arrows show each unit's planned destination; auto-select puts newly trained units into your selection. Saved for the whole session.</li>
  </ul><h4>Rules</h4><ul>
    <li>Income is generated every second from your cities, surrounding terrain and buildings. Extra cities give diminishing returns (each additional city produces 80% of the previous one).</li>
    <li>Points: +${DEFS.game.points.city} per city, +${DEFS.game.points.tech} per tech, +${DEFS.game.points.kill} per kill, small amounts for exploring; temples generate points over time.</li>
    <li>Cities can't be attacked in the first ${DEFS.game.peaceMs / 1000}s (peace period).</li>
    <li>Victory: reach ${DEFS.game.pointsToWin} points, have the most points at 10 minutes, or eliminate everyone. "Last player standing" mode has no timer or point goal.</li>
    <li>Slow mode: 75% reduced income and 5× slower unit movement.</li>
    <li>Ranged units (archer, catapult, boats) fire from distance without taking retaliation.</li>
  </ul>`;
  el.innerHTML = h;
}

// ---------------- Interactive tutorial ----------------
// Starts a real practice match vs a passive bot and guides the player with
// step boxes, highlighted UI elements and a pulsing marker on the map.
const TUT = { active: false, step: 0, baseUnits: 0, baseTechs: 0, baseTiles: 0, chatted: false };
const TUT_STEPS = [
  { title: 'Welcome, chief!', text: 'This is a <b>real practice match</b> against a peaceful bot. The game runs in real time — your empire earns resources every second while you learn. Your capital is marked below.', next: true, canvas: () => tutCapital() },
  { title: 'Select your warrior', text: 'Click your ⚔️ <b>warrior</b> — the little figure standing next to your capital.', check: () => selected && selected.kind === 'units' },
  { title: 'Move & explore', text: 'Now <b>click a tile far away</b>. The warrior pathfinds there on its own and lifts the fog as it walks. Reveal some new land to continue.', check: () => tileMap.size >= TUT.baseTiles + 12 },
  { title: 'Select your city', text: 'Press <b>Esc</b> to deselect, then <b>double-click your capital</b> (the tile with the tower) to select the city itself.', check: () => selected && selected.kind === 'city', canvas: () => tutCapital() },
  { title: 'Build a building', text: 'In the right panel, press 🏗️ <b>Sawmill</b> (20🪙). Buildings raise your income every second — economy wins games.', el: 'select-panel', check: () => state.cities.some(c => c.ownerId === myId && c.buildings.length) },
  { title: 'Train an army', text: 'With the city still selected, <b>train a unit</b> — a ⚔️ Warrior is cheapest. Tip: the <b>Auto-train</b> dropdown keeps producing units for you.', el: 'select-panel', check: () => state.units.filter(u => u.ownerId === myId).length > TUT.baseUnits, canvas: () => tutCapital() },
  { title: 'Research', text: 'Open 🔬 <b>Research</b> (top of the right panel) and research any tech. Science trickles in every second, so you may need to wait a moment.', el: 'tech-btn', check: () => state.techs.length > TUT.baseTechs },
  { title: 'Chat & diplomacy', text: 'Type something in the <b>chat</b> (bottom right) and press Enter. In the Players panel you can propose <b>alliances</b> the same way.', el: 'chat-input', check: () => TUT.chatted },
  { title: 'Combat', text: 'To fight, simply <b>move units onto enemies</b> or their cities (after the 90s peace period). Archers & catapults fire from range, and the ⚔️ Auto-attack button makes units engage on their own. Capture 🏕️ villages for free cities!', next: true },
  { title: 'You are ready! 🏆', text: 'Win by reaching the ⭐ point goal, having the most points at 10:00, or eliminating everyone — the 📖 Wiki has every stat. Keep playing this practice match, or press Finish to return to the menu.', finish: true },
];
function tutCapital() {
  const c = state && state.cities.find(c => c.ownerId === myId && c.capital);
  return c ? { q: c.q, r: c.r } : null;
}
let tutGlowEl = null;
function renderTutStep() {
  const s = TUT_STEPS[TUT.step];
  $('tut-title').textContent = `🎓 ${TUT.step + 1}/${TUT_STEPS.length} — ${s.title}`;
  $('tut-text').innerHTML = s.text;
  $('tut-next').classList.toggle('hidden', !s.next && !s.finish);
  $('tut-next').textContent = s.finish ? 'Finish 🏁' : 'Next ▶';
  $('tut-box').classList.remove('hidden');
  if (tutGlowEl) { tutGlowEl.classList.remove('tut-glow'); tutGlowEl = null; }
  if (s.el) { tutGlowEl = $(s.el); tutGlowEl.classList.add('tut-glow'); }
  if (state) {
    TUT.baseTiles = tileMap.size;
    TUT.baseUnits = state.units.filter(u => u.ownerId === myId).length;
    TUT.baseTechs = state.techs.length;
  }
  needsDraw = true;
}
function tutCheck() {
  if (!TUT.active || !state) return;
  const s = TUT_STEPS[TUT.step];
  if (s.check && s.check()) tutAdvance();
}
function tutAdvance() {
  if (TUT_STEPS[TUT.step].finish) { location.reload(); return; }
  TUT.step++;
  if (TUT.step >= TUT_STEPS.length) endTutorial();
  else renderTutStep();
}
function endTutorial() {
  TUT.active = false;
  $('tut-box').classList.add('hidden');
  if (tutGlowEl) { tutGlowEl.classList.remove('tut-glow'); tutGlowEl = null; }
  needsDraw = true;
}
$('tutorial-btn').onclick = () => {
  if (TUT.active || state) return;
  TUT.active = true; TUT.step = 0; TUT.chatted = false;
  ws.send(JSON.stringify({ type: 'createRoom', name: $('name-input').value || 'Chief', civ: selectedCiv }));
  setTimeout(() => ws.send(JSON.stringify({ type: 'addBot', level: 'passive' })), 250);
  setTimeout(() => ws.send(JSON.stringify({ type: 'start', winMode: 'points', speed: 'bullet', mapSize: 'small', mapType: 'pangea' })), 500);
};
$('tut-next').onclick = tutAdvance;
$('tut-skip').onclick = endTutorial;

// chat
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    ws.send(JSON.stringify({ type: 'chat', text: e.target.value.trim(), alliesOnly: $('chat-allies').checked }));
    e.target.value = '';
    TUT.chatted = true;
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
function setZoom(factor) {
  const next = Math.max(14, Math.min(70, cam.scale * factor));
  const f = next / cam.scale;
  cam.scale = next;
  cam.x *= f; cam.y *= f; // keep the same tile centered
  needsDraw = true;
}
canvas.addEventListener('wheel', (e) => setZoom(e.deltaY < 0 ? 1.12 : 0.89));
$('zoom-in').onclick = () => setZoom(1.25);
$('zoom-out').onclick = () => setZoom(0.8);
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
  // double-clicking an own city always selects it (deselecting any units)
  const city = state.cities.find(c => c.q === q && c.r === r && c.ownerId === myId);
  if (city) {
    selected = { kind: 'city', id: city.id };
    groupDest = null;
    needsDraw = true;
    renderSelectPanel(true);
    return;
  }
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

// tiles sorted back-to-front for the blocky (3D-ish) renderer; cached until new tiles arrive
let sortedTiles = [];
let sortedTilesCount = -1;
function getSortedTiles() {
  if (tileMap.size !== sortedTilesCount) {
    sortedTiles = [...tileMap.values()].sort((a, b) => a.r - b.r || a.q - b.q);
    sortedTilesCount = tileMap.size;
  }
  return sortedTiles;
}

function render() {
  requestAnimationFrame(render);
  const animated = SETTINGS.graphics === 'animated';
  if (animated) needsDraw = true;
  if (!state || !needsDraw) return;
  needsDraw = false;
  const blocky = SETTINGS.graphics !== 'classic';
  GFX.setTime(animated ? performance.now() / 1000 : 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (blocky) { ctx.fillStyle = '#14324e'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.save();
  ctx.translate(canvas.width / 2 - cam.x, canvas.height / 2 - cam.y);

  // water tiles within port range of an explored city that has a port
  const portTiles = new Set();
  for (const c of state.cities) {
    if (!c.buildings.includes('port')) continue;
    const R = DEFS.buildings.port.portRange || 3;
    for (let dq = -R; dq <= R; dq++) {
      for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
        const k = `${c.q + dq},${c.r + dr}`;
        const t = tileMap.get(k);
        if (t && t.terrain === 'water') portTiles.add(k);
      }
    }
  }

  const tiles = blocky ? getSortedTiles() : tileMap.values();
  for (const t of tiles) {
    const { x, y } = hexToPx(t.q, t.r);
    if (blocky) {
      GFX.drawTile(ctx, x, y, cam.scale * 0.98, t);
      if (portTiles.has(`${t.q},${t.r}`)) {
        drawHex(x, y, cam.scale * 0.8, 'rgba(160,220,255,0.2)', 'rgba(190,230,255,0.55)');
        if (cam.scale > 20) GFX.drawAnchor(ctx, x, y, cam.scale * 0.8);
      }
      if (t.bonus && cam.scale > 18) GFX.drawBonus(ctx, x, y + cam.scale * 0.1, cam.scale, t.bonus, t.q, t.r);
      if (t.village) GFX.drawVillage(ctx, x, y, cam.scale);
    } else {
      drawHex(x, y, cam.scale * 0.96, TERRAIN_COLORS[t.terrain], '#0d1420');
      if (portTiles.has(`${t.q},${t.r}`)) {
        drawHex(x, y, cam.scale * 0.8, 'rgba(120,200,255,0.18)', 'rgba(140,210,255,0.5)');
        if (cam.scale > 22) {
          ctx.font = `${cam.scale * 0.4}px sans-serif`; ctx.textAlign = 'center';
          ctx.fillText('⚓', x, y + cam.scale * 0.15);
        }
      }
      if (t.bonus && cam.scale > 20) {
        ctx.font = `${cam.scale * 0.55}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(BONUS_ICONS[t.bonus], x, y + cam.scale * 0.2);
      }
      if (t.village) {
        ctx.font = `${cam.scale * 0.7}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('🏕️', x, y + cam.scale * 0.25);
      }
    }
  }

  for (const c of state.cities) {
    const { x, y } = hexToPx(c.q, c.r);
    if (blocky) {
      drawHex(x, y, cam.scale * 0.98, null, myColor(c.ownerId));
      GFX.drawCity(ctx, x, y, cam.scale, myColor(c.ownerId), c.capital, c.buildings.length);
    } else {
      drawHex(x, y, cam.scale * 0.96, null, myColor(c.ownerId));
      ctx.font = `${cam.scale * 0.8}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(c.capital ? '🏰' : '🏙️', x, y + cam.scale * 0.28);
    }
    ctx.font = `bold ${Math.max(10, cam.scale * 0.32)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = myColor(c.ownerId);
    ctx.fillText(c.name, x, y - cam.scale * 0.75);
    drawBar(x, y + cam.scale * 0.55, c.hp / c.maxHp);
    if (selected && selected.kind === 'city' && selected.id === c.id) drawHex(x, y, cam.scale * 1.02, null, '#ffffff');
  }

  // planned movement arrows (setting)
  if (SETTINGS.arrows) {
    for (const u of state.units) {
      if (u.ownerId !== myId || !u.dest) continue;
      const a = hexToPx(u.q, u.r), b = hexToPx(u.dest.q, u.dest.r);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 10 * Math.cos(ang - 0.4), b.y - 10 * Math.sin(ang - 0.4));
      ctx.lineTo(b.x - 10 * Math.cos(ang + 0.4), b.y - 10 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    }
  }

  for (const u of state.units) {
    const { x, y } = hexToPx(u.q, u.r);
    if (blocky) {
      if (u.boat) GFX.drawBoat(ctx, x, y, cam.scale, myColor(u.ownerId));
      else GFX.drawUnit(ctx, x, y, cam.scale, u.type, myColor(u.ownerId));
    } else {
      ctx.beginPath();
      ctx.arc(x, y, cam.scale * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = myColor(u.ownerId); ctx.fill();
      ctx.strokeStyle = '#0d1420'; ctx.stroke();
      ctx.font = `${cam.scale * 0.5}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(u.boat ? '🛶' : UNIT_ICONS[u.type], x, y + cam.scale * 0.17);
    }
    drawBar(x, y + cam.scale * 0.55, u.hp / u.maxHp);
    if (selected && selected.kind === 'units' && selected.ids.includes(u.id)) {
      ctx.beginPath(); ctx.arc(x, y, cam.scale * 0.52, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // tutorial: pulsing marker + bouncing arrow over the current step's tile
  if (TUT.active) {
    const tgt = TUT_STEPS[TUT.step].canvas && TUT_STEPS[TUT.step].canvas();
    if (tgt) {
      const { x, y } = hexToPx(tgt.q, tgt.r);
      const pulse = Math.sin(performance.now() / 250);
      ctx.beginPath(); ctx.arc(x, y, cam.scale * (1.15 + pulse * 0.08), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 3; ctx.stroke();
      const ay = y - cam.scale * 1.7 + pulse * cam.scale * 0.15;
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.moveTo(x, ay + cam.scale * 0.45);
      ctx.lineTo(x - cam.scale * 0.3, ay);
      ctx.lineTo(x + cam.scale * 0.3, ay);
      ctx.closePath(); ctx.fill();
      needsDraw = true; // keep the marker pulsing
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
