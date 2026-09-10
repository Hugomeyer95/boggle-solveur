# Boggle Solveur

Application web installable sur iPhone : photographie une grille de Boggle 4×4,
obtiens tous les mots français réalisables, classés par longueur décroissante,
avec le tracé de chaque mot sur la grille — et un minuteur pour la manche.

---

## Installer sur l'iPhone

### 1. Mettre l'app en ligne (une fois, ~5 minutes)

1. Double-clique sur **`preparer-publication.bat`**. Il crée un dossier
   **`publier/`** contenant uniquement ce qui doit partir en ligne (14 fichiers,
   561 Ko).
2. Va sur **`app.netlify.com/drop`** et connecte-toi (gratuit, e-mail ou GitHub).
3. **Glisse le dossier `publier`** dans la zone prévue. Attends une vingtaine de
   secondes.
4. Tu obtiens une adresse du type `https://truc-machin-123.netlify.app`.
5. Recommandé : dans les réglages du site, renomme-le pour obtenir une adresse
   lisible, par exemple `https://boggle-hugo.netlify.app`.

Cloudflare Pages ou GitHub Pages font la même chose, aussi gratuitement.

### 2. L'installer sur ton iPhone

1. Ouvre l'adresse dans **Safari** — pas Chrome, pas Firefox : seul Safari crée
   une véritable app autonome.
2. Attends que le badge en haut à droite affiche *« 44 243 noms · 115 160 mots »* :
   le dictionnaire est chargé et mis en cache.
3. Tant que tu es en Wi-Fi, **fais une première analyse de photo**. Elle
   télécharge le moteur de reconnaissance (~10 Mo), une fois pour toutes.
4. Bouton **Partager** (le carré avec la flèche, en bas au centre).
5. Fais défiler la liste, choisis **Sur l'écran d'accueil**, puis **Ajouter**.
6. Ferme Safari et lance l'app par son icône.
7. Vérification : active le **mode Avion**. L'app doit s'ouvrir et résoudre une
   grille normalement.

Ensuite, Safari n'intervient plus jamais.

### 3. La partager à des amis

Envoie-leur simplement l'adresse — mais **préviens-les d'ouvrir le lien dans
Safari**. Un lien tapé depuis WhatsApp, Messenger ou Instagram s'ouvre dans le
navigateur interne de l'application, où l'option *Sur l'écran d'accueil*
n'existe pas. Il faut alors utiliser *Ouvrir dans Safari* depuis le menu.

Message prêt à copier :

> Voilà l'app de Boggle : <ton adresse>
> Ouvre le lien **dans Safari** (si tu le tapes depuis WhatsApp, fais
> « Ouvrir dans Safari »), puis bouton Partager → *Sur l'écran d'accueil*.
> Tu auras l'icône sur ton téléphone et ça marche sans connexion.

Sur Android, c'est plus simple : dans Chrome, une bannière *Installer
l'application* apparaît toute seule.

### 4. Mettre à jour l'app (sans changer l'adresse)

**Ne repasse pas par Netlify Drop** : Drop crée à chaque fois un site neuf, avec
une nouvelle adresse. Pour mettre à jour le site existant, deux méthodes.

#### Par le tableau de bord

1. Relance **`preparer-publication.bat`**.
2. Va sur `app.netlify.com`, ouvre **ton site** dans la liste.
3. Onglet **Deploys**.
4. Glisse le dossier **`publier`** dans la zone de dépôt en bas de la liste des
   déploiements.

Un nouveau déploiement s'ajoute au même site : l'adresse ne bouge pas.

*Prérequis* : le site doit être rattaché à ton compte. Un site déposé sans être
connecté reste « non réclamé » et n'apparaît pas dans ta liste — il faut d'abord
le réclamer, ce qui fait aussi disparaître le bandeau Netlify.

#### En un double-clic

Mise en place, une seule fois : double-clique sur **`netlify-connexion.bat`**.
Il te connecte à Netlify, puis rattache ce dossier au site existant.

Ensuite, à chaque mise à jour, double-clique sur **`deployer.bat`** : il
régénère `publier/` puis l'envoie sur le site lié, toujours à la même adresse.

*Pourquoi des `.bat` et pas PowerShell ?* Par défaut, PowerShell refuse
d'exécuter `npx.ps1` et renvoie « l'exécution de scripts est désactivée sur ce
système ». Les fichiers `.bat` tournent sous `cmd.exe`, où cette restriction ne
s'applique pas — et ils appellent `npx.cmd`, l'autre point d'entrée de npx.
Rien à modifier dans les réglages de sécurité de Windows.

Si tu préfères la ligne de commande, ouvre une **Invite de commandes** (et non
PowerShell), ou dans PowerShell ajoute simplement le suffixe :

```
npx.cmd netlify-cli login
```

### Tester sans rien mettre en ligne

Pour un essai rapide sur ton réseau : double-clique sur
**`demarrer-serveur.bat`**, puis ouvre depuis l'iPhone l'adresse affichée
(type `http://192.168.1.23:8000`), en restant sur le même Wi-Fi. Utile pour
tester, mais l'icône ainsi installée **dépend du PC allumé** : en HTTP local,
iOS refuse le mode hors ligne. Pour une app réellement autonome, passe par
l'étape 1.

## Utilisation

**Grille.** *Photo* déclenche l'appareil, *Galerie* prend une image existante,
*Exemple* tire une grille au sort pour essayer. Après la photo, place les quatre
coins sur les angles extérieurs de la grille, puis *Analyser*. Les cases lues
sans certitude portent un **point ambré** : vérifie-les. Une case se corrige
d'un doigt — le clavier passe automatiquement à la suivante. La touche **QU**
sert au dé français « Qu ».

**Mots.** Résultats groupés par longueur décroissante. Le sélecteur
**Noms communs / Tous les mots** change le dictionnaire retenu, les pastilles
**3+ … 6+** la longueur minimale. **Touche un mot** : la grille s'affiche avec
le tracé animé et les numéros d'ordre. Si le mot s'écrit de plusieurs façons,
les flèches font défiler les chemins.

**Minuteur.** Durée au choix (1 à 5 min, ou ± 15 s), décompte circulaire, trois
notes à la fin. L'écran reste allumé pendant la manche. Par défaut les solutions
sont **masquées** tant que le minuteur tourne, pour ne pas gâcher la partie.

---

## Règles appliquées

- Lettres consécutives sur des cases **voisines**, diagonales comprises.
- **Aucune case réutilisée** dans un même mot.
- Mots de **3 lettres minimum**, présents au dictionnaire.
- Accents ignorés : la grille n'en porte pas, `COTE` vaut donc pour *côte* et *cote*.
- Points : 3–4 lettres = 1, 5 = 2, 6 = 3, 7 = 5, 8 et plus = 11.

### « Noms communs » ou « tous les mots » ?

Tu as demandé les noms communs : c'est le réglage **par défaut** (44 243 formes,
singuliers et pluriels). Mais au Boggle, toute entrée du dictionnaire compte
normalement — verbes conjugués, adjectifs, adverbes. D'où le second mode,
**Tous les mots** (115 160 formes), à un geste de distance. Les noms propres
sont exclus dans les deux cas.

---

## Ce qu'il y a dans le dossier

```
index.html              structure de l'app
styles.css              habillage
js/dict.js              chargement du dictionnaire compressé
js/solver.js            recherche des mots et des tracés
js/ocr.js               photo -> perspective -> lettres
js/timer.js             minuteur de manche
js/app.js               enchaînement des écrans
assets/dict-fr.txt      dictionnaire (348 Ko)
sw.js                   fonctionnement hors ligne
tools/build-dict.js     reconstruction du dictionnaire
tools/make-icons.js     génération des icônes
serve.py                serveur de test local
tools/build-site.js     prepare le dossier publier/
preparer-publication.bat  cree publier/ (double-clic)
netlify-connexion.bat   connexion + rattachement au site (une seule fois)
deployer.bat            met a jour le site Netlify lie (double-clic)
```

Le dictionnaire provient de **Lexique 3.83** (`lexique.org`, CC BY‑SA 4.0), qui
fournit la catégorie grammaticale de chaque forme — c'est ce qui permet de
distinguer les noms communs du reste. Pour le régénérer :

```bash
curl -o Lexique383.tsv http://www.lexique.org/databases/Lexique383/Lexique383.tsv
node tools/build-dict.js Lexique383.tsv assets/dict-fr.txt
```

---

## Notes techniques

La reconnaissance lit chaque case dans les **quatre orientations**, parce que
les dés d'un vrai Boggle retombent dans n'importe quel sens. L'app tranche
ensuite pour toute la grille : si la lecture à l'endroit l'emporte sur une
majorité de cases, la photo est droite et les autres orientations sont ignorées
— sans quoi un `E` pivoté se lirait `L` avec 100 % de confiance.

Quand les dés sont pivotés, certaines lettres sont **intrinsèquement ambiguës** :
un `N` tourné d'un quart de tour *est* un `Z`, un `M` est un `W`. Aucun moteur
ne peut trancher seul. Ces cases sont systématiquement signalées en ambré plutôt
que devinées en silence.

Mesures sur grille de synthèse : photo droite **16/16**, dés pivotés **13/16**,
et dans les deux cas **toutes** les erreurs sont signalées.
