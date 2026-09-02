# Typo Guide Generator

Un outil pour composer, à la volée, un guide de correction typographique sur mesure : tu coches les problèmes rencontrés sur un projet, l'outil propose les liens pertinents depuis une base éditable, tu ajustes, tu ajoutes en option un rapport [Fontspector](https://github.com/fonttools/fontspector) hiérarchisé et commenté — et tu exportes un PDF prêt à envoyer.

Site 100% statique, pensé pour GitHub Pages. Aucun backend, aucune donnée envoyée nulle part : tout tourne dans le navigateur.

## Démarrage rapide

1. Active GitHub Pages sur ce repo : **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
2. Ouvre l'URL générée (`https://<utilisateur>.github.io/<repo>/`).
3. C'est prêt. La base de liens fournie est volontairement minimale — voir [Remplir la base de liens](#remplir-la-base-de-liens) ci-dessous.

**Pour tester en local**, sers le dossier via un petit serveur HTTP (le `fetch()` des fichiers JSON ne fonctionne pas en ouvrant `index.html` directement avec `file://`) :

```bash
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

## Structure du repo

```
.
├── index.html                    # l'outil (4 étapes)
├── admin.html                    # éditeur visuel de la base de liens
├── css/
│   └── style.css                 # tout le design
├── js/
│   ├── app.js                    # logique de index.html
│   ├── fontspector.js            # parseur du rapport Fontspector (JSON)
│   ├── pdf.js                    # génération du PDF (pdfmake)
│   └── admin.js                  # logique de admin.html
└── data/
    ├── problems.json             # la liste de checkboxes de l'étape 1
    ├── links-database.json       # LA base de liens à enrichir
    └── fontspector-explanations.json  # explications pédagogiques par check-id
```

Tout est en JavaScript vanilla, sans build ni dépendance à installer. Les seules librairies externes sont chargées via CDN dans `index.html` :

- [pdfmake](https://pdfmake.github.io/docs/) — génération du PDF
- [opentype.js](https://opentype.js.org/) — lecture du nom de la police déposée

## Comment ça s'articule

### `data/problems.json` — les cases à cocher de l'étape 1

Chaque entrée est un problème que tu peux cocher, avec des `tags` :

```json
{
  "id": "germandbls",
  "category": "Latin étendu",
  "label": "Eszett (ß / ẞ — germandbls) mal dessiné",
  "description": "Construction incorrecte du ß minuscule ou du ẞ capital…",
  "tags": ["german", "eszett", "germandbls"]
}
```

`category` regroupe les cases sous un même intertitre dans l'interface. `tags` est ce qui relie ce problème aux liens de la base (ci-dessous) — libre à toi d'inventer tes propres tags, il n'y a pas de liste fermée.

### `data/links-database.json` — LA base de liens

C'est le cœur de l'outil, et celle que tu vas le plus modifier :

```json
{
  "id": "identifiant-unique",
  "title": "Titre affiché",
  "url": "https://...",
  "tags": ["german", "eszett"],
  "explanation": "Une ou deux phrases : apparaissent dans l'interface ET dans le PDF sous le lien."
}
```

**Un lien apparaît dès qu'au moins un de ses tags correspond à un tag d'un problème coché.** Un même lien peut donc apparaître sous plusieurs rubriques si ses tags couvrent plusieurs problèmes — c'est voulu : dans le PDF, chaque section « problème » doit être autonome.

**Deux façons de l'éditer :**

1. **`admin.html`** (recommandé) — page dédiée, formulaire par entrée, bouton *Exporter* qui télécharge un `links-database.json` à jour. Tu remplaces ensuite le fichier dans le repo et tu commit.
2. **Directement le fichier JSON** — c'est juste un tableau, éditable à la main ou via l'éditeur de fichier de GitHub (icône crayon sur la page du fichier, dans le repo).

Dans l'outil lui-même (`index.html`, étape 2), tu peux aussi ajouter un lien à la volée pour la session en cours ; un encart apparaît alors avec le JSON prêt à copier dans `links-database.json` si tu veux le garder pour la prochaine fois.

**La base fournie est volontairement un squelette.** Je n'ai mis que 3 ressources génériques dont je suis sûr (le guide QA de Google Fonts, le repo Fontspector, la spec OpenType) ; le reste, marqué `[EXEMPLE À REMPLACER]`, pointe vers des URLs factices (`example.com/...`) — je n'ai pas voulu inventer de vraies-fausses ressources sur des sujets aussi précis que la construction du ß ou l'empilement des tons vietnamiens. Remplace ces entrées par *tes* liens de référence.

### `data/fontspector-explanations.json` — traduire les checks en langage humain

Un rapport Fontspector brut est fait pour des outils, pas pour un designer. Chaque entrée ici associe un morceau d'identifiant de check à une explication en français :

```json
{
  "match": "underline_thickness",
  "title": "Épaisseur du soulignement incohérente",
  "explanation": "L'épaisseur du trait de soulignement ne correspond pas à ce qui est attendu…"
}
```

`match` est cherché d'abord en correspondance exacte avec le check-id, puis en *sous-chaîne* (le check-id **contient** `match`) — pratique parce que les check-ids sont souvent hiérarchiques (`opentype/family/underline_thickness`) et que tu n'as pas besoin de connaître l'ID complet et exact.

Je n'ai mis que deux entrées dont je suis certain (elles sont citées telles quelles dans la doc officielle de Fontspector) plus quelques entrées probables à vérifier/corriger à l'usage. **Complète cette base au fil de l'eau** : à chaque nouveau check qui revient souvent dans tes rapports, ajoute une entrée. S'il n'y a pas d'explication pour un check, le message brut de Fontspector s'affiche quand même, et tu peux toujours écrire un commentaire ad hoc directement dans l'interface (voir plus bas) — rien n'est bloquant.

## Le rapport Fontspector

**Pourquoi un import plutôt qu'un vrai bouton « analyser » ?** Fontspector est écrit en Rust et sa version web officielle est un vrai module WASM, compilé et déployé par leur pipeline CI — pas quelque chose qu'on peut proprement embarquer dans un site statique tiers sans dupliquer (et maintenir) leur build. Le choix le plus robuste est donc que ton outil **consomme le rapport JSON** que Fontspector produit, et que ce soit ton interface qui le trie/hiérarchise/explique. C'est aussi ce qui permet à l'outil de fonctionner offline, sans clé API ni service tiers.

**Obtenir le rapport JSON**, deux options :

- **Sans rien installer** : [fonttools.github.io/fontspector](https://fonttools.github.io/fontspector/), déposer le fichier, lancer l'analyse dans le navigateur.
- **En ligne de commande**, si [Fontspector est installé](https://github.com/fonttools/fontspector/blob/main/INSTALLATION.md) :
  ```bash
  fontspector --profile googlefonts --json rapport.json MaPolice.ttf
  ```
  (`--profile universal` ou `--profile opentype` si le profil Google Fonts ne convient pas à ton contexte — voir [USING.md](https://github.com/fonttools/fontspector/blob/main/USING.md) de Fontspector pour le détail des profils.)

Importe ensuite ce `rapport.json` dans l'outil (étape 3). Il est hiérarchisé du plus critique au plus informatif : **ERROR → FAIL → WARN → INFO**, chaque check accompagné (si dispo) d'une explication de la base ci-dessus, et d'un champ pour ton propre commentaire. Les checks en **SKIP** et **PASS** sont résumés en un seul compte, pour ne pas noyer les vrais problèmes.

### Si le parseur ne reconnaît rien

Le schéma JSON exact de `fontspector --json` peut évoluer (c'est un outil jeune, réécrit récemment en Rust) — plutôt que de coder en dur des noms de champs qui casseraient au moindre changement de version, `js/fontspector.js` parcourt le rapport et repère tout objet qui *ressemble* à un résultat de check (un statut connu + un identifiant à proximité). Si un jour ça ne trouve vraiment rien, l'app te le signale et inclut quand même le JSON brut en annexe du PDF — rien n'est perdu, mais jette un œil à la fonction `extractChecks()` dans `js/fontspector.js` pour l'ajuster au nouveau format.

## Déploiement

Rien de spécial : GitHub Pages sert des fichiers statiques, ce repo n'en est que ça.

1. `Settings → Pages → Source: Deploy from a branch`, branche `main`, dossier `/ (root)`.
2. Attends une minute, l'URL apparaît en haut de la page Pages.
3. Chaque `git push` sur `main` republie automatiquement.

Tous les liens internes du site sont relatifs (`css/style.css`, `js/app.js`, `admin.html`…), donc ça fonctionne aussi bien à la racine d'un domaine `*.github.io` que sous un sous-chemin `*.github.io/nom-du-repo/`.

## Limites connues

- **Pas de sauvegarde de brouillon** : un rechargement de page vide la sélection en cours. Volontaire pour garder le code simple et fiable — génère ton PDF avant de fermer l'onglet.
- **La base de liens fournie est un squelette**, voir plus haut.
- **Le format JSON de Fontspector peut évoluer** — le parseur est défensif mais pas infaillible, voir ci-dessus.
- Le PDF utilise la police par défaut de pdfmake (Roboto), qui couvre correctement latin étendu, cyrillique, grec et vietnamien — mais pas toutes les écritures (arabe notamment ne s'affichera pas correctement dans le PDF si tu écris du texte arabe dans une explication).
