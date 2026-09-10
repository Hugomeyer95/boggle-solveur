/**
 * Construit le dictionnaire compact de MOTS BOGGLE à partir de Lexique383.
 *
 * Source : http://www.lexique.org (Lexique 3.83, CC BY-SA 4.0)
 *
 * Sortie : assets/dict-fr.txt
 *   Liste triée, encodée en "front-coding" (compression par préfixe commun) :
 *   pour chaque mot -> 1 caractère (48 + longueur du préfixe partagé avec le
 *   mot précédent) puis le suffixe restant.
 *   Le suffixe est écrit en MAJUSCULES si le mot peut être un nom commun,
 *   en minuscules sinon. Aucun séparateur : le fichier est un seul long texte.
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];

const MIN_LEN = 3;
const MAX_LEN = 16;

/** Enlève les accents et ramène en A-Z. Renvoie null si le mot n'est pas jouable. */
function normalize(raw) {
  let s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacritiques
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null; // écarte espaces, traits d'union, apostrophes
  if (s.length < MIN_LEN || s.length > MAX_LEN) return null;
  return s;
}

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const header = lines[0].split('\t');
const iOrtho = header.indexOf('ortho');
const iCgram = header.indexOf('cgram');
const iCgramOrtho = header.indexOf('cgramortho');
if (iOrtho < 0 || iCgram < 0) throw new Error('Colonnes introuvables dans Lexique383');

/** mot normalisé -> est un nom commun (au moins un sens) */
const words = new Map();
let seen = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const f = line.split('\t');
  const ortho = f[iOrtho];
  if (!ortho) continue;
  seen++;
  const w = normalize(ortho);
  if (!w) continue;
  const cats = (f[iCgram] || '') + ',' + (f[iCgramOrtho] || '');
  const isNoun = /(^|,)NOM/.test(cats);
  words.set(w, (words.get(w) || false) || isNoun);
}

const sorted = [...words.keys()].sort();

let out = '';
let prev = '';
let nouns = 0;
for (const w of sorted) {
  let p = 0;
  const max = Math.min(prev.length, w.length, 60);
  while (p < max && prev[p] === w[p]) p++;
  const isNoun = words.get(w);
  if (isNoun) nouns++;
  const suffix = w.slice(p);
  out += String.fromCharCode(48 + p) + (isNoun ? suffix : suffix.toLowerCase());
  prev = w;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

console.log(`entrées lues        : ${seen}`);
console.log(`mots jouables       : ${sorted.length}`);
console.log(`dont noms communs   : ${nouns}`);
console.log(`taille fichier      : ${(out.length / 1024).toFixed(0)} Ko`);
console.log(`longueur max        : ${sorted.reduce((m, w) => Math.max(m, w.length), 0)}`);
