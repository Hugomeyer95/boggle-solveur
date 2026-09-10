/**
 * Chargement et décodage du dictionnaire français compact.
 *
 * Format (voir tools/build-dict.js) : liste triée en front-coding.
 * Pour chaque mot : 1 octet = 48 + longueur du préfixe partagé avec le mot
 * précédent, puis le suffixe. Suffixe en MAJUSCULES => le mot peut être un
 * nom commun ; en minuscules => autre catégorie grammaticale.
 */

const A = 65; // 'A'

export const dict = {
  /** @type {string[]} tous les mots jouables, triés */
  words: [],
  /** @type {Uint8Array} 1 si le mot peut être un nom commun */
  isNoun: null,
  /** @type {Int32Array} masque des 26 lettres présentes dans le mot */
  masks: null,
  loaded: false,
};

/** Masque binaire des lettres distinctes d'un mot. */
function letterMask(word) {
  let m = 0;
  for (let i = 0; i < word.length; i++) m |= 1 << (word.charCodeAt(i) - A);
  return m;
}

/**
 * Télécharge et décode le dictionnaire. Idempotent.
 * @param {(ratio:number)=>void} [onProgress]
 */
export async function loadDictionary(onProgress) {
  if (dict.loaded) return dict;

  const res = await fetch('assets/dict-fr.txt');
  if (!res.ok) throw new Error(`Dictionnaire introuvable (${res.status})`);
  const raw = await res.text();
  onProgress?.(0.5);

  // Pré-dimensionnement : un mot commence à chaque octet de longueur (< 'A').
  let count = 0;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) < A) count++;

  const words = new Array(count);
  const isNoun = new Uint8Array(count);
  const masks = new Int32Array(count);

  let prev = '';
  let w = 0;
  let i = 0;
  while (i < raw.length) {
    const shared = raw.charCodeAt(i) - 48;
    i++;
    const start = i;
    while (i < raw.length && raw.charCodeAt(i) >= A) i++;
    const suffix = raw.slice(start, i);
    // Un suffixe en minuscules a un code >= 97 ; on teste le premier caractère.
    const noun = suffix.charCodeAt(0) < 97;
    const word = prev.slice(0, shared) + (noun ? suffix : suffix.toUpperCase());
    words[w] = word;
    isNoun[w] = noun ? 1 : 0;
    masks[w] = letterMask(word);
    prev = word;
    w++;
  }

  dict.words = words;
  dict.isNoun = isNoun;
  dict.masks = masks;
  dict.loaded = true;
  onProgress?.(1);
  return dict;
}

/** Statistiques affichables. */
export function dictStats() {
  let nouns = 0;
  for (let i = 0; i < dict.isNoun.length; i++) nouns += dict.isNoun[i];
  return { total: dict.words.length, nouns };
}
