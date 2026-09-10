/**
 * Lecture d'une grille de Boggle sur une photo.
 *
 * Chaîne de traitement :
 *   photo -> redimensionnement -> correction de perspective (homographie)
 *         -> découpe en 16 cases -> binarisation d'Otsu + recadrage serré
 *         -> reconnaissance de caractère (Tesseract, mode « caractère isolé »)
 *
 * La reconnaissance n'est jamais considérée comme définitive : chaque case
 * reçoit un indice de confiance, et l'interface laisse toujours corriger.
 */

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_SOURCE = 1500;   // côté max de l'image de travail
const WARP = 512;          // côté de la grille redressée
const CELL = WARP / 4;
const GLYPH = 128;         // taille de l'imagette envoyée à l'OCR

/* ---------------------------------------------------------------- image */

/** Décode un fichier image en canvas redimensionné, orientation EXIF appliquée. */
export async function fileToCanvas(file) {
  let source, w, h;
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w = source.width; h = source.height;
    } catch { source = null; }
  }
  if (!source) {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible'));
      img.src = URL.createObjectURL(file);
    });
    w = source.naturalWidth; h = source.naturalHeight;
  }

  const scale = Math.min(1, MAX_SOURCE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return canvas;
}

/** URL affichable pour un canvas (libérée par l'appelant). */
export function canvasToURL(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(URL.createObjectURL(b)), 'image/jpeg', 0.92);
    else resolve(canvas.toDataURL('image/jpeg', 0.92));
  });
}

/* -------------------------------------------------- correction de perspective */

/**
 * Homographie carré unité -> quadrilatère (Heckbert).
 * corners = [hautGauche, hautDroit, basDroit, basGauche], chacun {x, y}.
 */
function homography(corners) {
  const [p0, p1, p2, p3] = corners;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;

  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return { a: p1.x - p0.x, b: p2.x - p1.x, c: p0.x,
             d: p1.y - p0.y, e: p2.y - p1.y, f: p0.y, g: 0, h: 0 };
  }
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return {
    a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y, g, h,
  };
}

/**
 * Redresse la zone délimitée par `corners` en un carré WARP x WARP.
 * Échantillonnage bilinéaire.
 */
export function warpGrid(sourceCanvas, corners) {
  const sw = sourceCanvas.width, sh = sourceCanvas.height;
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;

  const out = document.createElement('canvas');
  out.width = out.height = WARP;
  const octx = out.getContext('2d');
  const img = octx.createImageData(WARP, WARP);
  const dst = img.data;

  const m = homography(corners);

  for (let oy = 0; oy < WARP; oy++) {
    const v = (oy + 0.5) / WARP;
    for (let ox = 0; ox < WARP; ox++) {
      const u = (ox + 0.5) / WARP;
      const w = m.g * u + m.h * v + 1;
      const x = (m.a * u + m.b * v + m.c) / w;
      const y = (m.d * u + m.e * v + m.f) / w;

      const o = (oy * WARP + ox) * 4;
      if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) {
        dst[o] = dst[o + 1] = dst[o + 2] = 255; dst[o + 3] = 255;
        continue;
      }
      const x0 = x | 0, y0 = y | 0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4;
      const i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        const top = src[i00 + k] + (src[i10 + k] - src[i00 + k]) * fx;
        const bot = src[i01 + k] + (src[i11 + k] - src[i01 + k]) * fx;
        dst[o + k] = top + (bot - top) * fy;
      }
      dst[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ------------------------------------------------ préparation d'une case */

/** Seuil d'Otsu sur un histogramme de niveaux de gris. */
function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * Extrait la case `index`, la binarise en noir sur blanc et recentre le glyphe.
 * @returns {HTMLCanvasElement} imagette GLYPH x GLYPH prête pour l'OCR
 */
export function prepareCell(warped, index) {
  const col = index % 4, row = (index / 4) | 0;
  const inset = Math.round(CELL * 0.15); // on écarte les bords du dé et son ombre
  const sx = col * CELL + inset, sy = row * CELL + inset;
  const side = CELL - inset * 2;

  const work = document.createElement('canvas');
  work.width = work.height = side;
  const wctx = work.getContext('2d');
  wctx.drawImage(warped, sx, sy, side, side, 0, 0, side, side);

  const data = wctx.getImageData(0, 0, side, side).data;
  const n = side * side;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const g = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0;
    gray[i] = g;
    hist[g]++;
  }
  const thr = otsu(hist, n);

  // Polarité : on regarde l'anneau extérieur, censé être le fond du dé.
  let border = 0, borderCount = 0;
  const ring = Math.max(2, (side * 0.08) | 0);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x < ring || y < ring || x >= side - ring || y >= side - ring) {
        border += gray[y * side + x]; borderCount++;
      }
    }
  }
  const darkBackground = border / borderCount < thr;

  // Masque de l'encre
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (darkBackground ? gray[i] > thr : gray[i] < thr) ink[i] = 1;
  }

  // On efface l'encre reliée au bord de la vignette : bordure du dé, ombre
  // portée, morceau du dé voisin. Seul le glyphe, isolé au centre, subsiste.
  const stack = [];
  const seed = (i) => { if (ink[i] === 1) { ink[i] = 2; stack.push(i); } };
  for (let x = 0; x < side; x++) { seed(x); seed((side - 1) * side + x); }
  for (let y = 0; y < side; y++) { seed(y * side); seed(y * side + side - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % side, y = (i / side) | 0;
    if (x > 0) seed(i - 1);
    if (x < side - 1) seed(i + 1);
    if (y > 0) seed(i - side);
    if (y < side - 1) seed(i + side);
  }

  // Boîte englobante du glyphe restant
  let minX = side, minY = side, maxX = -1, maxY = -1, inkCount = 0;
  const measure = (keep) => {
    minX = side; minY = side; maxX = -1; maxY = -1; inkCount = 0;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = y * side + x;
        if (ink[i] !== keep) continue;
        inkCount++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  };
  measure(1);

  // Filet de sécurité : si la lettre touchait le bord, on repart du masque brut.
  let keepValue = 1;
  if (inkCount < n * 0.004) {
    for (let i = 0; i < n; i++) if (ink[i] === 2) ink[i] = 1;
    measure(1);
    keepValue = 1;
  }

  const out = document.createElement('canvas');
  out.width = out.height = GLYPH;
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, GLYPH, GLYPH);

  const ratio = inkCount / n;
  out.dataset.aspect = '0';
  if (maxX < 0 || ratio < 0.005 || ratio > 0.75) return out; // case vide ou illisible
  out.dataset.aspect = String((maxY - minY + 1) / (maxX - minX + 1));

  // Imagette binaire intermédiaire
  const bin = document.createElement('canvas');
  bin.width = bin.height = side;
  const bctx = bin.getContext('2d');
  const bimg = bctx.createImageData(side, side);
  for (let i = 0; i < n; i++) {
    const v = ink[i] === keepValue ? 0 : 255;
    bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = v;
    bimg.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(bimg, 0, 0);

  // Recadrage serré puis mise à l'échelle avec marge (Tesseract aime l'air autour)
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const target = GLYPH * 0.66;
  const k = Math.min(target / bw, target / bh);
  const dw = bw * k, dh = bh * k;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(bin, minX, minY, bw, bh, (GLYPH - dw) / 2, (GLYPH - dh) / 2, dw, dh);
  return out;
}

/** Copie pivotée de `angle` degrés (multiples de 90). */
function rotate(canvas, angle) {
  if (!angle) return canvas;
  const out = document.createElement('canvas');
  out.width = out.height = canvas.width;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/* ------------------------------------------------------------ Tesseract */

let workerPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract indisponible')));
    s.onerror = () => reject(new Error('Moteur de reconnaissance non téléchargeable (connexion requise la première fois)'));
    document.head.appendChild(s);
  });
}

async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const T = await loadTesseract();
    const worker = await T.createWorker('eng', 1, {
      logger: (m) => {
        // Ce téléchargement n'a lieu qu'à la toute première analyse.
        if (m.status === 'loading tesseract core') onProgress?.('Première utilisation : téléchargement du moteur…', m.progress * 0.4);
        else if (m.status === 'loading language traineddata') onProgress?.('Première utilisation : téléchargement du modèle…', 0.4 + m.progress * 0.5);
        else if (m.status === 'initializing api') onProgress?.('Initialisation du moteur…', 0.95);
      },
    });
    await worker.setParameters({
      // Les minuscules doivent rester autorisées : le moteur propose souvent
      // « o », « u », « b »… pour une capitale, et une liste blanche
      // uniquement majuscule lui fait alors rendre une case vide.
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz012568',
      tessedit_pageseg_mode: '6',        // bloc uniforme : le plus fiable sur un glyphe isolé
    });
    return worker;
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/** Erreurs de lecture fréquentes sur les dés. */
const FIXES = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B', '|': 'I' };

/** Texte brut du moteur -> lettre de Boggle ('' si rien d'exploitable). */
function cleanup(text) {
  const c = (text || '').toUpperCase().replace(/[^A-Z0-9|]/g, '');
  if (!c) return '';
  // Le seul dé à deux caractères est « Qu » : toute lecture de deux symboles
  // se terminant par U vient forcément de celui-là.
  if (c.length >= 2 && c[c.length - 1] === 'U') return 'QU';
  const ch = FIXES[c[0]] || c[0];
  return /^[A-Z]$/.test(ch) ? ch : '';
}

/**
 * La confiance globale renvoyée par Tesseract vaut souvent 0 sur un caractère
 * isolé, même quand la lecture est juste : on prend celle du symbole.
 */
function readGlyph(data) {
  const symbols = data.blocks?.[0]?.paragraphs?.[0]?.lines?.[0]?.words?.[0]?.symbols;
  const letter = cleanup(data.text);
  if (!letter) return { letter: '', confidence: 0 };
  let confidence = 0;
  if (symbols?.length) {
    confidence = symbols.reduce((m, s) => Math.max(m, s.confidence || 0), 0);
  }
  if (!confidence) confidence = data.confidence || 40;
  return { letter, confidence };
}

/**
 * Reconnaît les 16 cases.
 *
 * Deux situations très différentes se présentent :
 *
 *  - photo d'une grille dont les lettres sont toutes droites : la lecture à 0°
 *    est excellente, et consulter les autres orientations ne fait qu'introduire
 *    des erreurs (un E pivoté se lit L à 100 % de confiance) ;
 *  - photo d'un vrai Boggle, où les dés retombent dans tous les sens : il faut
 *    au contraire tester les quatre orientations.
 *
 * On lit donc chaque case dans les quatre sens, puis on tranche pour toute la
 * grille : si la lecture à l'endroit l'emporte sur une majorité de cases, la
 * photo est droite. Ce rapport vaut ~75 % sur une grille droite contre ~12 %
 * sur des dés pivotés, l'arbitrage est net.
 *
 * @param {HTMLCanvasElement} warped grille redressée
 * @param {(msg:string, ratio:number)=>void} [onProgress]
 * @returns {Promise<{cells:{letter:string,confidence:number,doubt:boolean}[], upright:boolean}>}
 */
export async function recognizeGrid(warped, onProgress) {
  const worker = await getWorker(onProgress);
  const ANGLES = [0, 90, 180, 270];

  const perCell = [];
  for (let i = 0; i < 16; i++) {
    onProgress?.(`Lecture de la case ${i + 1} sur 16`, i / 16);
    const glyph = prepareCell(warped, i);
    const tries = [];
    for (const angle of ANGLES) {
      const { data } = await worker.recognize(rotate(glyph, angle), {}, { blocks: true, text: true });
      tries.push(readGlyph(data));
    }
    perCell.push({ tries, aspect: Number(glyph.dataset.aspect) || 0 });
  }

  // La photo est-elle droite ?
  let readable = 0, uprightWins = 0;
  for (const { tries } of perCell) {
    const top = tries.reduce((b, t) => (t.confidence > b.confidence ? t : b), tries[0]);
    if (!top.letter) continue;
    readable++;
    if (tries[0].letter === top.letter && tries[0].confidence === top.confidence) uprightWins++;
  }
  const upright = readable > 0 && uprightWins / readable >= 0.4;

  const cells = perCell.map(({ tries, aspect }) => {
    const top = tries.reduce((b, t) => (t.confidence > b.confidence ? t : b), tries[0]);
    // Photo droite : la lecture à l'endroit fait foi, les autres sont du bruit.
    let best = upright && tries[0].letter ? tries[0] : top;

    let doubt;
    if (upright) {
      doubt = best.confidence < 80;
    } else {
      // Dés pivotés : deux orientations au coude à coude = case ambiguë
      // (un N pivoté EST un Z, aucun moteur ne peut trancher seul).
      let rival = 0;
      for (const t of tries) if (t.letter && t.letter !== best.letter) rival = Math.max(rival, t.confidence);
      doubt = best.confidence < 80 || best.confidence - rival < 4;
    }

    // Un « I » se réduit à une barre verticale : le moteur rend souvent du vide.
    if (!best.letter && aspect > 2.2) best = { letter: 'I', confidence: 45 };

    return { letter: best.letter, confidence: best.confidence, doubt: doubt || !best.letter };
  });

  onProgress?.('Terminé', 1);
  return { cells, upright };
}

/** Libère le moteur (mémoire). */
export async function releaseOCR() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* ignore */ }
  workerPromise = null;
}
