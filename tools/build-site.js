/**
 * Prépare le dossier « publier/ » : uniquement ce qui doit partir en ligne.
 *
 * Les outils de développement (serveur local, scripts, README) restent en
 * dehors. Relancer ce script après chaque modification, puis redéposer le
 * dossier chez l'hébergeur.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'publier');

const FILES = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  'js/app.js',
  'js/dict.js',
  'js/ocr.js',
  'js/solver.js',
  'js/timer.js',
  'assets/dict-fr.txt',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
];

fs.rmSync(OUT, { recursive: true, force: true });

let total = 0;
for (const rel of FILES) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.error(`MANQUANT : ${rel}`);
    process.exitCode = 1;
    continue;
  }
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  total += fs.statSync(src).size;
}

console.log(`\n  Dossier prêt : ${OUT}`);
console.log(`  ${FILES.length} fichiers, ${(total / 1024).toFixed(0)} Ko au total`);
console.log('\n  Dépose ce dossier sur ton hébergeur (Netlify, Cloudflare Pages...).\n');
