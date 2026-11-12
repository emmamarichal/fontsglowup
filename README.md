# Typo Guide Generator

**🔗 Live site: [emmamarichal.github.io/fontsglowup](https://emmamarichal.github.io/fontsglowup/)**

A tool for triaging a font submission: check off the problems found on a project, the tool suggests the relevant links and tutorials from an editable database, runs Fontspector on the font, lets you attach annotated screenshots — then gives you **a Markdown checklist to post as a comment on the font's GitHub issue**, with **a link to the full report** (complete Fontspector messages, tutorials, screenshots).

A fully static site, built for GitHub Pages. No backend, no data ever sent anywhere: everything runs in the browser, and the full report is stored *in its link itself* (the [urlHosted](https://github.com/graphicore/urlHosted) technique).

## Quick start

1. Enable GitHub Pages on this repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
2. Wait a minute, the site goes live at the URL above.
3. Done. The bundled link database is intentionally minimal — see [Filling in the link database](#data-links-databasejson--the-link-database) below.

**To test locally** (before pushing, or while the repo is still private), serve the folder with a small HTTP server. Opening `index.html` directly (`file://…`) doesn't work: the browser refuses to load the JSON files and the Fontspector engine that way.

```bash
cd path/to/fontsglowup        # the folder that contains index.html
python3 -m http.server 8000
# then open http://localhost:8000 — stop the server with Ctrl+C
```

When the tool runs locally, the links *inside the GitHub comment* still point to the published site (`https://emmamarichal.github.io/fontsglowup/…`), since a `localhost` link would be useless to the designer — so push your changes before posting a comment that relies on a new `report.html`. The "Open the full report" button under the comment uses your local copy, for checking. The published address is `PUBLIC_SITE_URL` in `js/config.js`; on any other host (GitHub Pages, a fork) the current address is used automatically.

## Repo structure

```
.
├── index.html                    # the tool (6 steps)
├── report.html                   # the full report, read from its own link (#?…) — also shows single tutorials
├── contribute.html               # public "suggest a link or tutorial" page (additive only)
├── css/
│   ├── style.css                 # the design system (+ rendered Markdown, comment preview)
│   └── report.css                # report page + its print / "save as PDF" layout
├── js/
│   ├── app.js                    # index.html logic
│   ├── config.js                 # public site address, GitHub's comment size limit
│   ├── github-comment.js         # builds the Markdown checklist for the GitHub comment
│   ├── urlhosted.js              # stores a report in a link (urlHosted format) and reads it back
│   ├── report.js                 # report.html logic
│   ├── markdown.js               # small, safe Markdown → HTML renderer (tutorials, comments, preview)
│   ├── fontspector.js            # turns Fontspector results (engine or pasted report) into checkable rows
│   ├── fontspector-worker.js     # runs the Fontspector engine in the background
│   ├── fontinfo.js               # reads the dropped fonts: characters, scripts, variable axes
│   ├── compact.js                # the compact report link (references, under GitHub's ~4,000-character link limit)
│   └── contribute.js             # contribute.html logic
├── vendor/
│   └── fontspector/              # Fontspector compiled to WebAssembly (+ LICENSE, provenance README)
├── data/
│   ├── problems.json             # the checkbox cards in step 2
│   ├── check-rules.json          # which Fontspector checks point to which problem, and the links to fix them
│   ├── glyphsets.json            # the Google Fonts glyphsets, as code points (made by tools/build_font_data.py)
│   ├── languages.json            # the letters of every living language of gflanguages (same)
│   ├── links-database.json       # THE link database to fill in
│   └── tutorials.json            # the tutorial database (points at files below)
└── tutorials/
    └── *.md                      # the actual tutorial content, one file per tutorial
```

Everything is vanilla JavaScript, no build step, nothing to install, no external library: compression uses the browser's built-in `CompressionStream`. The one prebuilt piece is `vendor/fontspector/`, the Fontspector check engine compiled to WebAssembly — committed as-is, so the site still needs no build step (see [Updating the Fontspector engine](#updating-the-fontspector-engine) for how it was made).

## Design

Google-style: pale blue ambient gradient, translucent glass panels (`backdrop-filter: blur()`), [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex) for headings and body text, [Google Sans Code](https://fonts.google.com/specimen/Google+Sans+Code) for anything technical (tags, URLs, category labels, check IDs). Both are free, OFL-licensed Google fonts, loaded from Google Fonts in `css/style.css`.

Step 1's problem cards are intentionally **not** grouped by category — they sit together in one mixed grid, distinguished only by a very pale background tint per category (see the `.cat-*` classes at the top of `css/style.css`), so cards from different scripts or topics can sit side by side.

The full report page (`report.html`) uses the same design system: numbered glass panels, the same category tints, severity badges and colored edges for Fontspector checks, and the same pale blue **comment bubbles** as the comment fields in the tool.

## The output: a GitHub comment + the full report

Step 6 ("Generate the GitHub comment") produces two things, following feedback from the Google Fonts team (Markdown that fits GitHub issues, report state hosted in a URL):

### 1. The GitHub comment — a short checklist

Shown as a **Preview** (rendered like GitHub would) and as **Markdown** — which you can edit before copying, to adjust a phrase — with a **Copy the comment** button. Paste it as a comment on the font's GitHub issue. It's deliberately short; everything else is in the report link:

```markdown
### Typography review — Fontname v0.3
cc @designer-handle

Thanks a lot for the submission!

- [ ] Improve the Latin accents (see the screenshot in the full report)
- [ ] Redraw the germandbls (ß / ẞ)
- [ ] Clean up the outlines (see the screenshots in the full report)
- [ ] Fix the Fontspector fails listed below (2 more in the full report)

**Fontspector** · you can run the checks yourself on [Fontspector](https://fonttools.github.io/fontspector/) with the Google Fonts profile
- 🔥 **FAIL** `family/win_ascent_and_descent` — your comment on this check

📄 **[Full report](https://…/report.html#?eJy…)** — screenshots, links, tutorials and the complete Fontspector results.
```

- **Title** = the Title field + the project name. `cc @handle` only if the Designer field is a GitHub handle (it notifies them); a plain name stays in the report. Your intro note, if any, comes next.
- **One task per problem checked in step 2**, worded as an action: the `action` field of `data/problems.json` ("Improve the Latin accents"). A problem without one shows "Fix: *its label*". When screenshots are linked to that problem (step 5, "Linked issue"), the task adds "(see the screenshot(s) in the full report)".
- **One task for Fontspector** if checks are ticked: "Fix the Fontspector fails" / "Review the … warnings" / "fails and warnings", then **only the checks you commented on**, each with its comment. Ticked checks without a comment are only in the report ("2 more in the full report").
- **One task for screenshots not linked to any problem**, if there are some: "Go through the (other) annotated screenshots in the full report".
- **📄 Full report** — the link.

No links, tutorials, date or signature in the comment: they're all in the report (GitHub already shows who posted and when). Your comments are kept as Markdown (`**bold**`, `` `code` ``, links work); problem actions, check IDs and file names are escaped so they show exactly as written. On GitHub, the checkboxes of a comment can be ticked by its author and by the repo's maintainers.

### 2. The full report — stored in its own link

`report.html#?eJy1V…` — everything after `#?` *is* the report. It shows:

- a summary: counts, your intro note, the same **To do** list as the comment (each item jumps to its details), a table of contents;
- the issues with their links (title, address, explanation), tutorials and linked screenshots;
- the ticked Fontspector checks with their messages (shortened, or left out, when the link would get too long for GitHub), their **How to fix** links, the run details ("Fontspector 1.6.0 · googlefonts profile · MyFont.ttf · in total 20 FAIL, 21 WARN — 3 picked here") and your comments in bubbles;
- the tutorials, in full;
- the screenshots' captions, comments and the issue they're about — the images themselves are in the GitHub comment (see below);
- who reviewed it.

At the top: **Copy the GitHub comment** (rebuilds the same comment from the report), **Print or save as PDF** (a print layout is included: white background, no buttons, cards kept whole across pages), and **Edit in the generator**, which opens `index.html#?…`: the generator then refills every step from the link — problems, kept/unticked links, manual links, picked checks and their comments, screenshots, all fields — ready to change and generate again. As in urlHosted, the old link is removed from the address bar as soon as you change something, since it no longer matches.

**How the link works.** This is [urlHosted](https://github.com/graphicore/urlHosted)'s technique and format (Lasse Fister): the report is JSON, compressed with zlib (deflate), base64-encoded and placed after `#?`. Browsers never send the part after `#` to the server, so the report isn't stored anywhere: whoever has the link has the report, and it can't be edited or deleted after the fact (a new version is a new link). `js/urlhosted.js` produces exactly what urlHosted's `lib/sAndD.js` produces (checked: urlHosted's own pako code reads our links and vice versa), using the browser's built-in `CompressionStream` instead of a library. The data model is documented at the top of `js/github-comment.js`; it includes `title`, `author` and `date`, the field names urlHosted uses. `report.html` also opens links made with urlHosted itself (shown as a plain article).

**The size limit.** GitHub only makes a link **clickable up to about 4,096 characters** (the limit is GitHub's own, and it applies to `<a href>` as well: [community discussion](https://github.com/orgs/community/discussions/48174)). A first version stored the whole report in the link, so a link with screenshots ran to tens of thousands of characters: it opened from the generator, but stayed plain text on GitHub. Since then the link is **compact** (format v2, `js/compact.js`): it holds references — the ids of the problems, links and tutorials, whose text `report.html` reads from `data/*.json` and `tutorials/*.md` on the site — plus the picked Fontspector checks with your comments, and the screenshots' captions. The tool keeps the link under 4,000 characters: when it would be longer, the Fontspector messages are shortened, then left out (the checks, their titles and your comments stay); if it still doesn't fit, a note asks you to untick some links or checks. A note under the comment gives the link's length. Because links and tutorials are read from the site when the report opens, a correction to the database shows up in reports already posted. Old full links (format v1) still open.

**Screenshots go into the GitHub comment**, where GitHub hosts them. After generating, the tool shows each screenshot as a file (`screenshot-1.png`, … — up to 2000 px, PNG, with its dots drawn in) with a **Download all the screenshots** button. The comment has a **Screenshots** section with one line per image ("**1.** Latin accents poorly drawn — the comment") followed by `<!-- drag screenshot-1.png here -->`: on GitHub, click on that line and drag the file in, and GitHub uploads it and puts it in place. The comment must stay under GitHub's 65,536 characters, which text alone hardly reaches.

**Safety.** Since anyone can write a link, `report.html` treats its content as untrusted: everything is built as text nodes (never `innerHTML`), Markdown goes through `js/markdown.js`, which shows raw HTML as text and only keeps `http(s)`/`mailto`/relative links and `data:image` / `http(s)` images, and a Content-Security-Policy only allows this site's own scripts.

### Reviewer name and contact

Two optional fields in step 6 — who reviewed, and how to reach them (an e-mail address or a URL becomes a link). They sign the comment and close the full report.

## How it fits together

### Step 1: the fonts first

The tool starts with the fonts: drop the family (.ttf / .otf) and `js/fontinfo.js` reads what it contains — its characters (cmap), its coverage of the Google Fonts glyphsets (GF Latin Core, Plus, Vietnamese, Cyrillic, Greek, Arabic), the languages whose letters are all in the font (gflanguages exemplars), whether it's variable — while Fontspector checks it in the background (see [Fontspector report](#fontspector-report-step-4)). Dropping fonts is optional: without them, every problem and link is offered, as before.

With the fonts, two things change in the next steps:

- **Only what applies to the font is proposed.** A problem with a `requires` rule (below) that the font doesn't meet — Greek letters in a Latin-only font, Vietnamese stacking without a Vietnamese set, variable axes in a static font — moves to a folded *Not in this font* list, where it can't be ticked (and it's unticked if it was). Its `scope` tags are then left out of the links and tutorials: a link tagged `greek` isn't proposed for a font without Greek, even under "Latin accents poorly drawn".
- **The suggested problems are ticked from the start**, with a "Suggested: …" tag, mostly from the glyphsets and the languages: the scripts the font supports ("the font supports 65 Cyrillic languages (Russian, Ukrainian, Kazakh…)", Greek, Vietnamese, Arabic), an incomplete glyphset of a script the font supports ("29 missing in GF Latin Core (Ċ ċ Ġ ġ…)"), and, once Fontspector has run, the problems with a **FAIL, ERROR or FATAL** — warnings are shown on the cards ("Fontspector: 1 FAIL, 2 WARN") but don't tick anything. Step 3 is filled in right away. Untick what doesn't apply; a new drop replaces the suggestions.
- **Script resources stay with their script.** A link or tutorial about Vietnamese, Cyrillic, Greek, Arabic or ß only appears under that problem (`"exclusive": true` in `problems.json`): ticking "Latin accents" never brings the Vietnamese tone marks article, even for a font that supports Vietnamese.
- **What Fontspector finds points to the problems.** Each FAIL and WARN is matched to a problem with `data/check-rules.json` (below). In step 2 the matching cards get a "Found by Fontspector: n checks" badge, and a bar above the cards ticks them all in one click. In step 4 each check shows its problem and **How to fix** links; ticked checks carry them into the full report, and a commented check gets its first link in the GitHub comment.

### `data/problems.json` — the cards in step 2

Each entry is a problem you can check, with `tags`:

```json
{
  "id": "germandbls",
  "category": "Extended Latin",
  "label": "Eszett (ß / ẞ — germandbls) poorly drawn",
  "action": "Redraw the germandbls (ß / ẞ)",
  "description": "Incorrect construction of lowercase ß or capital ẞ…",
  "tags": ["german", "eszett", "germandbls"]
}
```

Two optional fields tie a problem to what the font contains:

```json
"requires": {"ranges": ["0370-03FF", "1F00-1FFF"], "min": 20, "missing": "no Greek letters"},
"scope": ["greek", "polytonic"]
```

`"suggest": "the font supports {n} Cyrillic languages ({names})"` ticks the problem when the font meets `requires`, with that reason on the card; `"suggest": {"incomplete": ["GF_Latin_Core", …]}` ticks it when one of these glyphsets is incomplete in a script the font supports. `"exclusive": true` keeps the links carrying the problem's `scope` tags under that problem only. `requires` says when the problem applies: `"language": "vi_Latn"` (every letter of that language is in the font), `"script": "Cyrl"` (every letter of at least one language in that script), at least one of the characters in `chars` (`"chars": "ßẞ"`), or `"variable": true`; `ranges` (hex) with `min` characters (default 1) is used instead of `language` / `script` when the language data can't be loaded. `missing` is shown on the card when the font doesn't meet it. `scope` lists the tags that only make sense with this script or feature: when the problem doesn't apply, links and tutorials carrying one of these tags are left out. Keep scope tags off general links (a general diacritics guide shouldn't be tagged `vietnamese`, or a Latin-only font would lose it).

`action` is the task this problem becomes in the GitHub checklist — short, imperative, in English, as the designer will read it ("Redraw the germandbls (ß / ẞ)"). `category` sets the card's pale color tint (via a slugified `.cat-<category>` class — add a matching entry in `css/style.css` if you introduce a new category). `tags` is what links this problem to the links and tutorials databases below — feel free to invent your own tags, there's no closed list.

### `data/links-database.json` — THE link database

This is the heart of the tool:

```json
{
  "id": "unique-id",
  "title": "Displayed title",
  "url": "https://...",
  "tags": ["german", "eszett"],
  "explanation": "A sentence or two: shown both in the interface AND in the full report under the link."
}
```

**A link shows up as soon as at least one of its tags matches a tag from a checked problem.** The same link can therefore appear under several headings if its tags cover several problems — that's intentional: in the report, each problem should be self-contained.

**Editing it, as the repo owner:** it's just an array — edit by hand, or via GitHub's file editor (pencil icon on the file's page, in the repo).

**Suggestions from anyone else go through `contribute.html`**, not direct edits — see below.

**The database currently has 55 real, curated entries**, pulled from three sources: the [Google Fonts guide](https://googlefonts.github.io/gf-guide/), [Type Design Resources](https://typedesignresources.com/), and — thanks to screenshots — a first pass through [Rosalie Wagner's type-links database](https://rosaliewagner.com/type-links/) (Notion-hosted, not readable automatically). Every explanation was written from scratch rather than copied from those sites. Coverage is good for Latin/Vietnamese/Greek diacritics, eszett, Cyrillic, outlines, kerning, hinting, variable fonts and metadata. One gap: no source so far had a solid resource specifically on Arabic joining behavior — add one whenever you find a resource you trust.

Rosalie's list has **289 entries in total**; only the "Make fonts" section and the start of "Media" were screenshotted and reviewed, so most of it (podcasts, blogs, newsletters, plus whatever comes after what's been shared) isn't reflected here yet. It's also organized around some categories this tool's `problems.json` doesn't have yet (CJK, Math, Indigenous syllabics) — worth adding those as new problems if that's relevant to your work, so links tagged that way have somewhere to surface.

### `data/tutorials.json` + `tutorials/*.md` — full tutorials, embedded (not just linked)

A tutorial is different from a link: since the content lives *in this repo* rather than on someone else's site, the tool can embed it in full — with headings, lists, bold/italic, code blocks — directly into the full report, right when a matching problem is checked (the report link carries a copy of the tutorial as it was when generated). The GitHub comment links each tutorial to `report.html?tutorial=<id>`, a page showing its current version. Two files work together:

```json
{
  "id": "unique-id",
  "title": "Displayed title",
  "path": "tutorials/my-tutorial.md",
  "tags": ["glyphs-software", "latin"],
  "description": "One line, shown in the interface next to the tutorial's title."
}
```

`path` points at the actual Markdown file. The database entry itself never holds the content — that stays in its own `.md` file under `tutorials/`, so it's easy to write, diff, and review on its own. Five starter examples are bundled (`tutorials/example-*.md`) — replace or expand them with your own.

**Supported Markdown**, handled by `js/markdown.js` (GitHub-flavoured): headings, paragraphs, `**bold**`/`*italic*`/`~~strike~~`/`` `code` ``, bulleted, numbered and `- [ ]` task lists (nested by indentation), fenced code blocks, `> ` blockquotes (nested too), tables, `---` rules, `[text](url)` links, bare `https://` links and `![alt](https://…)` images. Raw HTML is shown as text (except `<sub>`, `<sup>`, `<kbd>`, `<br>`).

In the interface (step 2), a matching tutorial appears above the links for its problem, in a highlighted card with a "Tutorial" badge and a note that it'll be embedded in full — not just its title and a link.

**Suggesting a tutorial** goes through `contribute.html`, same additive-only spirit as links — see below.

### `data/glyphsets.json` and `data/languages.json`

Made from the `glyphsets` and `gflanguages` Python packages; run again to update them:

```bash
pip install glyphsets gflanguages
python tools/build_font_data.py
```

A language counts as supported when all its base letters (exemplar characters, marks left out) are in the font — the same rule as the submissions report's character count. It doesn't check mark positioning, which shaperglot does in the submissions report, so it can count a few more languages.

### `data/check-rules.json` — from a Fontspector check to a problem and its fixes

```json
{
  "problem": "outlines",
  "checks": ["outline_*", "overlapping_path_segments", "contour_count"],
  "links": ["gf-guide-outlines", "glyphs-drawing-good-paths"]
}
```

`checks` are Fontspector check IDs (as shown on each row, e.g. `opentype/GDEF_mark_chars`); `*` stands for anything (`googlefonts/name/*`). The first rule that matches wins. `links` are IDs from `links-database.json`, shown as **How to fix** on the check. A check no rule matches is still offered, without a problem or links. To cover a new check, add its ID to a rule.

### Fontspector report (step 4)

**Drop the font files on the step 1 drop zone** (one font, or a whole family at once to also run the family-level checks). The tool runs [Fontspector](https://github.com/fonttools/fontspector) on them with the **Google Fonts profile**, right in the browser — it's the same `fontspector-web` engine as the [official web tool](https://fonttools.github.io/fontspector/), compiled to WebAssembly and committed in `vendor/fontspector/`. Nothing is uploaded anywhere.

How it runs: `js/app.js` reads the dropped files and hands them to `js/fontspector-worker.js`, a Web Worker (so the page stays responsive), which loads the engine and calls its `check_fonts(files, "googlefonts", …)` function. The engine (~14.5 MB, ~4.5 MB compressed) is only downloaded on the first drop, then cached by the browser; on a fast connection the first check takes a few seconds, later ones about a second. Network-dependent checks are skipped, exactly as in the official web tool. `Fontspector.fromCheckResults()` (`js/fontspector.js`) turns the raw results into rows: the check's readable title, its ID, which file it's about (when several were dropped), and its message, cleaned from Markdown to plain text. If the "Project / font name" field in step 6 is still empty, it's filled with the family name read from the font.

Then **tick the results worth prioritizing for this designer** — **FATAL**, **FAIL** and **WARN** are offered, **unchecked by default**. INFO, SKIP and PASS (and ERROR, when a check itself couldn't run) are only counted in the summary line, not offered as action items. Long messages are clamped to a few lines with a "Show full message" toggle.

Each check also has a **Comment** button. It's off by default — click it to reveal a small text field, add a note, click again to collapse it; the button shows a ✓ once something's written. The row itself is a clickable `<label>` that toggles its checkbox, so the comment button, the text field and "Show full message" all stop the click from bubbling up — otherwise opening a comment would also flip the checkbox.

Ticked items go into the report **as one continuous list, worst severity first** — no "TO FIX (n)" / "TO REVIEW (n)" headers. The GitHub comment only lists the ones you commented on (severity, ID, file, your comment). In the report, a card with its severity badge, colored left edge, title, complete message (identical messages repeated for several name records or glyphs are shown once) and your comment in a bubble. Both open with a fixed sentence pointing the designer at the tool itself, plus a line recording what produced the list ("Checked with Fontspector 1.6.0 · googlefonts profile · MyFont-Regular.ttf"):

> You can check this font yourself on Fontspector, using the Google Fonts profile — below is a curated selection of the fails and warnings worth resolving first.

**Fallback — paste a report.** Under the drop zone, "Already have a report? Paste it instead" still accepts a report produced elsewhere (e.g. `fontspector --profile googlefonts --ghmarkdown report.md MyFont.ttf`): JSON, Markdown or plain text. `Fontspector.parseReport()` tries `JSON.parse()` first, then scans the text for severity markers (🔥 FAIL, ⚠️ WARN…) and check IDs nearby. It recognizes the totals table most reports open with (one line naming every severity at once, then counts) and, if that's all that was pasted, says so instead of returning nothing silently. This fallback also opens automatically if the engine ever fails to load.

#### Updating the Fontspector engine

`vendor/fontspector/` is a snapshot (Fontspector 1.6.0, see `vendor/fontspector/README.md` for the exact commit). It won't change by itself. To refresh it with a newer Fontspector, on a machine with Rust and internet access:

```bash
git clone https://github.com/fonttools/fontspector.git
cd fontspector/fontspector-web
cargo install wasm-pack
RUSTFLAGS='-C target-feature=+bulk-memory' wasm-pack build --release --target web
# then copy pkg/fontspector_web.js and pkg/fontspector_web_bg.wasm
# into this repo's vendor/fontspector/, replacing the old ones
```

`--target web` matters: it produces a file the worker can `import` directly (the official site uses a bundler target instead). The function names the worker calls (`check_fonts`, `best_family_name`, `version`) have been stable, but if a future version renames them, `js/fontspector-worker.js` is the one file to adjust.

### `contribute.html` — letting other people suggest links or tutorials, without letting them edit anything

This page is deliberately **additive-only**: it never fetches the existing databases, and there's no way to edit or delete anything through it — just forms to draft new links or a new tutorial, plus buttons that copy the right content and open the real files on GitHub.

**Links, with no backend:** "Copy links & open GitHub" copies the new entries (formatted as ready-to-paste JSON) to the clipboard, then opens `https://github.com/{owner}/{repo}/edit/main/data/links-database.json` — GitHub's real, built-in "edit this file" page — in a new tab. If the visitor doesn't have write access to the repo (the normal case), GitHub forks it for them automatically. They paste (right after the array's opening `[`, before the existing entries — the page says so, and the copied snippet already ends in a comma so this is always safe) and commit, and GitHub proposes that commit back as a **pull request** — a normal diff against the real file, no separate files involved. The live site is completely unaffected until you review and merge that PR; this page has no code path that can write to the repo directly, by design.

The one manual step (pasting) exists because GitHub's URL pre-fill trick only works for *creating a brand-new file* — there's no equivalent for injecting content into an *existing* file's diff without a backend holding write credentials, which a static site can't safely have. Auto-copying the snippet and opening the exact right file at the exact right page gets a contributor to one paste + commit, with no secrets anywhere.

**Tutorials work the same way, but touch two files, so it's two explicit steps:**
1. *"Create the tutorial file on GitHub"* — the tutorial's Markdown content is a **brand-new file**, so this uses the reliable URL pre-fill trick directly: it opens GitHub with `tutorial-YYYY-MM-DD-<slug>.md` pre-filled with the written content, ready to commit as-is.
2. *"Copy its listing & open GitHub"* — copies the `data/tutorials.json` entry (referencing that same filename) to the clipboard and opens that file for editing, exactly like the links flow above.

Both steps derive the filename from the tutorial's title, so as long as the title isn't edited between clicking step 1 and step 2, the two stay in sync. Reviewing a tutorial PR means checking both the new `.md` file's content and its `tutorials.json` entry (which will likely be two separate commits, possibly even two separate PRs if the contributor didn't have both tabs open at once — merge them together, or ask the contributor to redo step 2 against a fork that already has their step-1 commit).

If `REPO_OWNER` / `REPO_NAME` / `REPO_BRANCH` at the top of `js/contribute.js` ever need to change (repo renamed, transferred, or default branch changed), update them there.

### Screenshots (step 5)

Drop one or more images in the tool itself (not through `contribute.html` — these are per-report, not part of the shared database). Each gets a **Linked issue** menu (the problems checked in step 2) and a comment field (a speech bubble, same as in the report).

**Mark the problem** (or a click on the image) opens it large, to put **translucent coloured dots** right on the problem: click to add a dot, drag it to move it, double-click or right-click it to remove it, with a choice of five colours, a size slider, Undo (⌘Z / Ctrl+Z) and Clear. The dots are drawn into the image files made for the GitHub comment. Linking a screenshot to a problem adds "(see the screenshot below)" to that problem's task in the GitHub checklist, and links the two in the report. The images go into the GitHub comment, which you drag them into (see [The size limit](#2-the-full-report--stored-in-its-own-link)); the full report has their captions and comments. Nothing is uploaded by the tool itself.

### The font name

The "Project / font name" field in step 6 can be typed by hand. When fonts are dropped in step 1, it's filled with the family name Fontspector reads from them — only if the field is still empty, so a name you've typed is never overwritten. (An early version auto-filled it from a dropped font without checking anything, which was misleading; now the drop genuinely runs the checks, so the auto-fill comes along with a real analysis.)

## Deployment

Nothing special: GitHub Pages serves static files, and that's all this repo is.

1. `Settings → Pages → Source: Deploy from a branch`, branch `main`, folder `/ (root)`.
2. Wait a minute, the URL appears at the top of the Pages settings page.
3. Every `git push` to `main` republishes automatically.

All internal links on the site are relative (`css/style.css`, `js/app.js`, `contribute.html`…), so it works equally well at the root of a `*.github.io` domain or under a subpath `*.github.io/repo-name/`. If the site moves (renamed repo, custom domain), update `PUBLIC_SITE_URL` in `js/config.js`; links already posted keep pointing to the old address, so keep the old one serving `report.html` if you can.

Make sure `vendor/fontspector/` is committed along with everything else — without it, the drop zone in step 1 can't run (the page then falls back to the paste field). The `.wasm` file is 14.5 MB: fine for `git push`, and under the 25 MB limit if you upload files through GitHub's web interface instead.

## Known limitations

- **No draft autosave**: reloading the page clears the current selection, including any screenshots you'd added. Once generated, though, the report link *is* a save: open it, click "Edit in the generator", and everything comes back except the screenshot images, which are in the GitHub comment.
- **The link database has real content but is still partial** — 55 entries covering most categories, no Arabic resource yet, and most of Rosalie Wagner's 289-entry list (see above) hasn't been reviewed yet.
- **The tutorial database has five example entries** — enough to prove the feature works end to end, not a real library yet.
- **Screenshots are dragged into the GitHub comment by hand**, one per line: GitHub doesn't accept images inside links or as `data:` addresses, and only hosts files dropped into a comment.
- **The report link must stay under ~4,000 characters** to be clickable on GitHub: a very long selection (dozens of checks with long comments, many manual links) may not fit, and the tool says so. A cut link opens on a clear "This report link is incomplete" page.
- **Links and tutorials are read from the site when a report opens**: if one is removed from the database, old reports lose it.
- **A report link can't be updated or deleted**: it contains the report. To correct one, edit it in the generator and post the new comment.
- **Only the picked Fontspector checks travel in the link**, not the whole run: "Edit in the generator" restores those (with comments); drop the fonts again to see the full results.
- **`contribute.html` requires a manual paste step** for both links and (for its second step) tutorials. GitHub's URL pre-fill trick only works for creating brand-new files, not for injecting content into an existing file's diff — so the page copies the snippet to the clipboard and opens the right file, but pasting is still a manual (if guided) step. See the explanation above for why.
- **The Fontspector engine is a snapshot** (1.6.0, October 2026) — newer Fontspector releases won't show up until `vendor/fontspector/` is rebuilt (see [Updating the Fontspector engine](#updating-the-fontspector-engine)). Like the official web tool, it skips checks that need the network (e.g. comparing against the version currently on Google Fonts), so a full command-line run can report a few more items.
- **The engine is ~14.5 MB** (~4.5 MB compressed): the first drop of a session takes a moment on a slow connection; after that it's cached.
- **The paste fallback's free-text parser is a heuristic, not a guarantee.** It's been tested against several realistic formats (JSON, `--ghmarkdown`-style emoji/label patterns, plain "STATUS id: message" lines, markdown with bold/backticks) and degrades gracefully — worst case, it finds nothing and says so, rather than showing something wrong. But a genuinely unusual paste could still slip past it; if a report you're confident is valid comes back empty, check `js/fontspector.js`'s `extractChecksFromText()`.

Part of [Google Fonts tools](https://github.com/emmamarichal/gf-issues-dashboard#readme).
