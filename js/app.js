/**
 * Boggle Solveur — orchestration de l'interface.
 */
import { loadDictionary, dictStats } from './dict.js';
import { solve, findPaths, scoreOf } from './solver.js';
import { fileToCanvas, canvasToURL, warpGrid, recognizeGrid } from './ocr.js';
import { RoundTimer, formatTime } from './timer.js';

const $ = (id) => document.getElementById(id);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const STORE = 'boggle.v1';

/* ============================== état ============================== */

const state = {
  cells: Array(16).fill(''),
  doubt: Array(16).fill(false),   // cases lues avec une faible confiance
  result: null,                   // sortie complète du solveur
  mode: 'nouns',                  // 'nouns' | 'all'
  minLen: 4,
  editing: -1,
  view: 'grid',
  revealed: false,
  paths: [],
  pathIndex: 0,
  pathWord: '',
  sourceCanvas: null,
  corners: null,                  // 4 points normalisés [0..1]
  imgURL: null,
};

const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      cells: state.cells, mode: state.mode, minLen: state.minLen,
      duration: timer.durationMs / 1000, hideWords: $('hideWords').checked,
    }));
  } catch { /* quota / navigation privée */ }
}

/* ============================ utilitaires ============================ */

function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* iOS ignore */ } };

/* ============================== plateau ============================== */

const board = $('board');
const pathBoard = $('pathBoard');

function buildBoards() {
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.i = i;
    b.setAttribute('aria-label', `Case ${i + 1}`);
    b.addEventListener('click', () => openKeypad(i));
    board.appendChild(b);

    const p = document.createElement('div');
    p.className = 'tile';
    pathBoard.appendChild(p);
  }
}

function paintBoard({ animate = false } = {}) {
  [...board.children].forEach((tile, i) => {
    const v = state.cells[i];
    if (tile.textContent !== v) {
      tile.textContent = v;
      if (animate && v) {
        tile.classList.remove('pop');
        void tile.offsetWidth;           // relance l'animation
        tile.style.animationDelay = `${i * 28}ms`;
        tile.classList.add('pop');
      }
    }
    tile.classList.toggle('is-qu', v === 'QU');
    tile.classList.toggle('is-doubt', !!state.doubt[i] && !!v);
    tile.classList.toggle('is-editing', state.editing === i);
  });

  const filled = state.cells.filter(Boolean).length;
  const complete = filled === 16;
  $('solveBtn').disabled = !complete;
  $('solveSub').textContent = complete
    ? 'Grille complète'
    : `${filled} case${filled > 1 ? 's' : ''} sur 16 remplie${filled > 1 ? 's' : ''}`;

  const doubts = state.doubt.filter((d, i) => d && state.cells[i]).length;
  $('gridHint').textContent = doubts
    ? `${doubts} case${doubts > 1 ? 's' : ''} incertaine${doubts > 1 ? 's' : ''} (point ambré) — vérifie-la${doubts > 1 ? 's' : ''} avant de lancer.`
    : 'Touche une case pour saisir une lettre, ou photographie ta grille.';
  persist();
}

/* ============================== clavier ============================== */

function buildKeypad() {
  const keys = $('keys');
  const add = (label, cls, onClick) => {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = `key ${cls}`;
    k.textContent = label;
    k.addEventListener('click', onClick);
    keys.appendChild(k);
  };
  LETTERS.forEach((L) => add(L, '', () => setCell(L)));
  add('QU', 'accent', () => setCell('QU'));
  add('⌫', 'accent', () => setCell(''));
}

function openKeypad(i) {
  state.editing = i;
  $('keypadTitle').textContent = `Case ${i + 1} sur 16`;
  $('keypad').hidden = false;
  requestAnimationFrame(() => $('keypad').classList.add('is-open'));
  paintBoard();
}

function closeKeypad() {
  state.editing = -1;
  $('keypad').classList.remove('is-open');
  setTimeout(() => { if (state.editing === -1) $('keypad').hidden = true; }, 380);
  paintBoard();
}

function setCell(value) {
  const i = state.editing;
  if (i < 0) return;
  state.cells[i] = value;
  state.doubt[i] = false;
  buzz(8);
  if (value && i < 15) openKeypad(i + 1);
  else if (value) closeKeypad();
  else paintBoard();
}

/* ============================== photo ============================== */

async function handleFile(file) {
  if (!file) return;
  showBusy('Ouverture de la photo', 'Décodage…', 0.1);
  try {
    state.sourceCanvas = await fileToCanvas(file);
    if (state.imgURL) URL.revokeObjectURL(state.imgURL);
    state.imgURL = await canvasToURL(state.sourceCanvas);
    hideBusy();
    openCrop();
  } catch (err) {
    hideBusy();
    toast(err.message || 'Photo illisible');
  }
}

/* ---- cadrage : quadrilatère ajustable ---- */

const cropOverlay = $('cropOverlay');
const cropImg = $('cropImg');
const cropSvg = $('cropSvg');

function openCrop() {
  cropImg.onload = () => {
    // Carré centré occupant 72 % du plus petit côté affiché.
    const r = cropImg.getBoundingClientRect();
    const side = Math.min(r.width, r.height) * 0.72;
    const cx = r.width / 2, cy = r.height / 2;
    const n = (x, y) => ({ x: x / r.width, y: y / r.height });
    state.corners = [
      n(cx - side / 2, cy - side / 2), n(cx + side / 2, cy - side / 2),
      n(cx + side / 2, cy + side / 2), n(cx - side / 2, cy + side / 2),
    ];
    buildCropShapes();
    drawCrop();
  };
  dragging = -1;
  detachMoveListeners();
  cropOverlay.hidden = false;
  cropImg.src = state.imgURL;
  if (cropImg.complete && cropImg.naturalWidth) requestAnimationFrame(() => cropImg.onload());
}

function imgRect() {
  const r = cropImg.getBoundingClientRect();
  const s = cropSvg.getBoundingClientRect();
  return { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height };
}

const toScreen = (p, r) => ({ x: r.left + p.x * r.width, y: r.top + p.y * r.height });

/** Interpolation bilinéaire dans le quadrilatère (repères visuels). */
function quadPoint(u, v) {
  const [a, b, c, d] = state.corners;
  const top = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  const bot = { x: d.x + (c.x - d.x) * u, y: d.y + (c.y - d.y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

/* Les formes du cadrage sont créées une fois puis simplement déplacées :
   recréer les poignées à chaque mouvement détruisait l'élément sous le doigt. */
let handleDots = [];
let guideLines = [];

function buildCropShapes() {
  const NS = 'http://www.w3.org/2000/svg';
  const guides = $('cropGuides');
  const handles = $('cropHandles');
  guides.textContent = '';
  handles.textContent = '';
  guideLines = [];
  handleDots = [];
  for (let k = 0; k < 6; k++) {                 // 3 repères verticaux + 3 horizontaux
    const line = document.createElementNS(NS, 'line');
    guides.appendChild(line);
    guideLines.push(line);
  }
  for (let i = 0; i < 4; i++) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', 13);
    dot.setAttribute('class', 'handle');
    handles.appendChild(dot);
    handleDots.push(dot);
  }
}

function drawCrop() {
  if (!state.corners || handleDots.length !== 4) return;
  const r = imgRect();
  const pts = state.corners.map((p) => toScreen(p, r));
  $('cropPoly').setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));

  let n = 0;
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    for (const [p1, p2] of [[quadPoint(t, 0), quadPoint(t, 1)], [quadPoint(0, t), quadPoint(1, t)]]) {
      const a = toScreen(p1, r), b = toScreen(p2, r);
      const line = guideLines[n++];
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    }
  }

  pts.forEach((p, i) => {
    handleDots[i].setAttribute('cx', p.x);
    handleDots[i].setAttribute('cy', p.y);
  });
}

/* Saisie des coins.
   Trois précautions, apprises à la dure :
   - le coin est désigné par sa distance au doigt, jamais par l'élément touché ;
   - les mouvements sont écoutés sur `window`, donc le geste survit même si le
     SVG perd le pointeur — plus besoin de setPointerCapture, qui restait
     accroché sous Safari et gelait tout ;
   - large rayon de saisie : viser juste à côté d'un coin suffit. */
const GRAB_RADIUS = 100;   // px — on attrape un coin même en visant large
const OFFSET_LIMIT = 32;   // px — en deçà, on garde l'écart doigt/coin

let dragging = -1;
let grabOffset = { x: 0, y: 0 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Coordonnées du doigt dans le repère du SVG. */
function localPoint(clientX, clientY) {
  const box = cropSvg.getBoundingClientRect();
  return { x: clientX - box.left, y: clientY - box.top };
}

/** Coin le plus proche, avec sa distance. */
function nearestCorner(p) {
  const r = imgRect();
  let best = -1, bestDist = Infinity;
  state.corners.forEach((c, i) => {
    const s = toScreen(c, r);
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return { index: bestDist <= GRAB_RADIUS ? best : -1, dist: bestDist };
}

function beginDrag(clientX, clientY) {
  if (!state.corners || handleDots.length !== 4) return false;
  const p = localPoint(clientX, clientY);
  const { index, dist } = nearestCorner(p);
  if (index < 0) return false;

  dragging = index;
  // Prise précise : sous 32 px on conserve l'écart, le coin ne saute pas sous
  // le doigt. Au-delà, il vient se placer là où l'on a touché.
  const s = toScreen(state.corners[index], imgRect());
  grabOffset = dist <= OFFSET_LIMIT ? { x: s.x - p.x, y: s.y - p.y } : { x: 0, y: 0 };
  handleDots[index].classList.add('is-active');
  buzz(6);
  return true;
}

function moveDrag(clientX, clientY) {
  if (dragging < 0) return;
  const r = imgRect();
  const p = localPoint(clientX, clientY);
  state.corners[dragging] = {
    x: clamp01((p.x + grabOffset.x - r.left) / r.width),
    y: clamp01((p.y + grabOffset.y - r.top) / r.height),
  };
  drawCrop();
}

function endDrag() {
  if (dragging < 0) return;
  handleDots[dragging]?.classList.remove('is-active');
  dragging = -1;
  detachMoveListeners();
}

/* --- branchement des évènements : pointeur si disponible, tactile sinon --- */

const onPointerMove = (e) => { e.preventDefault(); moveDrag(e.clientX, e.clientY); };
const onTouchMove = (e) => {
  const t = e.touches[0];
  if (!t) return;
  e.preventDefault();
  moveDrag(t.clientX, t.clientY);
};

function attachMoveListeners() {
  if (window.PointerEvent) {
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  } else {
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', endDrag);
    window.addEventListener('touchcancel', endDrag);
  }
}

function detachMoveListeners() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('touchend', endDrag);
  window.removeEventListener('touchcancel', endDrag);
}

if (window.PointerEvent) {
  cropSvg.addEventListener('pointerdown', (e) => {
    if (beginDrag(e.clientX, e.clientY)) { e.preventDefault(); attachMoveListeners(); }
  });
} else {
  cropSvg.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t && beginDrag(t.clientX, t.clientY)) { e.preventDefault(); attachMoveListeners(); }
  }, { passive: false });
}

window.addEventListener('resize', () => { if (!cropOverlay.hidden) drawCrop(); });

$('cropCancel').addEventListener('click', () => { cropOverlay.hidden = true; });

$('cropOk').addEventListener('click', async () => {
  cropOverlay.hidden = true;
  const c = state.sourceCanvas;
  const corners = state.corners.map((p) => ({ x: p.x * c.width, y: p.y * c.height }));

  showBusy('Lecture de la grille', 'Correction de la perspective…', 0.05);
  await new Promise((r) => setTimeout(r, 40));

  try {
    const warped = warpGrid(c, corners);
    const { cells, upright } = await recognizeGrid(warped, (msg, ratio) =>
      showBusy('Lecture de la grille', msg, ratio));
    hideBusy();

    state.cells = cells.map((r) => r.letter);
    state.doubt = cells.map((r) => r.doubt);
    paintBoard({ animate: true });
    if (!upright) toast('Dés pivotés détectés — les lettres ambiguës sont signalées', 3200);

    const missing = state.cells.filter((v) => !v).length;
    const doubts = state.doubt.filter((d, i) => d && state.cells[i]).length;
    if (missing) toast(`${missing} case${missing > 1 ? 's' : ''} non lue${missing > 1 ? 's' : ''} — complète à la main`, 3600);
    else if (doubts) toast(`Grille lue — vérifie les ${doubts} case${doubts > 1 ? 's' : ''} signalée${doubts > 1 ? 's' : ''}`, 3600);
    else toast('Grille lue — vérifie d’un coup d’œil puis lance la recherche', 3600);
  } catch (err) {
    hideBusy();
    toast(err.message || 'Reconnaissance impossible', 4200);
  }
});

/* ---- écran d'attente ---- */

function showBusy(title, text, ratio) {
  $('busy').hidden = false;
  $('busyTitle').textContent = title;
  $('busyText').textContent = text;
  $('busyBar').style.width = `${Math.round((ratio || 0) * 100)}%`;
}
const hideBusy = () => { $('busy').hidden = true; };

/* ============================== résolution ============================== */

$('solveBtn').addEventListener('click', () => {
  if (state.cells.some((c) => !c)) return;
  closeKeypad();
  const r = solve(state.cells, { minLen: 3, nounsOnly: false });
  state.result = r;
  state.revealed = false;
  renderWords();
  switchView('words');
  buzz(14);
  if (!r.total) toast('Aucun mot trouvé dans cette grille');
});

function filtered() {
  if (!state.result) return [];
  return state.result.words.filter(
    (w) => w.word.length >= state.minLen && (state.mode === 'all' || w.isNoun)
  );
}

function renderWords() {
  const host = $('wordsHost');
  const words = filtered();

  $('summary').hidden = !state.result;
  $('filters').hidden = !state.result;
  $('tabBadge').hidden = !words.length;
  $('tabBadge').textContent = words.length > 999 ? '999+' : words.length;

  if (!state.result) return;

  const score = words.reduce((s, w) => s + scoreOf(w.word.length), 0);
  $('statWords').textContent = words.length;
  $('statScore').textContent = score;
  $('statBest').textContent = words.length ? `${words[0].word.length} l.` : '—';

  host.textContent = '';
  if (!words.length) {
    host.innerHTML = `<div class="empty"><div class="empty-art"></div>
      <h3>Aucun mot avec ces filtres</h3>
      <p>Essaie « Tous les mots » ou une longueur minimale plus courte.</p></div>`;
    return;
  }

  // Regroupement par longueur décroissante
  const groups = new Map();
  for (const w of words) {
    if (!groups.has(w.word.length)) groups.set(w.word.length, []);
    groups.get(w.word.length).push(w);
  }

  const frag = document.createDocumentFragment();
  let n = 0;
  for (const [len, list] of groups) {
    const section = document.createElement('section');
    section.innerHTML = `<div class="group-head">
        <b>${len} lettres</b><span>${list.length} mot${list.length > 1 ? 's' : ''}</span>
        <span class="pts">${scoreOf(len)} pt${scoreOf(len) > 1 ? 's' : ''} / mot</span>
      </div>`;
    const ul = document.createElement('div');
    ul.className = 'word-list';
    for (const w of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `word${len >= 7 ? ' is-long' : ''}`;
      b.textContent = w.word;
      b.style.animationDelay = `${Math.min(n++, 46) * 13}ms`;
      b.addEventListener('click', () => openSheet(w.word));
      ul.appendChild(b);
    }
    section.appendChild(ul);
    frag.appendChild(section);
  }
  host.appendChild(frag);
}

$('filters').addEventListener('click', (e) => {
  const seg = e.target.closest('.seg-item');
  if (seg) {
    state.mode = seg.dataset.mode;
    $('filters').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('is-on', b === seg));
    renderWords(); persist(); return;
  }
  const chip = e.target.closest('.chip');
  if (chip) {
    state.minLen = +chip.dataset.min;
    $('filters').querySelectorAll('.chips .chip').forEach((b) => b.classList.toggle('is-on', b === chip));
    renderWords(); persist();
  }
});

/* ============================== tracé du mot ============================== */

const sheet = $('sheet');

function openSheet(word) {
  state.pathWord = word;
  state.paths = findPaths(state.cells, word, 12);
  state.pathIndex = 0;
  $('sheetWord').textContent = word;
  const pts = scoreOf(word.length);
  $('sheetMeta').textContent = `${word.length} lettres · ${pts} point${pts > 1 ? 's' : ''}`;
  $('sheetBackdrop').hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  showPath();
  buzz(10);
}

function closeSheet() {
  sheet.classList.remove('is-open');
  $('sheetBackdrop').hidden = true;
  setTimeout(() => { sheet.hidden = true; }, 440);
}

let pathTimers = [];
function showPath() {
  pathTimers.forEach(clearTimeout);
  pathTimers = [];

  const path = state.paths[state.pathIndex] || [];
  const tiles = [...pathBoard.children];
  tiles.forEach((t, i) => {
    t.textContent = state.cells[i];
    t.classList.toggle('is-qu', state.cells[i] === 'QU');
    t.classList.remove('on', 'first');
  });
  $('pathLine').setAttribute('points', '');
  $('pathCount').textContent = `chemin ${state.pathIndex + 1} / ${state.paths.length || 1}`;
  $('prevPath').disabled = state.paths.length < 2;
  $('nextPath').disabled = state.paths.length < 2;

  // Centres des cases, en pourcentage du plateau.
  //
  // On passe par offsetLeft/offsetTop (position de mise en page) et non par
  // getBoundingClientRect : la fiche arrive en glissant, et des mesures à
  // l'écran prises à des instants différents pendant cette animation
  // décalaient le trait par rapport aux lettres.
  const centres = tiles.map((t) => ({
    x: ((t.offsetLeft - pathBoard.offsetLeft + t.offsetWidth / 2) / pathBoard.offsetWidth) * 100,
    y: ((t.offsetTop - pathBoard.offsetTop + t.offsetHeight / 2) / pathBoard.offsetHeight) * 100,
  }));

  // Révélation pas à pas : la case s'allume, puis le trait la rejoint.
  const drawn = [];
  path.forEach((cellIndex, step) => {
    pathTimers.push(setTimeout(() => {
      const tile = tiles[cellIndex];
      tile.classList.add('on');
      if (step === 0) tile.classList.add('first');
      if (!tile.querySelector('.step')) {
        const s = document.createElement('i');
        s.className = 'step';
        s.textContent = step + 1;
        tile.appendChild(s);
      } else {
        tile.querySelector('.step').textContent = step + 1;
      }
      const c = centres[cellIndex];
      drawn.push(`${c.x},${c.y}`);
      $('pathLine').setAttribute('points', drawn.join(' '));
    }, 90 * step + 60));
  });
}

$('sheetClose').addEventListener('click', closeSheet);
$('sheetBackdrop').addEventListener('click', closeSheet);
$('prevPath').addEventListener('click', () => {
  state.pathIndex = (state.pathIndex - 1 + state.paths.length) % state.paths.length;
  showPath();
});
$('nextPath').addEventListener('click', () => {
  state.pathIndex = (state.pathIndex + 1) % state.paths.length;
  showPath();
});

// Fermeture par glissement vers le bas
let sheetStartY = null;
sheet.addEventListener('touchstart', (e) => { sheetStartY = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener('touchmove', (e) => {
  if (sheetStartY === null) return;
  const dy = e.touches[0].clientY - sheetStartY;
  if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
}, { passive: true });
sheet.addEventListener('touchend', (e) => {
  const dy = e.changedTouches[0].clientY - (sheetStartY ?? 0);
  sheet.style.transform = '';
  sheetStartY = null;
  if (dy > 90) closeSheet();
}, { passive: true });

/* ============================== minuteur ============================== */

const RING = 2 * Math.PI * 88;

const timer = new RoundTimer({
  onTick: (ms, ratio) => {
    const label = formatTime(ms);
    const display = $('timeDisplay');
    if (display.textContent !== label) display.textContent = label;  // 1 écriture / seconde
    document.querySelector('.ring-fg').style.strokeDashoffset = String(RING * (1 - ratio));
    const card = document.querySelector('.timer-card');
    card.classList.toggle('is-warning', timer.running && ms <= 15000 && ms > 0);
  },
  onEnd: () => {
    const card = document.querySelector('.timer-card');
    card.classList.remove('is-running', 'is-warning');
    card.classList.add('is-done');
    $('timeSub').textContent = 'manche terminée';
    $('startBtn').querySelector('.btn-label').textContent = 'Démarrer';
    updateVeil();
    toast('Temps écoulé !', 4000);
    buzz([90, 60, 90]);
  },
});

document.querySelector('.ring-fg').style.strokeDasharray = String(RING);

$('presets').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip || timer.running) return;
  timer.setDuration(+chip.dataset.sec);
  markPreset();
  persist();
});

function markPreset() {
  const sec = timer.durationMs / 1000;
  $('presets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', +c.dataset.sec === sec));
}

$('minus').addEventListener('click', () => { timer.setDuration(timer.durationMs / 1000 - 15); markPreset(); persist(); });
$('plus').addEventListener('click', () => { timer.setDuration(timer.durationMs / 1000 + 15); markPreset(); persist(); });

$('startBtn').addEventListener('click', () => {
  const card = document.querySelector('.timer-card');
  const label = $('startBtn').querySelector('.btn-label');
  card.classList.remove('is-done');
  if (timer.running) {
    timer.pause();
    card.classList.remove('is-running');
    label.textContent = 'Reprendre';
    $('timeSub').textContent = 'en pause';
  } else {
    state.revealed = false;
    timer.start();
    card.classList.add('is-running');
    label.textContent = 'Pause';
    $('timeSub').textContent = 'manche en cours';
  }
  updateVeil();
  buzz(12);
});

$('resetBtn').addEventListener('click', () => {
  timer.reset();
  const card = document.querySelector('.timer-card');
  card.classList.remove('is-running', 'is-warning', 'is-done');
  $('startBtn').querySelector('.btn-label').textContent = 'Démarrer';
  $('timeSub').textContent = 'durée de la manche';
  updateVeil();
});

$('hideWords').addEventListener('change', () => { updateVeil(); persist(); });
$('revealBtn').addEventListener('click', () => { state.revealed = true; updateVeil(); });

function updateVeil() {
  const hide = timer.running && $('hideWords').checked && !state.revealed && !!state.result;
  $('wordsVeil').hidden = !hide;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) timer.refreshWakeLock();
});

/* ============================== navigation ============================== */

function switchView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.view === name));
  if (name !== 'grid') closeKeypad();
  document.querySelector(`#view-${name}`).scrollTop = 0;
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) { switchView(tab.dataset.view); buzz(6); }
});
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) switchView(go.dataset.goto);
});

$('keypadDone').addEventListener('click', closeKeypad);
$('clearGrid').addEventListener('click', () => {
  state.cells = Array(16).fill('');
  state.doubt = Array(16).fill(false);
  state.result = null;
  closeKeypad();
  paintBoard();
  renderWords();
  $('wordsHost').innerHTML = `<div class="empty"><div class="empty-art"></div>
    <h3>Aucun résultat pour l'instant</h3>
    <p>Renseigne une grille puis lance la recherche.</p>
    <button class="btn btn-glass" data-goto="grid" type="button">Aller à la grille</button></div>`;
  toast('Grille vidée');
});

/* ---- entrées photo ---- */

$('cameraBtn').addEventListener('click', () => $('fileCamera').click());
$('galleryBtn').addEventListener('click', () => $('fileGallery').click());
for (const id of ['fileCamera', 'fileGallery']) {
  $(id).addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    handleFile(f);
  });
}

/* ---- grille d'exemple (dés de Boggle) ---- */

const DICE = [
  'ETUKNO', 'EVGTIN', 'DECAMP', 'IELRUW', 'EHIFSE', 'RECALS', 'ENTDOS', 'OFXRIA',
  'NAVEDZ', 'EIOATA', 'GLENYU', 'BMAQJO', 'TLIBRA', 'SPULTE', 'AIMSOR', 'ENHRIS',
];
$('randomBtn').addEventListener('click', () => {
  const order = DICE.map((d, i) => [Math.random(), i]).sort((a, b) => a[0] - b[0]);
  state.cells = order.map(([, i]) => {
    const face = DICE[i][Math.floor(Math.random() * 6)];
    return face === 'Q' ? 'QU' : face;
  });
  state.doubt = Array(16).fill(false);
  closeKeypad();
  paintBoard({ animate: true });
  toast('Grille d’exemple générée');
});

/* ============================== démarrage ============================== */

async function boot() {
  buildBoards();
  buildKeypad();

  if (Array.isArray(saved.cells) && saved.cells.length === 16) state.cells = saved.cells;
  if (saved.mode) state.mode = saved.mode;
  if (saved.minLen) state.minLen = saved.minLen;
  if (saved.hideWords === false) $('hideWords').checked = false;
  $('filters').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === state.mode));
  $('filters').querySelectorAll('.chips .chip').forEach((b) => b.classList.toggle('is-on', +b.dataset.min === state.minLen));

  timer.setDuration(saved.duration || 180);
  markPreset();
  paintBoard();

  const badge = $('dictBadge');
  badge.hidden = false;
  badge.classList.add('is-loading');
  $('dictBadgeText').textContent = 'Chargement du dictionnaire…';
  try {
    await loadDictionary();
    const { total, nouns } = dictStats();
    badge.classList.remove('is-loading');
    $('dictBadgeText').textContent = `${nouns.toLocaleString('fr-FR')} noms · ${total.toLocaleString('fr-FR')} mots`;
  } catch (err) {
    $('dictBadgeText').textContent = 'Dictionnaire indisponible';
    toast(err.message || 'Dictionnaire introuvable', 5000);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne non critique */ });
  }
}

boot();
