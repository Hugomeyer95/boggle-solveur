/**
 * Résolveur de grille Boggle 4x4.
 *
 * Règles : les lettres consécutives doivent être adjacentes (8 voisins,
 * diagonales comprises) et une même case ne peut pas servir deux fois.
 * Une case peut porter « QU » (dé français classique) : elle apporte alors
 * les deux lettres d'un coup.
 */
import { dict } from './dict.js';

export const SIZE = 4;
export const CELLS = SIZE * SIZE;

/** Voisins (8-connexité) précalculés pour chaque case. */
export const NEIGHBORS = (() => {
  const n = [];
  for (let i = 0; i < CELLS; i++) {
    const r = (i / SIZE) | 0, c = i % SIZE;
    const list = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) list.push(rr * SIZE + cc);
      }
    }
    n.push(list);
  }
  return n;
})();

/** Barème Boggle classique. */
export function scoreOf(len) {
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11;
}

/**
 * Sélectionne les mots du dictionnaire compatibles avec les lettres présentes.
 * Filtre grossier mais très rapide (masque binaire puis comptage).
 */
function selectCandidates(cells, { nounsOnly, minLen, maxLen }) {
  const counts = new Uint8Array(26);
  let gridMask = 0;
  for (const cell of cells) {
    for (let k = 0; k < cell.length; k++) {
      const c = cell.charCodeAt(k) - 65;
      counts[c]++;
      gridMask |= 1 << c;
    }
  }

  const { words, masks, isNoun } = dict;
  const out = [];
  const tmp = new Uint8Array(26);
  for (let i = 0; i < words.length; i++) {
    if (masks[i] & ~gridMask) continue;          // contient une lettre absente
    if (nounsOnly && !isNoun[i]) continue;
    const w = words[i];
    if (w.length < minLen || w.length > maxLen) continue;
    tmp.fill(0);
    let ok = true;
    for (let k = 0; k < w.length; k++) {
      const c = w.charCodeAt(k) - 65;
      if (++tmp[c] > counts[c]) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** Construit un arbre préfixe (trie) sur les candidats. */
function buildTrie(indices) {
  const root = Object.create(null);
  const { words } = dict;
  for (const idx of indices) {
    const w = words[idx];
    let node = root;
    for (let k = 0; k < w.length; k++) {
      const ch = w[k];
      node = node[ch] || (node[ch] = Object.create(null));
    }
    node.$ = idx;
  }
  return root;
}

/**
 * Résout la grille.
 * @param {string[]} cells 16 cases, chacune 'A'..'Z' ou 'QU'
 * @param {{nounsOnly?:boolean, minLen?:number, maxLen?:number}} [opts]
 * @returns {{words:{word:string,path:number[],isNoun:boolean,score:number}[],
 *            total:number, score:number, ms:number}}
 */
export function solve(cells, opts = {}) {
  const t0 = performance.now();
  const { nounsOnly = false, minLen = 3, maxLen = 16 } = opts;

  const candidates = selectCandidates(cells, { nounsOnly, minLen, maxLen });
  const root = buildTrie(candidates);

  /** @type {Map<number, number[]>} index du mot -> premier chemin trouvé */
  const found = new Map();
  const path = [];

  const walk = (i, node, mask) => {
    const cell = cells[i];
    let n = node;
    for (let k = 0; k < cell.length; k++) {
      n = n[cell[k]];
      if (n === undefined) return;
    }
    path.push(i);
    const m = mask | (1 << i);
    if (n.$ !== undefined && !found.has(n.$)) found.set(n.$, path.slice());
    const nb = NEIGHBORS[i];
    for (let k = 0; k < nb.length; k++) {
      if (!(m & (1 << nb[k]))) walk(nb[k], n, m);
    }
    path.pop();
  };

  for (let i = 0; i < CELLS; i++) walk(i, root, 0);

  const words = [];
  let score = 0;
  for (const [idx, p] of found) {
    const word = dict.words[idx];
    const s = scoreOf(word.length);
    score += s;
    words.push({ word, path: p, isNoun: !!dict.isNoun[idx], score: s });
  }
  // Longueur décroissante, puis ordre alphabétique.
  words.sort((a, b) => b.word.length - a.word.length || (a.word < b.word ? -1 : 1));

  return { words, total: words.length, score, ms: performance.now() - t0 };
}

/**
 * Retrouve jusqu'à `limit` chemins distincts traçant `word` dans la grille.
 * @returns {number[][]}
 */
export function findPaths(cells, word, limit = 12) {
  const res = [];
  const path = [];

  const rec = (i, pos, mask) => {
    if (res.length >= limit) return;
    const cell = cells[i];
    if (!word.startsWith(cell, pos)) return;
    const next = pos + cell.length;
    path.push(i);
    const m = mask | (1 << i);
    if (next === word.length) {
      res.push(path.slice());
    } else {
      const nb = NEIGHBORS[i];
      for (let k = 0; k < nb.length; k++) {
        if (!(m & (1 << nb[k]))) rec(nb[k], next, m);
      }
    }
    path.pop();
  };

  for (let i = 0; i < CELLS && res.length < limit; i++) rec(i, 0, 0);
  return res;
}
