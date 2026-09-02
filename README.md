# Typo Guide Generator

**🔗 Live site: [emmamarichal.github.io/fontsglowup](https://emmamarichal.github.io/fontsglowup/)**

A tool for composing, on the fly, a custom typography correction guide: check off the problems found on a project, the tool suggests the relevant links from an editable database, adjust as needed, optionally add a hierarchized and annotated [Fontspector](https://github.com/fonttools/fontspector) report — then export a PDF ready to send.

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
├── index.html                    # the tool (4 steps)
├── admin.html                    # visual editor for the link database
├── css/
│   └── style.css                 # all the design
├── js/
│   ├── app.js                    # index.html logic
│   ├── fontspector.js            # Fontspector report parser (JSON)
│   ├── pdf.js                    # PDF generation (pdfmake)
│   └── admin.js                  # admin.html logic
└── data/
    ├── problems.json             # the checkbox list in step 1
    ├── links-database.json       # THE link database to fill in
    └── fontspector-explanations.json  # plain-language explanations per check-id
```

Everything is vanilla JavaScript, no build step, nothing to install. The only external libraries are loaded via CDN in `index.html`:

- [pdfmake](https://pdfmake.github.io/docs/) — PDF generation
- [opentype.js](https://opentype.js.org/) — reading the name of the dropped font

## How it fits together

### `data/problems.json` — the checkboxes in step 1

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

`category` groups checkboxes under the same subheading in the interface. `tags` is what links this problem to the links database below — feel free to invent your own tags, there's no closed list.

### `data/links-database.json` — THE link database

This is the heart of the tool, and the one you'll edit the most:

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

**Two ways to edit it:**

1. **`admin.html`** (recommended) — dedicated page, one form per entry, an *Export* button that downloads an up-to-date `links-database.json`. Replace the file in the repo, then commit.
2. **Directly the JSON file** — it's just an array, editable by hand or via GitHub's file editor (pencil icon on the file's page, in the repo).

Inside the tool itself (`index.html`, step 2), you can also add a link on the fly for the current session; an inset then appears with the JSON snippet ready to copy into `links-database.json` if you want to keep it for next time.

**The bundled database is deliberately a skeleton.** Only 3 generic resources are included that I'm confident about (the Google Fonts QA guide, the Fontspector repo, the OpenType spec); the rest, marked `[EXAMPLE — REPLACE ME]`, points to placeholder URLs (`example.com/...`) — I didn't want to invent fake-real resources on topics as specific as ß construction or Vietnamese tone-mark stacking. Replace those entries with *your* reference links.

### `data/fontspector-explanations.json` — translating checks into plain language

A raw Fontspector report is built for tools, not for a designer. Each entry here maps a piece of a check identifier to a plain-language explanation:

```json
{
  "match": "underline_thickness",
  "title": "Inconsistent underline thickness",
  "explanation": "The underline stroke thickness doesn't match what's expected…"
}
```

`match` is looked up as an exact match against the check-id first, then as a *substring* (the check-id **contains** `match`) — handy since check-ids are often hierarchical (`opentype/family/underline_thickness`) and you don't need to know the full, exact ID.

Only two entries here are ones I'm certain of (they're quoted verbatim in Fontspector's official docs), plus a handful of likely ones worth double-checking as you use them. **Grow this database as you go**: every time a check keeps showing up in your reports, add an entry. If there's no explanation for a check, Fontspector's raw message still displays, and you can always write an ad hoc comment right in the interface (see below) — nothing is a blocker.

## The Fontspector report

**Why import a report instead of a real "analyze" button?** Fontspector is written in Rust and its official web version is a real WASM module, built and deployed by their own CI pipeline — not something that can cleanly be embedded into a third-party static site without duplicating (and maintaining) their build. The most robust option is therefore for the tool to **consume the JSON report** that Fontspector produces, and let your own interface sort/hierarchize/explain it. It's also what keeps the tool working offline, with no API key or third-party service.

**Getting the JSON report**, two options:

- **Without installing anything**: [fonttools.github.io/fontspector](https://fonttools.github.io/fontspector/), drop the file, run the analysis in the browser.
- **From the command line**, if [Fontspector is installed](https://github.com/fonttools/fontspector/blob/main/INSTALLATION.md):
  ```bash
  fontspector --profile googlefonts --json report.json MyFont.ttf
  ```
  (`--profile universal` or `--profile opentype` if the Google Fonts profile doesn't fit your context — see Fontspector's [USING.md](https://github.com/fonttools/fontspector/blob/main/USING.md) for details on profiles.)

Then import that `report.json` into the tool (step 3). It's hierarchized from most critical to most informational: **ERROR → FAIL → WARN → INFO**, each check paired (if available) with an explanation from the database above, and a field for your own comment. **SKIP** and **PASS** checks are summarized as a single count, so real problems aren't buried.

### If the parser doesn't recognize anything

The exact JSON schema of `fontspector --json` can change over time (it's a young tool, recently rewritten in Rust) — rather than hard-coding field names that would break with the next version bump, `js/fontspector.js` walks the report and picks out anything that *looks like* a check result (a known status + a nearby identifier). If it genuinely finds nothing one day, the app tells you and still includes the raw JSON as an appendix in the PDF — nothing is lost, but take a look at the `extractChecks()` function in `js/fontspector.js` to adjust it to the new format.

## Deployment

Nothing special: GitHub Pages serves static files, and that's all this repo is.

1. `Settings → Pages → Source: Deploy from a branch`, branch `main`, folder `/ (root)`.
2. Wait a minute, the URL appears at the top of the Pages settings page.
3. Every `git push` to `main` republishes automatically.

All internal links on the site are relative (`css/style.css`, `js/app.js`, `admin.html`…), so it works equally well at the root of a `*.github.io` domain or under a subpath `*.github.io/repo-name/`.

## Known limitations

- **No draft autosave**: reloading the page clears the current selection. This is deliberate, to keep the code simple and reliable — generate your PDF before closing the tab.
- **The bundled link database is a skeleton**, see above.
- **Fontspector's JSON format may change** — the parser is defensive but not foolproof, see above.
- The PDF uses pdfmake's default font (Roboto), which properly covers extended Latin, Cyrillic, Greek, and Vietnamese — but not every script (Arabic in particular won't render correctly in the PDF if you write Arabic text in an explanation).
