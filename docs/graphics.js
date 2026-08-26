/* Polytopia-style "blocky" renderer for Mini Empires.
   Exposes window.GFX with pure canvas drawing helpers; client.js decides
   which style to use based on the graphics setting. */
(function () {
  'use strict';

  // deterministic per-tile pseudo-random in [0,1)
  function tileRand(q, r, salt) {
    let h = (q * 374761393 + r * 668265263 + (salt || 0) * 2147483647) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return ((h >>> 0) % 10000) / 10000;
  }

  function shade(hex, f) {
    // lighten (f>0) or darken (f<0) a #rrggbb color
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  const TOP = {
    water: '#3f8dd6', grass: '#8fd05a', forest: '#6dbb4a', hill: '#c2b280', mountain: '#b9bec9',
  };
  const SIDE = {
    water: '#2a5f96', grass: '#5f9c3a', forest: '#4a8c33', hill: '#96844f', mountain: '#7f8590',
  };

  function hexPath(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i + Math.PI / 6;
      i ? ctx.lineTo(x + s * Math.cos(a), y + s * Math.sin(a)) : ctx.moveTo(x + s * Math.cos(a), y + s * Math.sin(a));
    }
    ctx.closePath();
  }

  // hex "prism": darker extruded sides below, bright top face
  function drawTile(ctx, x, y, s, t) {
    const isWater = t.terrain === 'water';
    const depth = isWater ? s * 0.12 : s * 0.28;
    const top = TOP[t.terrain], side = SIDE[t.terrain];
    // side faces: bottom three edges extruded down
    ctx.fillStyle = side;
    for (let i = 0; i < 3; i++) { // edges facing the viewer (bottom half)
      const a1 = Math.PI / 3 * i + Math.PI / 6, a2 = Math.PI / 3 * (i + 1) + Math.PI / 6;
      const x1 = x + s * Math.cos(a1), y1 = y + s * Math.sin(a1);
      const x2 = x + s * Math.cos(a2), y2 = y + s * Math.sin(a2);
      if (y1 < y && y2 < y) continue;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.lineTo(x2, y2 + depth); ctx.lineTo(x1, y1 + depth);
      ctx.closePath();
      ctx.fillStyle = i === 1 ? shade(side, -0.15) : side; // front face slightly darker
      ctx.fill();
    }
    // top face
    hexPath(ctx, x, y, s);
    ctx.fillStyle = top;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // terrain decoration
    if (t.terrain === 'water') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, s * 0.05);
      for (let i = 0; i < 2; i++) {
        const wy = y - s * 0.25 + i * s * 0.4 + tileRand(t.q, t.r, i) * s * 0.15;
        const wx = x - s * 0.4 + tileRand(t.q, t.r, i + 7) * s * 0.3;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.quadraticCurveTo(wx + s * 0.2, wy - s * 0.09, wx + s * 0.4, wy);
        ctx.stroke();
      }
    } else if (t.terrain === 'forest') {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const tx = x + (tileRand(t.q, t.r, i) - 0.5) * s * 0.9;
        const ty = y + (tileRand(t.q, t.r, i + 3) - 0.5) * s * 0.7;
        drawTree(ctx, tx, ty, s * (0.34 + tileRand(t.q, t.r, i + 6) * 0.12));
      }
    } else if (t.terrain === 'mountain') {
      drawMountain(ctx, x, y + s * 0.1, s * 0.85);
      if (tileRand(t.q, t.r, 1) > 0.5) drawMountain(ctx, x - s * 0.35, y + s * 0.28, s * 0.5);
    } else if (t.terrain === 'hill') {
      // rounded bumps
      for (let i = 0; i < 2; i++) {
        const hx = x + (i ? s * 0.25 : -s * 0.2), hy = y + (i ? s * 0.15 : -s * 0.05);
        ctx.beginPath();
        ctx.ellipse(hx, hy, s * 0.32, s * 0.2, 0, Math.PI, 0);
        ctx.fillStyle = shade(TOP.hill, 0.18); ctx.fill();
        ctx.strokeStyle = shade(SIDE.hill, -0.1); ctx.lineWidth = 1; ctx.stroke();
      }
    } else if (t.terrain === 'grass') {
      // sparse grass tufts
      ctx.strokeStyle = shade(TOP.grass, -0.25);
      ctx.lineWidth = Math.max(1, s * 0.04);
      for (let i = 0; i < 3; i++) {
        const gx = x + (tileRand(t.q, t.r, i) - 0.5) * s * 1.1;
        const gy = y + (tileRand(t.q, t.r, i + 5) - 0.5) * s * 0.8;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - s * 0.05, gy - s * 0.14);
        ctx.moveTo(gx, gy); ctx.lineTo(gx + s * 0.06, gy - s * 0.12);
        ctx.stroke();
      }
    }
  }

  function drawTree(ctx, x, y, h) {
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(x - h * 0.08, y, h * 0.16, h * 0.35);
    for (let l = 0; l < 2; l++) {
      const w = h * (0.55 - l * 0.15), ty = y - l * h * 0.32;
      ctx.beginPath();
      ctx.moveTo(x, ty - h * 0.75);
      ctx.lineTo(x - w, ty + h * 0.05);
      ctx.lineTo(x + w, ty + h * 0.05);
      ctx.closePath();
      ctx.fillStyle = l ? '#3d8f3d' : '#2f7a33';
      ctx.fill();
    }
  }

  function drawMountain(ctx, x, y, h) {
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.85);
    ctx.lineTo(x - h * 0.6, y + h * 0.25);
    ctx.lineTo(x + h * 0.6, y + h * 0.25);
    ctx.closePath();
    ctx.fillStyle = '#8d93a1'; ctx.fill();
    // lit side
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.85);
    ctx.lineTo(x + h * 0.6, y + h * 0.25);
    ctx.lineTo(x + h * 0.15, y + h * 0.25);
    ctx.closePath();
    ctx.fillStyle = '#a7adba'; ctx.fill();
    // snow cap
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.85);
    ctx.lineTo(x - h * 0.18, y - h * 0.5);
    ctx.lineTo(x - h * 0.05, y - h * 0.55);
    ctx.lineTo(x + h * 0.08, y - h * 0.45);
    ctx.lineTo(x + h * 0.18, y - h * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#f2f5fa'; ctx.fill();
  }

  // bonus resources as small blocky shapes
  function drawBonus(ctx, x, y, s, bonus, q, r) {
    if (bonus === 'fruit') {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x + (i - 1) * s * 0.16, y + (i % 2) * s * 0.1, s * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = '#b04ecb'; ctx.fill();
      }
    } else if (bonus === 'game') { // wild game: little blocky critter
      ctx.fillStyle = '#8a5a33';
      ctx.fillRect(x - s * 0.18, y - s * 0.1, s * 0.36, s * 0.2);
      ctx.fillRect(x + s * 0.1, y - s * 0.24, s * 0.14, s * 0.16);
      ctx.strokeStyle = '#6b4526'; ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.17, y - s * 0.24); ctx.lineTo(x + s * 0.1, y - s * 0.38);
      ctx.moveTo(x + s * 0.17, y - s * 0.24); ctx.lineTo(x + s * 0.26, y - s * 0.38);
      ctx.stroke();
    } else if (bonus === 'ore') {
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.2); ctx.lineTo(x + s * 0.2, y); ctx.lineTo(x, y + s * 0.16); ctx.lineTo(x - s * 0.2, y);
      ctx.closePath();
      ctx.fillStyle = '#d8dbe2'; ctx.fill();
      ctx.strokeStyle = '#5e646f'; ctx.lineWidth = 1; ctx.stroke();
    } else if (bonus === 'crop') {
      ctx.strokeStyle = '#e2c04c'; ctx.lineWidth = Math.max(1, s * 0.06);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * s * 0.14, y + s * 0.16);
        ctx.lineTo(x + i * s * 0.14, y - s * 0.18);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + i * s * 0.14, y - s * 0.2, s * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = '#f0d264'; ctx.fill();
      }
    } else if (bonus === 'fish') {
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.2, s * 0.11, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#dfe8f2'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.18, y); ctx.lineTo(x + s * 0.3, y - s * 0.1); ctx.lineTo(x + s * 0.3, y + s * 0.1);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawVillage(ctx, x, y, s) {
    // neutral village: two tents
    for (const [dx, sc] of [[-0.22, 0.9], [0.2, 0.7]]) {
      const tx = x + dx * s, h = s * 0.45 * sc;
      ctx.beginPath();
      ctx.moveTo(tx, y - h);
      ctx.lineTo(tx - h * 0.75, y + h * 0.35);
      ctx.lineTo(tx + h * 0.75, y + h * 0.35);
      ctx.closePath();
      ctx.fillStyle = '#c9a06a'; ctx.fill();
      ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, y + h * 0.35); ctx.lineTo(tx, y - h * 0.1);
      ctx.strokeStyle = '#6e5230'; ctx.stroke();
    }
  }

  function drawCity(ctx, x, y, s, color, capital, nBuildings) {
    // cluster of blocky houses; capital gets a tower + flag
    const houses = Math.min(4, 2 + Math.floor((nBuildings || 0) / 2));
    const spots = [[-0.3, 0.12], [0.28, 0.08], [-0.02, 0.3], [0.05, -0.18]];
    for (let i = 0; i < houses; i++) {
      const [dx, dy] = spots[i];
      drawHouse(ctx, x + dx * s, y + dy * s, s * 0.34, color);
    }
    if (capital) {
      // tower
      const tw = s * 0.22, th = s * 0.62, tx = x - tw / 2, ty = y - th - s * 0.05;
      ctx.fillStyle = '#e8e2d2'; ctx.fillRect(tx, ty, tw, th);
      ctx.strokeStyle = '#8d8674'; ctx.lineWidth = 1; ctx.strokeRect(tx, ty, tw, th);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tx, ty); ctx.lineTo(tx + tw / 2, ty - s * 0.2); ctx.lineTo(tx + tw, ty);
      ctx.closePath(); ctx.fill();
      // flag
      ctx.strokeStyle = '#555'; ctx.beginPath();
      ctx.moveTo(tx + tw / 2, ty - s * 0.2); ctx.lineTo(tx + tw / 2, ty - s * 0.42); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tx + tw / 2, ty - s * 0.42);
      ctx.lineTo(tx + tw / 2 + s * 0.2, ty - s * 0.35);
      ctx.lineTo(tx + tw / 2, ty - s * 0.28);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawHouse(ctx, x, y, h, color) {
    // walls
    ctx.fillStyle = '#efe6d0';
    ctx.fillRect(x - h / 2, y - h * 0.5, h, h * 0.55);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(x - h / 2, y - h * 0.5, h, h * 0.55);
    // roof in owner color
    ctx.beginPath();
    ctx.moveTo(x - h * 0.6, y - h * 0.5);
    ctx.lineTo(x, y - h * 0.95);
    ctx.lineTo(x + h * 0.6, y - h * 0.5);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.stroke();
    // door
    ctx.fillStyle = '#7a5a38';
    ctx.fillRect(x - h * 0.1, y - h * 0.2, h * 0.2, h * 0.25);
  }

  // blocky little person; per-type accessory drawn with shapes
  function drawUnit(ctx, x, y, s, type, color) {
    const b = s * 0.5; // body scale
    // shadow
    ctx.beginPath();
    ctx.ellipse(x, y + b * 0.62, b * 0.55, b * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();

    if (type === 'giant') {
      const g = b * 1.35;
      ctx.fillStyle = shade(color, -0.25);
      roundRect(ctx, x - g * 0.5, y - g * 0.45, g, g, g * 0.18); ctx.fill();
      ctx.fillStyle = '#d9c9a3';
      ctx.beginPath(); ctx.arc(x, y - g * 0.62, g * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#333';
      ctx.fillRect(x - g * 0.14, y - g * 0.68, g * 0.08, g * 0.08);
      ctx.fillRect(x + g * 0.06, y - g * 0.68, g * 0.08, g * 0.08);
      // club
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = g * 0.14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + g * 0.5, y + g * 0.2); ctx.lineTo(x + g * 0.85, y - g * 0.5); ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
    if (type === 'catapult') {
      // wooden frame + wheels + arm
      ctx.fillStyle = '#8a6a40';
      ctx.fillRect(x - b * 0.7, y - b * 0.1, b * 1.4, b * 0.28);
      ctx.beginPath(); ctx.arc(x - b * 0.45, y + b * 0.28, b * 0.22, 0, Math.PI * 2);
      ctx.arc(x + b * 0.45, y + b * 0.28, b * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = '#5e4526'; ctx.fill();
      ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = b * 0.14;
      ctx.beginPath(); ctx.moveTo(x - b * 0.2, y - b * 0.05); ctx.lineTo(x + b * 0.5, y - b * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + b * 0.55, y - b * 0.85, b * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = '#666c78'; ctx.fill();
      // colored banner so owner is visible
      ctx.fillStyle = color;
      ctx.fillRect(x - b * 0.7, y - b * 0.45, b * 0.3, b * 0.3);
      return;
    }

    // body
    ctx.fillStyle = color;
    roundRect(ctx, x - b * 0.42, y - b * 0.35, b * 0.84, b * 0.85, b * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    // head
    ctx.fillStyle = '#e8c9a0';
    ctx.beginPath(); ctx.arc(x, y - b * 0.58, b * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();

    // helmet/hat per type in a darker owner shade
    ctx.fillStyle = shade(color, -0.3);
    if (type === 'warrior' || type === 'knight') {
      ctx.beginPath(); ctx.arc(x, y - b * 0.62, b * 0.31, Math.PI, 0); ctx.fill();
      if (type === 'knight') { // plume
        ctx.fillRect(x - b * 0.05, y - b * 1.05, b * 0.1, b * 0.25);
      }
    } else if (type === 'defender') {
      ctx.beginPath(); ctx.arc(x, y - b * 0.62, b * 0.33, Math.PI * 0.9, Math.PI * 0.1); ctx.fill();
    } else if (type === 'scout') { // hood
      ctx.beginPath(); ctx.arc(x, y - b * 0.6, b * 0.34, Math.PI * 0.8, Math.PI * 0.2); ctx.fill();
    } else if (type === 'archer') { // cap
      ctx.beginPath();
      ctx.moveTo(x - b * 0.3, y - b * 0.72); ctx.lineTo(x + b * 0.34, y - b * 0.78); ctx.lineTo(x - b * 0.05, y - b * 1.0);
      ctx.closePath(); ctx.fill();
    } else if (type === 'settler') { // wide hat
      ctx.beginPath();
      ctx.ellipse(x, y - b * 0.72, b * 0.42, b * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - b * 0.78, b * 0.18, Math.PI, 0); ctx.fill();
    }

    // accessory
    ctx.strokeStyle = '#4a4f58'; ctx.lineWidth = Math.max(1, b * 0.1); ctx.lineCap = 'round';
    if (type === 'warrior') { // sword
      ctx.beginPath(); ctx.moveTo(x + b * 0.45, y + b * 0.25); ctx.lineTo(x + b * 0.75, y - b * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + b * 0.48, y - b * 0.18); ctx.lineTo(x + b * 0.72, y - b * 0.1); ctx.stroke();
    } else if (type === 'defender') { // shield
      ctx.fillStyle = '#c8cdd6';
      roundRect(ctx, x - b * 0.85, y - b * 0.4, b * 0.42, b * 0.62, b * 0.12); ctx.fill();
      ctx.strokeRect(x - b * 0.85, y - b * 0.4, b * 0.42, b * 0.62);
    } else if (type === 'archer') { // bow
      ctx.beginPath(); ctx.arc(x + b * 0.62, y - b * 0.1, b * 0.42, -Math.PI * 0.42, Math.PI * 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + b * 0.62 + b * 0.42 * Math.cos(-Math.PI * 0.42), y - b * 0.1 + b * 0.42 * Math.sin(-Math.PI * 0.42));
      ctx.lineTo(x + b * 0.62 + b * 0.42 * Math.cos(Math.PI * 0.42), y - b * 0.1 + b * 0.42 * Math.sin(Math.PI * 0.42));
      ctx.stroke();
    } else if (type === 'scout') { // staff
      ctx.beginPath(); ctx.moveTo(x - b * 0.6, y + b * 0.5); ctx.lineTo(x - b * 0.6, y - b * 0.7); ctx.stroke();
    } else if (type === 'knight') { // lance
      ctx.beginPath(); ctx.moveTo(x + b * 0.4, y + b * 0.45); ctx.lineTo(x + b * 0.85, y - b * 0.85); ctx.stroke();
    } else if (type === 'settler') { // flag
      ctx.beginPath(); ctx.moveTo(x + b * 0.55, y + b * 0.5); ctx.lineTo(x + b * 0.55, y - b * 0.8); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + b * 0.55, y - b * 0.8); ctx.lineTo(x + b * 1.0, y - b * 0.65); ctx.lineTo(x + b * 0.55, y - b * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  function drawBoat(ctx, x, y, s, color) {
    const b = s * 0.55;
    // hull
    ctx.beginPath();
    ctx.moveTo(x - b * 0.9, y);
    ctx.quadraticCurveTo(x, y + b * 0.8, x + b * 0.9, y);
    ctx.lineTo(x + b * 0.7, y - b * 0.15);
    ctx.lineTo(x - b * 0.7, y - b * 0.15);
    ctx.closePath();
    ctx.fillStyle = '#8a6a40'; ctx.fill();
    ctx.strokeStyle = '#5e4526'; ctx.lineWidth = 1; ctx.stroke();
    // mast + sail in owner color
    ctx.strokeStyle = '#5e4526'; ctx.lineWidth = Math.max(1, b * 0.1);
    ctx.beginPath(); ctx.moveTo(x, y - b * 0.15); ctx.lineTo(x, y - b * 1.1); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - b * 1.05);
    ctx.quadraticCurveTo(x + b * 0.8, y - b * 0.7, x, y - b * 0.25);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawAnchor(ctx, x, y, s) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - s * 0.28); ctx.lineTo(x, y + s * 0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 0.16, y - s * 0.12); ctx.lineTo(x + s * 0.16, y - s * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y + s * 0.02, s * 0.22, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - s * 0.33, s * 0.07, 0, Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.GFX = { drawTile, drawBonus, drawVillage, drawCity, drawUnit, drawBoat, drawAnchor, shade };
})();
