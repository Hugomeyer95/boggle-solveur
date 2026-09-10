/**
 * Génère les icônes PNG de l'app (aucune dépendance externe).
 * Rendu par champs de distance signés + anti-aliasing par sur-échantillonnage.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- encodeur PNG minimal ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- géométrie ---------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSegment(px, py, ax, ay, bx, by, r) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t) - r;
}

/* Grille 3x3 en coordonnées normalisées [0,1] */
const TILE = 0.1622, GAP = 0.0568, ORIGIN = 0.20;
const cellCenter = (col, row) => [
  ORIGIN + TILE / 2 + col * (TILE + GAP),
  ORIGIN + TILE / 2 + row * (TILE + GAP),
];
const PATH = [[0, 1], [1, 0], [2, 1], [1, 2]];
const isActive = (c, r) => PATH.some(([pc, pr]) => pc === c && pr === r);

/** Renvoie [couvertureTuilesInactives, couvertureTracé] pour un point normalisé. */
function sample(x, y) {
  let inactive = 0, active = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const [cx, cy] = cellCenter(c, r);
      const d = sdRoundRect(x, y, cx, cy, TILE / 2, TILE / 2, TILE * 0.28);
      if (d < 0) { if (isActive(c, r)) active = 1; else inactive = 1; }
    }
  }
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, ay] = cellCenter(...PATH[i]);
    const [bx, by] = cellCenter(...PATH[i + 1]);
    if (sdSegment(x, y, ax, ay, bx, by, 0.021) < 0) active = 1;
  }
  return [inactive, active];
}

function render(size, { pad = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // sur-échantillonnage
  const scale = 1 - pad * 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let ia = 0, ac = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // coordonnées normalisées du contenu (avec marge de sécurité éventuelle)
          const nx = ((px + (sx + 0.5) / SS) / size - pad) / scale;
          const ny = ((py + (sy + 0.5) / SS) / size - pad) / scale;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
          const [i, a] = sample(nx, ny);
          ia += i; ac += a;
        }
      }
      const n = SS * SS;
      ia = ia / n; ac = ac / n;

      // fond : dégradé diagonal indigo -> rose, avec halo chaud en haut à droite
      const gx = px / (size - 1), gy = py / (size - 1);
      const t = clamp((gx + (1 - gy)) / 2, 0, 1);
      let R = mix(0x5b, 0xff, t), G = mix(0x3c, 0x4d, t), B = mix(0xf0, 0x8d, t);
      const halo = clamp(1 - Math.hypot(gx - 0.92, gy - 0.06) / 0.75, 0, 1) ** 2;
      R = mix(R, 0xff, halo * 0.55); G = mix(G, 0xb2, halo * 0.55); B = mix(B, 0x59, halo * 0.55);

      // tuiles inactives (blanc translucide) puis tracé (blanc plein)
      const aInactive = ia * 0.26 * (1 - ac);
      R = mix(R, 255, aInactive); G = mix(G, 255, aInactive); B = mix(B, 255, aInactive);
      R = mix(R, 255, ac); G = mix(G, 255, ac); B = mix(B, 255, ac);

      const o = (py * size + px) * 4;
      rgba[o] = Math.round(R); rgba[o + 1] = Math.round(G); rgba[o + 2] = Math.round(B); rgba[o + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = process.argv[2] || 'assets';
fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { pad: 0.12 }], // zone de sécurité Android
];
for (const [name, size, opts] of targets) {
  const buf = render(size, opts);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} Ko`);
}
