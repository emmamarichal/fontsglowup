# Typo Guide Generator

**🔗 Live site: [emmamarichal.github.io/fontsglowup](https://emmamarichal.github.io/fontsglowup/)**

A tool for composing, on the fly, a custom typography correction guide: check off the problems found on a project, the tool suggests the relevant links from an editable database, adjust as needed — then export a PDF ready to send.

A fully static site, built for GitHub Pages. No backend, no data ever sent anywhere: everything runs in the browser.

## Quick start

1. Enable GitHub Pages on this repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
2. Wait a minute, the site goes live at the URL above.
3. Done. The bundled link database is intentionally minimal — see [Filling in the link database](#data-links-databasejson--the-link-database) below.

**To test locally** (before pushing, or while the repo is still private), serve the folder with a small HTTP server — `fetch()`-ing the JSON files doesn't work by opening `index.html` directly with `file://`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Repo structure

```
.
├── index.html                    # the tool (3 steps)
├── contribute.html                # public "suggest a link" page (additive only)
├── css/
│   └── style.css                 # all the design
├── js/
│   ├── app.js                    # index.html logic
│   ├── pdf.js                    # PDF generation (pdfmake)
│   └── contribute.js             # contribute.html logic
└── data/
    ├── problems.json             # the checkbox cards in step 1
    └── links-database.json       # THE link database to fill in
```

Everything is vanilla JavaScript, no build step, nothing to install. The only external library is [pdfmake](https://pdfmake.github.io/docs/) (PDF generation), loaded via CDN in `index.html`.

## Design

Google-style: pale blue ambient gradient, translucent glass panels (`backdrop-filter: blur()`), [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex) for headings and body text, [Google Sans Code](https://fonts.google.com/specimen/Google+Sans+Code) for anything technical (tags, URLs, category labels). Both are free, OFL-licensed Google fonts, loaded from Google Fonts in `css/style.css`.

Step 1's problem cards are intentionally **not** grouped by category — they sit together in one mixed grid, distinguished only by a very pale background tint per category (see the `.cat-*` classes at the top of `css/style.css`), so cards from different scripts or topics can sit side by side.

## How it fits together

### `data/problems.json` — the cards in step 1

Each entry is a problem you can check, with `tags`:

```json
{
  "id": "germandbls",
  "category": "Extended Latin",
  "label": "Eszett (ß / ẞ — germandbls) poorly drawn",
  "description": "Incorrect construction of lowercase ß or capital ẞ…",
  "tags": ["german", "eszett", "germandbls"]
}
```

`category` sets the card's pale color tint (via a slugified `.cat-<category>` class — add a matching entry in `css/style.css` if you introduce a new category). `tags` is what links this problem to the links database below — feel free to invent your own tags, there's no closed list.

### `data/links-database.json` — THE link database

This is the heart of the tool:

```json
{
  "id": "unique-id",
  "title": "Displayed title",
  "url": "https://...",
  "tags": ["german", "eszett"],
  "explanation": "A sentence or two: shown both in the interface AND in the PDF under the link."
}
```

**A link shows up as soon as at least one of its tags matches a tag from a checked problem.** The same link can therefore appear under several headings if its tags cover several problems — that's intentional: in the PDF, each "problem" section should be self-contained.

**Editing it, as the repo owner:** it's just an array — edit by hand, or via GitHub's file editor (pencil icon on the file's page, in the repo).

**Suggestions from anyone else go through `contribute.html`**, not direct edits — see below.

**The database currently has 55 real, curated entries**, pulled from three sources: the [Google Fonts guide](https://googlefonts.github.io/gf-guide/), [Type Design Resources](https://typedesignresources.com/), and — thanks to screenshots — a first pass through [Rosalie Wagner's type-links database](https://rosaliewagner.com/type-links/) (Notion-hosted, not readable automatically). Every explanation was written from scratch rather than copied from those sites. Coverage is good for Latin/Vietnamese/Greek diacritics, eszett, Cyrillic, outlines, kerning, hinting, variable fonts and metadata. One gap: no source so far had a solid resource specifically on Arabic joining behavior — add one whenever you find a resource you trust.

Rosalie's list has **289 entries in total**; only the "Make fonts" section and the start of "Media" were screenshotted and reviewed, so most of it (podcasts, blogs, newsletters, plus whatever comes after what's been shared) isn't reflected here yet. It's also organized around some categories this tool's `problems.json` doesn't have yet (CJK, Math, Indigenous syllabics) — worth adding those as new problems if that's relevant to your work, so links tagged that way have somewhere to surface.

### `contribute.html` — letting other people suggest links, without letting them edit anything

This page is deliberately **additive-only**: it doesn't load the existing database, and there's no way to edit or delete anything through it — just a form to draft one or more new links, plus a button that opens GitHub with a new file pre-filled with those links, ready to commit.

**How it actually works, with no backend:** the button builds a `https://github.com/{owner}/{repo}/new/main?filename=...&value=...` URL — a real GitHub feature that pre-fills the "create new file" form — and opens it in a new tab. If the visitor doesn't have write access to the repo (the normal case), GitHub forks it for them automatically and proposes their commit back as a **pull request**. The live site is completely unaffected until you review that PR and merge it — this page has no code path that can write to the repo directly, by design.

For reliability, the proposed file lands as a loose `proposed-links-YYYY-MM-DD-<slug>.json` at the **repo root**, not inside `data/` — GitHub's pre-fill feature has a long-documented quirk where nested folder paths can get silently dropped from the URL, and the root has none of that risk. **Reviewing a suggestion means:** open the PR, check the JSON, copy the entries you want into `data/links-database.json` (fixing tags/wording as needed), delete the loose proposal file, and merge. A few extra seconds, in exchange for a URL construction that reliably works.

If `REPO_OWNER` / `REPO_NAME` at the top of `js/contribute.js` ever needs to change (repo renamed or transferred), update it there.

### The font name

There's no automated font-reading step — the "Project / font name" field in step 3 is filled in by hand. An earlier version of this tool let you drop a `.ttf` to auto-fill it (cosmetic only, no analysis), but that was confusing enough in practice — it looked like it might be checking the font — that it was removed. Manual entry is one field, and unambiguous.

## Deployment

Nothing special: GitHub Pages serves static files, and that's all this repo is.

1. `Settings → Pages → Source: Deploy from a branch`, branch `main`, folder `/ (root)`.
2. Wait a minute, the URL appears at the top of the Pages settings page.
3. Every `git push` to `main` republishes automatically.

All internal links on the site are relative (`css/style.css`, `js/app.js`, `contribute.html`…), so it works equally well at the root of a `*.github.io` domain or under a subpath `*.github.io/repo-name/`.

## Known limitations

- **No draft autosave**: reloading the page clears the current selection. This is deliberate, to keep the code simple and reliable — generate your PDF before closing the tab.
- **The link database has real content but is still partial** — 55 entries covering most categories, no Arabic resource yet, and most of Rosalie Wagner's 289-entry list (see above) hasn't been reviewed yet.
- **No automated font QA report.** This tool used to support importing a [Fontspector](https://github.com/fonttools/fontspector) JSON report into the PDF. It was removed: Fontspector can't run inside a static site (it's a separate Rust/WASM tool with no stable way to embed it here), so the feature only ever worked as a manual "run it yourself, then import the file" round-trip — which added real complexity for a payoff that turned out not to be worth it. If you want a font's QA report in hand, run Fontspector separately (CLI, or [fonttools.github.io/fontspector](https://fonttools.github.io/fontspector/)) and read it on its own; this tool now focuses purely on the link guide.
- The PDF uses pdfmake's default font (Roboto), which properly covers extended Latin, Cyrillic, Greek, and Vietnamese — but not every script (Arabic in particular won't render correctly in the PDF if you write Arabic text in an explanation).
- **`contribute.html`'s GitHub URL trick has a practical size limit.** A batch of many/long links can produce a URL too long for GitHub to accept; the page warns and falls back to showing a copyable JSON preview if that happens.
