/* ==========================================================================
   Typo Guide Generator — app logic
   No data is ever sent to a server: everything happens in the browser
   (reading the repo's JSON/Markdown files, running Fontspector, reading
   dropped screenshots, building the GitHub comment and the report link).

   Output: a Markdown checklist for a GitHub comment (js/github-comment.js)
   that links to report.html#?<payload>, the full report stored in the link
   itself (js/urlhosted.js). Opening index.html#?<payload> loads a report
   back into the generator to edit it.
   ========================================================================== */

(function () {
  'use strict';

  const state = {
    problems: [],
    linksDb: [],
    tutorialsDb: [],
    selectedProblemIds: new Set(),
    autoLinks: [],       // links computed from tags, flat list
    autoTutorials: [],   // tutorials computed from tags, flat list
    manualLinks: [],     // links added by hand for this session
    included: {},        // 'link:<id>' | 'tutorial:<id>' -> bool (defaults to true)
    fontspectorChecks: [], // FATAL/FAIL/WARN results: { key, status, id, title, filename, message, included, comment }
    fontspectorCounts: null, // counts per severity, across the whole report
    fontspectorMeta: null,   // { source: 'engine'|'paste', version, profile, files }
    screenshots: [],      // { id, dataUrl, filename, comment, problem (linked problem id or null), marks: [{ x, y, r, color }] }
    font: null,           // what the dropped fonts contain (js/fontinfo.js), or null before a drop
    checkRules: [],       // data/check-rules.json: which Fontspector checks belong to which problem
    detected: {},         // problem id -> [Fontspector check ids that failed or warned]
    suggested: {},        // problem id -> why the tool ticked it ("Fontspector FAIL", "the font supports Vietnamese")
    failing: {},          // problem id -> [Fontspector check ids with FAIL, ERROR or FATAL]
    glyphsets: null,      // data/glyphsets.json
    languages: null,      // data/languages.json
    linksComputedFor: null, // selection the links/tutorials of step 2 were computed for
    lastOutput: null        // last generated { markdown, link, payload, … }
  };

  let manualIdCounter = 1;
  let screenshotIdCounter = 1;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const [problems, linksDb, tutorialsDb, checkRules, glyphsets, languages] = await Promise.all([
        fetchJSON('data/problems.json'),
        fetchJSON('data/links-database.json'),
        fetchJSON('data/tutorials.json').catch(() => []),
        fetchJSON('data/check-rules.json').catch(() => []),
        fetchJSON('data/glyphsets.json').catch(() => null),
        fetchJSON('data/languages.json').catch(() => null)
      ]);
      state.checkRules = checkRules;
      state.glyphsets = glyphsets;
      state.languages = languages;
      state.problems = problems;
      state.linksDb = linksDb;
      state.tutorialsDb = tutorialsDb;
    } catch (err) {
      showToast('Error loading data — ' + err.message);
      console.error(err);
      return;
    }
    renderProblems();
    bindStaticEvents();
    await restoreFromLink();
  }

  function fetchJSON(path) {
    return fetch(path).then((res) => {
      if (!res.ok) throw new Error(path + ' not found (HTTP ' + res.status + ')');
      return res.json();
    });
  }

  function includedKey(kind, id) { return kind + ':' + id; }

  function slugifyCategory(cat) {
    return String(cat)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function slugify(str) {
    const s = String(str)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    return s || 'link';
  }

  /* ------------------------------ Step 1: problems ------------------------------ */
  /* All problem cards render into a single mixed grid — cards from different
     categories sit side by side, distinguished only by a pale category tint
     (see .cat-* classes in css/style.css) rather than by grouped sections. */

  // Does the problem apply to the dropped fonts? (Always, before a drop.)
  function problemApplies(problem) {
    return !state.font || FontInfo.meets(state.font, problem.requires);
  }

  // Tags of the problems that don't apply to this font (Greek for a Latin-only
  // font…): a link or tutorial carrying one of them is about something the
  // font doesn't have, so it isn't proposed.
  function excludedTags() {
    const ex = new Set();
    if (!state.font) return ex;
    state.problems.forEach((p) => {
      if (p.scope && !problemApplies(p)) p.scope.forEach((t) => ex.add(t));
    });
    return ex;
  }

  function isAllowed(item, ex) {
    return !(item.tags || []).some((t) => ex.has(t));
  }

  // A link tagged with the scope of a script problem ("exclusive": Vietnamese,
  // Cyrillic, Greek, Arabic, ß) only goes under that problem: the Vietnamese
  // tone marks article isn't a resource for "Latin accents", even when the font
  // supports Vietnamese.
  function matchesProblem(item, p) {
    const tags = item.tags || [];
    if (!tags.some((t) => (p.tags || []).includes(t))) return false;
    return !state.problems.some((q) => q.exclusive && q.id !== p.id && (q.scope || []).some((t) => tags.includes(t)) &&
      !(p.scope || []).some((t) => tags.includes(t)));
  }

  function renderProblems() {
    const container = document.getElementById('problems-list');
    const other = document.getElementById('problems-other');
    const otherList = document.getElementById('problems-other-list');
    container.innerHTML = '';
    otherList.innerHTML = '';
    const skipped = [];
    state.problems.forEach((problem) => {
      if (problemApplies(problem)) container.appendChild(renderProblemCard(problem));
      else { skipped.push(problem); otherList.appendChild(renderProblemCard(problem, true)); }
    });
    other.hidden = !skipped.length;
    document.getElementById('problems-other-summary').textContent =
      'Not in this font (' + skipped.length + '): ' + skipped.map((p) => p.category === 'Technical' ? p.label : p.category).join(', ');
    renderDetectedBar();
  }

  // What the analysis ticks by itself: the scripts the font has (suggest: true in
  // problems.json), then the problems Fontspector finds. Unticking one is the
  // reviewer's call and sticks until the next drop. Problems that don't apply
  // to the font are unticked.
  function applySuggestions(fromFontspector) {
    if (!state.font) return;
    const dropped = [];
    state.problems.forEach((p) => {
      if (!problemApplies(p) && state.selectedProblemIds.has(p.id)) {
        state.selectedProblemIds.delete(p.id);
        dropped.push(p.label);
      }
    });
    const add = (p, why) => {
      if (state.selectedProblemIds.has(p.id) || !problemApplies(p)) return;
      state.selectedProblemIds.add(p.id);
      state.suggested[p.id] = why;
    };
    if (!fromFontspector) {
      const sup = state.font.support;
      state.problems.filter((p) => p.suggest).forEach((p) => {
        if (typeof p.suggest === 'string') {
          const langs = sup && p.requires && p.requires.script ? sup.byScript[p.requires.script] || [] : [];
          const names = langs.slice(0, 3).map((l) => l.name).join(', ') + (langs.length > 3 ? '…' : '');
          add(p, p.suggest.replace('{n}', langs.length).replace('{names}', names));
        } else if (p.suggest.incomplete && sup) {
          // a glyphset the font has started (half of it or more) but not finished
          const gap = supportedSets(sup).filter((g) => p.suggest.incomplete.includes(g.name) && g.missing.length);
          if (gap.length) add(p, gap.map((g) => g.missing.length + ' missing in ' + g.label + ' (' + g.missing.slice(0, 8).map(showChar).join(' ') + (g.missing.length > 8 ? '…' : '') + ')').join('; '));
        }
      });
    }
    // Fontspector: only what fails (FAIL, ERROR, FATAL); warnings are shown, not ticked
    detectedProblems().filter((p) => (state.failing[p.id] || []).length).forEach((p) => add(p, 'Fontspector FAIL'));
    renderProblems();
    refreshScreenshotIssueSelects();
    refreshLinks();
    if (dropped.length) showToast('Unticked, not in this font: ' + dropped.join(', '));
  }

  // The glyphsets of the scripts the font supports (at least one language):
  // GF Arabic Core shares digits and punctuation with any font, so it only
  // counts for a font that has Arabic.
  const SET_SCRIPT = { Latin: 'Latn', Cyrillic: 'Cyrl', Greek: 'Grek', Arabic: 'Arab' };
  function supportedSets(sup) {
    return sup.sets.filter((g) => {
      const sc = SET_SCRIPT[(g.name.match(/^GF_([A-Za-z]+)_/) || [])[1]];
      if (!sc || !(sup.byScript[sc] || []).length) return false;
      return g.name !== 'GF_Latin_Vietnamese' || sup.languages.has('vi_Latn') || g.have >= g.total * 0.9;
    });
  }

  // A combining mark on its own is shown on a dotted circle.
  function showChar(cp) {
    const ch = String.fromCodePoint(cp);
    return /\p{M}/u.test(ch) ? '◌' + ch : ch;
  }

  function detectedProblems() {
    return state.problems.filter((p) => (state.detected[p.id] || []).length);
  }

  function renderDetectedBar() {
    const bar = document.getElementById('detected-bar');
    const found = detectedProblems();
    bar.innerHTML = '';
    bar.hidden = !found.length;
    if (!found.length) return;
    const txt = document.createElement('p');
    txt.className = 'detected-bar__text';
    txt.textContent = 'Fontspector found problems in ' + found.length + (found.length === 1 ? ' area' : ' areas') + ': ' +
      found.map((p) => p.label + ' (' + state.detected[p.id].length + ')').join(', ') + '.';
    bar.appendChild(txt);
    const todo = found.filter((p) => !state.selectedProblemIds.has(p.id));
    if (todo.length) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--secondary';
      btn.textContent = todo.length === found.length ? 'Tick them' : 'Tick the other ' + todo.length;
      btn.addEventListener('click', () => {
        todo.forEach((p) => state.selectedProblemIds.add(p.id));
        renderProblems();
        refreshScreenshotIssueSelects();
        markStale();
      });
      bar.appendChild(btn);
    }
  }

  function renderProblemCard(problem, notInFont) {
    const label = document.createElement(notInFont ? 'div' : 'label');
    label.className = 'problem-card cat-' + slugifyCategory(problem.category) + (notInFont ? ' problem-card--absent' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = problem.id;
    checkbox.checked = state.selectedProblemIds.has(problem.id);
    checkbox.disabled = !!notInFont;
    checkbox.checked = !notInFont && state.selectedProblemIds.has(problem.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedProblemIds.add(problem.id);
      else state.selectedProblemIds.delete(problem.id);
      delete state.suggested[problem.id];  // the reviewer decided
      refreshScreenshotIssueSelects();
      renderDetectedBar();
      label.querySelector('.problem-card__suggested')?.remove();
      if (state.linksComputedFor !== null) refreshLinks();
    });

    const body = document.createElement('div');
    body.className = 'problem-card__body';

    const cat = document.createElement('span');
    cat.className = 'problem-card__category';
    cat.textContent = problem.category;
    body.appendChild(cat);

    const lbl = document.createElement('span');
    lbl.className = 'problem-card__label';
    lbl.textContent = problem.label;
    body.appendChild(lbl);

    if (state.suggested[problem.id] && state.selectedProblemIds.has(problem.id)) {
      const sug = document.createElement('span');
      sug.className = 'problem-card__suggested';
      sug.textContent = 'Suggested: ' + state.suggested[problem.id];
      body.appendChild(sug);
    }

    const found = state.detected[problem.id] || [];
    if (found.length) {
      const nFail = (state.failing[problem.id] || []).length;
      const nWarn = found.length - nFail;
      const badge = document.createElement('span');
      badge.className = 'problem-card__detected' + (nFail ? '' : ' problem-card__detected--warn');
      badge.textContent = 'Fontspector: ' + [nFail ? nFail + ' FAIL' : '', nWarn ? nWarn + ' WARN' : ''].filter(Boolean).join(', ');
      badge.title = found.join('\n');
      body.appendChild(badge);
    }
    if (notInFont && problem.requires && problem.requires.missing) {
      const why = document.createElement('span');
      why.className = 'problem-card__absent';
      why.textContent = 'Not in this font: ' + problem.requires.missing;
      body.appendChild(why);
    }

    if (problem.description) {
      const desc = document.createElement('p');
      desc.className = 'problem-card__desc';
      desc.textContent = problem.description;
      body.appendChild(desc);
    }

    if ((problem.tags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      problem.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    label.appendChild(checkbox);
    label.appendChild(body);
    return label;
  }

  /* -------------------------- Step 2: links & tutorials -------------------------- */

  function computeAutoLinks() {
    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const matches = [];
    const ex = excludedTags();
    state.linksDb.filter((l) => isAllowed(l, ex)).forEach((link) => {
      const matchedProblemIds = selected.filter((p) => matchesProblem(link, p)).map((p) => p.id);
      if (matchedProblemIds.length) {
        matches.push(Object.assign({}, link, { matchedProblemIds: matchedProblemIds }));
      }
    });
    return matches;
  }

  function computeAutoTutorials() {
    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const matches = [];
    const ex = excludedTags();
    state.tutorialsDb.filter((t) => isAllowed(t, ex)).forEach((tut) => {
      const matchedProblemIds = selected.filter((p) => matchesProblem(tut, p)).map((p) => p.id);
      if (matchedProblemIds.length) {
        matches.push(Object.assign({}, tut, { matchedProblemIds: matchedProblemIds }));
      }
    });
    return matches;
  }

  function selectionKey() {
    return Array.from(state.selectedProblemIds).sort().join('|');
  }

  function onShowLinks() {
    if (!state.selectedProblemIds.size) {
      showToast('Check at least one problem before showing links.');
      return;
    }
    refreshLinks();
  }

  // Recomputes the links and tutorials matching the selected problems.
  // Inclusion choices already made (unticked links…) are kept.
  function refreshLinks() {
    state.linksComputedFor = selectionKey();
    state.autoLinks = computeAutoLinks();
    state.autoTutorials = computeAutoTutorials();
    state.autoLinks.forEach((l) => {
      const k = includedKey('link', l.id);
      if (!(k in state.included)) state.included[k] = true;
    });
    state.autoTutorials.forEach((t) => {
      const k = includedKey('tutorial', t.id);
      if (!(k in state.included)) state.included[k] = true;
    });
    renderLinks();
  }

  function renderLinks() {
    const container = document.getElementById('links-groups');
    const emptyHint = document.getElementById('links-empty-hint');
    container.innerHTML = '';

    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    let anyRendered = false;

    selected.forEach((problem) => {
      const tutorialsForProblem = state.autoTutorials.filter((t) => t.matchedProblemIds.includes(problem.id));
      const linksForProblem = state.autoLinks.filter((l) => l.matchedProblemIds.includes(problem.id));
      if (!tutorialsForProblem.length && !linksForProblem.length) return;
      anyRendered = true;
      container.appendChild(renderProblemGroup(problem.label, tutorialsForProblem, linksForProblem, false));
    });

    if (state.manualLinks.length) {
      anyRendered = true;
      container.appendChild(renderProblemGroup('Added manually', [], state.manualLinks, true));
    }
    markStale();

    if (anyRendered) {
      emptyHint.style.display = 'none';
    } else {
      emptyHint.style.display = 'block';
      emptyHint.textContent = (state.autoLinks.length === 0 && state.autoTutorials.length === 0 && state.selectedProblemIds.size)
        ? "Nothing in the database matches this selection yet — add a link manually below, or fill out data/links-database.json / data/tutorials.json."
        : 'Check at least one problem in step 2, then click "Show links".';
    }
  }

  function renderProblemGroup(heading, tutorials, links, isManualGroup) {
    const wrap = document.createElement('div');
    wrap.className = 'link-group';

    const h = document.createElement('p');
    h.className = 'problem-group__title';
    h.textContent = heading;
    wrap.appendChild(h);

    if (tutorials.length) {
      const tutorialList = document.createElement('div');
      tutorialList.className = 'tutorial-list';
      tutorials.forEach((t) => tutorialList.appendChild(renderTutorialRow(t)));
      wrap.appendChild(tutorialList);
    }

    if (links.length) {
      const grid = document.createElement('div');
      grid.className = 'link-group__grid';
      links.forEach((link) => grid.appendChild(renderLinkRow(link, isManualGroup)));
      wrap.appendChild(grid);
    }

    return wrap;
  }

  function renderTutorialRow(tut) {
    const row = document.createElement('div');
    row.className = 'tutorial-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.included[includedKey('tutorial', tut.id)] !== false;
    checkbox.dataset.tutorialId = tut.id;
    checkbox.addEventListener('change', () => {
      const k = includedKey('tutorial', tut.id);
      state.included[k] = checkbox.checked;
      document.querySelectorAll('input[data-tutorial-id="' + CSS.escape(tut.id) + '"]').forEach((el) => {
        el.checked = checkbox.checked;
      });
    });

    const body = document.createElement('div');
    body.className = 'tutorial-row__body';

    const head = document.createElement('div');
    head.className = 'tutorial-row__head';
    const badge = document.createElement('span');
    badge.className = 'tutorial-badge';
    badge.textContent = 'Tutorial';
    head.appendChild(badge);
    const titleEl = document.createElement('p');
    titleEl.className = 'tutorial-row__title';
    titleEl.textContent = tut.title;
    head.appendChild(titleEl);
    body.appendChild(head);

    if (tut.description) {
      const desc = document.createElement('p');
      desc.className = 'tutorial-row__desc';
      desc.textContent = tut.description;
      body.appendChild(desc);
    }

    const note = document.createElement('p');
    note.className = 'tutorial-row__note';
    note.textContent = 'Included in full, with formatting, in the full report.';
    body.appendChild(note);

    if ((tut.tags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      tut.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    row.appendChild(checkbox);
    row.appendChild(body);
    return row;
  }

  function renderLinkRow(link, isManual) {
    const row = document.createElement('div');
    row.className = 'link-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.included[includedKey('link', link.id)] !== false;
    checkbox.dataset.linkId = link.id;
    checkbox.addEventListener('change', () => {
      const k = includedKey('link', link.id);
      state.included[k] = checkbox.checked;
      document.querySelectorAll('input[data-link-id="' + CSS.escape(link.id) + '"]').forEach((el) => {
        el.checked = checkbox.checked;
      });
    });

    const body = document.createElement('div');
    body.className = 'link-row__body';

    const titleEl = document.createElement('p');
    titleEl.className = 'link-row__title';
    titleEl.textContent = link.title;
    if (isManual) {
      const badge = document.createElement('span');
      badge.className = 'link-row__manual-badge';
      badge.textContent = 'manual';
      titleEl.appendChild(badge);
    }
    body.appendChild(titleEl);

    const urlEl = document.createElement('a');
    urlEl.className = 'link-row__url';
    urlEl.href = link.url;
    urlEl.target = '_blank';
    urlEl.rel = 'noopener';
    urlEl.textContent = link.url;
    body.appendChild(urlEl);

    if (link.explanation) {
      const exp = document.createElement('p');
      exp.className = 'link-row__explain';
      exp.textContent = link.explanation;
      body.appendChild(exp);
    }

    if ((link.tags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      link.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    row.appendChild(checkbox);
    row.appendChild(body);

    if (isManual) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn--danger-ghost link-row__remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.manualLinks = state.manualLinks.filter((l) => l.id !== link.id);
        delete state.included[includedKey('link', link.id)];
        renderLinks();
      });
      row.appendChild(removeBtn);
    }

    return row;
  }

  function onAddManualLink() {
    const titleInput = document.getElementById('ml-title');
    const urlInput = document.getElementById('ml-url');
    const explainInput = document.getElementById('ml-explain');
    const tagsInput = document.getElementById('ml-tags');

    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    const explanation = explainInput.value.trim();
    const tagsRaw = tagsInput.value.trim();

    if (!title || !url) {
      showToast('A title and a URL are required.');
      return;
    }

    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const id = 'manual-' + (manualIdCounter++);
    const link = { id: id, title: title, url: url, explanation: explanation, tags: tags };

    state.manualLinks.push(link);
    state.included[includedKey('link', id)] = true;

    titleInput.value = '';
    urlInput.value = '';
    explainInput.value = '';
    tagsInput.value = '';

    renderLinks();
    showManualLinkJsonHint(link);
  }

  function showManualLinkJsonHint(link) {
    const box = document.getElementById('manual-link-json');
    const pre = document.getElementById('manual-link-json-pre');
    const entry = {
      id: slugify(link.title),
      title: link.title,
      url: link.url,
      tags: link.tags,
      explanation: link.explanation
    };
    pre.textContent = JSON.stringify(entry, null, 2) + ',';
    box.classList.add('is-visible');
  }

  /* --------------------- Step 1 + 4: the fonts, and their Fontspector report -------------- */
  /* Main path: the user drops font files, and Fontspector itself (compiled to
     WebAssembly, vendored in vendor/fontspector/) runs the Google Fonts
     profile on them in a Web Worker — see js/fontspector-worker.js.
     Fallback path: paste a report produced elsewhere; Fontspector.parseReport()
     reads JSON, markdown or plain text. Either way, only FATAL/FAIL/WARN
     results are offered as checkboxes, unchecked by default — this is for
     picking a short priority list, not reproducing the whole report. */

  const CHECKABLE_STATUSES = ['FATAL', 'FAIL', 'WARN'];
  const CHECKABLE_STATUS_LABEL = { FATAL: 'FATAL — critical', FAIL: 'FAIL — to fix', WARN: 'WARN — to review' };
  const FONT_EXTENSIONS = /\.(ttf|otf)$/i;

  // One worker for the whole session: the engine loads once (a few MB),
  // then every later drop reuses it. Each run carries an id that the worker
  // echoes back, so a second drop while a check is still running can never
  // have its results mixed up with the first one's.
  const fsEngine = { worker: null, ready: false, run: null, nextRunId: 1 };

  function setFontspectorStatus(text, kind) {
    const el = document.getElementById('fontspector-status');
    el.textContent = text || '';
    el.className = 'fontspector-status' + (kind ? ' fontspector-status--' + kind : '');
  }

  function ensureFontspectorWorker() {
    if (fsEngine.worker) return fsEngine.worker;
    if (typeof Worker === 'undefined') throw new Error('this browser does not support Web Workers');
    const worker = new Worker('js/fontspector-worker.js', { type: 'module' });
    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'ready') {
        fsEngine.ready = true;
        if (fsEngine.run) fsEngine.run.onReady();
        return;
      }
      const run = fsEngine.run;
      if (!run) return;
      if (msg.runId !== undefined && msg.runId !== run.id) return; // stale result from a superseded run
      if (msg.type === 'result') run.onResult(msg);
      else if (msg.type === 'error') run.onError(msg.error);
    };
    worker.onerror = (event) => {
      // Fires when the worker script or the engine files can't load at all.
      if (event && event.preventDefault) event.preventDefault();
      worker.terminate();
      fsEngine.worker = null;
      fsEngine.ready = false;
      const run = fsEngine.run;
      if (run) run.onError((event && event.message) || 'the engine files did not load', true);
    };
    fsEngine.worker = worker;
    return worker;
  }

  function readFileAsBytes(file) {
    if (file.arrayBuffer) return file.arrayBuffer().then((buf) => new Uint8Array(buf));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function describeFiles(names) {
    return names.length === 1 ? names[0] : names.length + ' fonts';
  }

  function openPasteFallback() {
    const details = document.getElementById('fontspector-paste-details');
    if (details) details.open = true;
  }

  async function onFontFiles(fileList) {
    const all = Array.from(fileList || []);
    const fonts = all.filter((f) => FONT_EXTENSIONS.test(f.name));
    const skipped = all.length - fonts.length;
    if (!fonts.length) {
      showToast('Drop .ttf or .otf font files.');
      return;
    }
    if (skipped) showToast(skipped + (skipped === 1 ? ' file was' : ' files were') + ' not a .ttf/.otf font and got skipped.');

    const names = fonts.map((f) => f.name);
    const files = {};
    let bytes;
    try {
      bytes = await Promise.all(fonts.map(readFileAsBytes));
      fonts.forEach((f, i) => { files[f.name] = bytes[i]; });
    } catch (err) {
      setFontspectorStatus("Couldn't read the font file(s): " + err.message, 'error');
      return;
    }

    // What the fonts contain: the problems and links that don't apply are set aside.
    const infos = [];
    bytes.forEach((b, i) => {
      try { infos.push(FontInfo.read(b)); } catch (err) { showToast(names[i] + ': ' + err.message); }
    });
    state.font = infos.length ? FontInfo.merge(infos) : null;
    if (state.font && state.languages) state.font.support = FontInfo.support(state.font, state.glyphsets, state.languages);
    state.detected = {};
    state.failing = {};
    Object.keys(state.suggested).forEach((id) => state.selectedProblemIds.delete(id));  // a new font, new suggestions
    state.suggested = {};
    renderFontSummary(names);
    applySuggestions(false);

    let worker;
    try {
      worker = ensureFontspectorWorker();
    } catch (err) {
      setFontspectorStatus("Fontspector can't run here (" + err.message + '). Paste a report instead, below.', 'error');
      openPasteFallback();
      return;
    }

    const run = { id: fsEngine.nextRunId++, names: names, started: Date.now(), phase: fsEngine.ready ? 'checking' : 'loading', ticker: null };
    fsEngine.run = run;

    function refresh() {
      if (fsEngine.run !== run) return;
      const secs = Math.round((Date.now() - run.started) / 1000);
      if (run.phase === 'loading') {
        setFontspectorStatus('Loading Fontspector… (a few MB the first time, cached afterwards) ' + secs + 's', 'busy');
      } else {
        setFontspectorStatus('Checking ' + describeFiles(names) + ' with the Google Fonts profile… ' + secs + 's', 'busy');
      }
    }
    function stop() { clearInterval(run.ticker); }

    run.onReady = () => { run.phase = 'checking'; refresh(); };
    run.onResult = (msg) => { stop(); fsEngine.run = null; onFontspectorEngineResults(msg, names); };
    run.onError = (error, couldNotLoad) => {
      stop();
      fsEngine.run = null;
      console.error('Fontspector:', error);
      setFontspectorStatus(
        couldNotLoad
          ? "Fontspector couldn't start (" + error + '). If you opened index.html straight from disk, serve the folder over http instead (see the README) — or paste a report below.'
          : 'Fontspector stopped with an error: ' + error + ' — you can still paste a report below.',
        'error'
      );
      openPasteFallback();
    };

    run.ticker = setInterval(refresh, 1000);
    refresh();
    worker.postMessage({ type: 'run', runId: run.id, profile: 'googlefonts', files: files });
  }

  function renderFontSummary(names) {
    const box = document.getElementById('font-summary');
    box.innerHTML = '';
    const f = state.font;
    box.hidden = !f;
    if (!f) return;
    const cov = FontInfo.coverage(f);
    const facts = [
      describeFiles(names),
      cov.chars + ' characters',
      cov.scripts.length ? cov.scripts.map((sc) => sc.name + ' (' + sc.count + ')').join(', ') : 'no script with 10 characters or more',
      f.variable ? 'variable: ' + f.axes.join(', ') : 'static'
    ];
    const title = document.createElement('p');
    title.className = 'font-summary__title';
    title.textContent = f.family || 'Fonts read';
    box.appendChild(title);
    const p = document.createElement('p');
    p.className = 'font-summary__facts';
    p.textContent = facts.join(' · ');
    box.appendChild(p);
    const sup = f.support;
    if (sup) {
      const sets = supportedSets(sup);
      if (sets.length) {
        const gs = document.createElement('p');
        gs.className = 'font-summary__facts';
        gs.textContent = 'Glyphsets: ' + sets.map((g) => g.label + ' ' + (g.missing.length ? Math.floor(g.have / g.total * 100) + ' %' : '✓')).join(' · ');
        box.appendChild(gs);
      }
      const scripts = Object.entries(sup.byScript).sort((a, b) => b[1].length - a[1].length);
      const total = scripts.reduce((n, [, l]) => n + l.length, 0);
      if (total) {
        const ls = document.createElement('p');
        ls.className = 'font-summary__facts';
        const SCRIPT_NAMES = { Latn: 'Latin', Cyrl: 'Cyrillic', Grek: 'Greek', Arab: 'Arabic', Hebr: 'Hebrew', Armn: 'Armenian', Geor: 'Georgian', Deva: 'Devanagari' };
        ls.textContent = 'Languages (all their letters in the font): ' + total + ' — ' +
          scripts.map(([sc, l]) => (SCRIPT_NAMES[sc] || sc) + ' ' + l.length).join(', ') +
          (sup.languages.has('vi_Latn') ? ', Vietnamese included' : '');
        box.appendChild(ls);
      }
    }
    const absent = state.problems.filter((pr) => !problemApplies(pr));
    if (absent.length) {
      const n = document.createElement('p');
      n.className = 'font-summary__note';
      n.textContent = 'Set aside because the font doesn\'t have them: ' + absent.map((pr) => pr.label.toLowerCase()).join(', ') + ' — and their links.';
      box.appendChild(n);
    }
  }

  // data/check-rules.json: "checks" are check ids, with * standing for anything.
  function ruleFor(checkId) {
    return Compact.ruleFor(state.checkRules, checkId);
  }

  // The problem a check belongs to, and the resources to fix it.
  function fixFor(checkId) {
    const rule = ruleFor(checkId);
    if (!rule) return { problem: null, links: [] };
    const links = (rule.links || []).map((id) => state.linksDb.find((l) => l.id === id)).filter(Boolean)
      .map((l) => ({ id: l.id, title: l.title, url: l.url }));
    return { problem: rule.problem || null, links: links };
  }

  // problem id -> the failing or warning checks that belong to it
  function computeDetected() {
    const out = {};
    const failing = {};
    state.fontspectorChecks.forEach((c) => {
      if (!c.problem) return;
      out[c.problem] = out[c.problem] || [];
      if (!out[c.problem].includes(c.id)) out[c.problem].push(c.id);
      if (['FAIL', 'ERROR', 'FATAL'].includes(c.status)) {
        failing[c.problem] = failing[c.problem] || [];
        if (!failing[c.problem].includes(c.id)) failing[c.problem].push(c.id);
      }
    });
    state.detected = out;
    state.failing = failing;
    if (state.font) applySuggestions(true);
    else renderProblems();
  }

  function withFix(c) {
    const fix = fixFor(c.id);
    return Object.assign(c, { problem: fix.problem, fixLinks: fix.links });
  }

  function onFontspectorEngineResults(msg, names) {
    const parsed = Fontspector.fromCheckResults(msg.results);
    const relevant = parsed.checks.filter((c) => CHECKABLE_STATUSES.includes(c.status));
    state.fontspectorChecks = relevant.map((c, i) => ({
      key: 'fs-' + i,
      status: c.status,
      id: c.id,
      title: c.title,
      filename: names.length > 1 ? c.filename : null,
      message: c.message,
      included: false,
      comment: ''
    })).map(withFix);
    state.fontspectorCounts = parsed.counts;
    computeDetected();
    state.fontspectorMeta = {
      source: 'engine',
      version: msg.version,
      profile: 'googlefonts',
      files: names
    };

    // The engine reads the family name from the font itself — use it as the
    // project name, unless one was already typed in.
    const projectField = document.getElementById('meta-project');
    if (msg.familyName && projectField && !projectField.value.trim()) {
      projectField.value = msg.familyName;
    }

    setFontspectorStatus(
      'Checked ' + describeFiles(names) + ' — Fontspector ' + msg.version + ', Google Fonts profile.' +
      (relevant.length ? ' ' + relevant.length + ' fails and warnings, in step 4' + (detectedProblems().length ? '; the problems they point to are marked in step 2.' : '.') : ' No FAIL, WARN or FATAL: nothing to prioritize.'),
      'done'
    );
    renderFontspectorChecks();
  }

  function onParseFontspectorReport() {
    const raw = document.getElementById('fontspector-paste').value.trim();
    if (!raw) {
      showToast('Paste a Fontspector report first — JSON, markdown, or plain text all work.');
      return;
    }

    let parsed;
    try {
      parsed = Fontspector.parseReport(raw);
    } catch (err) {
      console.error(err);
      showToast('Could not read this report — see the console.');
      return;
    }

    const relevant = parsed.checks.filter((c) => CHECKABLE_STATUSES.includes(c.status));
    state.fontspectorChecks = relevant.map((c, i) => ({
      key: 'fs-' + i,
      status: c.status,
      id: c.id,
      title: '',
      filename: null,
      message: c.message,
      included: false,
      comment: ''
    })).map(withFix);
    state.fontspectorCounts = parsed.counts;
    state.fontspectorMeta = { source: 'paste' };
    computeDetected();

    if (parsed.looksLikeSummaryOnly) {
      showToast("That looks like just the summary counts table — scroll to the individual check results below it in your report (each with its own ID and message) and paste those instead.");
    } else if (!parsed.checks.length) {
      showToast("Couldn't find any check results in this — paste more of the report, or see js/fontspector.js if the format looks right to you.");
    } else if (!relevant.length) {
      showToast('No FAIL, WARN, or FATAL in this report — nothing to prioritize.');
    }

    renderFontspectorChecks();
  }

  function renderFontspectorChecks() {
    const summaryBox = document.getElementById('fontspector-summary');
    const summaryTitle = document.getElementById('fontspector-summary-title');
    const summaryCounts = document.getElementById('fontspector-summary-counts');
    const list = document.getElementById('fontspector-checks');
    list.innerHTML = '';
    document.getElementById('fontspector-empty-hint').hidden = !!state.fontspectorCounts;

    if (!state.fontspectorCounts) {
      summaryBox.classList.remove('is-visible');
      return;
    }

    const total = Object.values(state.fontspectorCounts).reduce((a, b) => a + b, 0);
    summaryTitle.textContent = total
      ? total + ' results found'
      : "Parsed, but no results were recognized in this text.";

    summaryCounts.innerHTML = '';
    Fontspector.STATUS_ORDER.forEach((status) => {
      const n = state.fontspectorCounts[status];
      if (!n) return;
      const el = document.createElement('span');
      el.className = 'status-count';
      el.innerHTML = '<span class="status-dot status-dot--' + status.toLowerCase() + '"></span>' + n + ' ' + status;
      summaryCounts.appendChild(el);
    });
    summaryBox.classList.add('is-visible');

    CHECKABLE_STATUSES.forEach((status) => {
      const items = state.fontspectorChecks.filter((c) => c.status === status);
      if (!items.length) return;
      const heading = document.createElement('p');
      heading.className = 'problem-group__title';
      heading.textContent = CHECKABLE_STATUS_LABEL[status] + ' (' + items.length + ')';
      list.appendChild(heading);
      items.forEach((check) => list.appendChild(renderFontspectorCheckRow(check)));
    });
  }

  // Little header inside every comment bubble (Fontspector checks and
  // screenshots), so a comment reads the same here as in the report.
  function commentBubbleLabel() {
    const label = document.createElement('span');
    label.className = 'comment-bubble__label';
    label.textContent = 'Comment';
    return label;
  }

  function renderFontspectorCheckRow(check) {
    const row = document.createElement('label');
    row.className = 'check-row check-row--' + check.status.toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = check.included;
    checkbox.addEventListener('change', () => { check.included = checkbox.checked; });

    const body = document.createElement('div');
    body.className = 'check-row__body';

    const head = document.createElement('div');
    head.className = 'check-row__head';
    const badge = document.createElement('span');
    badge.className = 'check-badge check-badge--' + check.status.toLowerCase();
    badge.textContent = check.status;
    head.appendChild(badge);
    const idEl = document.createElement('span');
    idEl.className = 'check-row__id';
    idEl.textContent = check.id + (check.filename ? '  ·  ' + check.filename : '');
    head.appendChild(idEl);

    const commentToggle = document.createElement('button');
    commentToggle.type = 'button';
    commentToggle.className = 'btn btn--ghost check-row__comment-toggle';
    head.appendChild(commentToggle);

    body.appendChild(head);

    if (check.title) {
      const titleEl = document.createElement('p');
      titleEl.className = 'check-row__title';
      titleEl.textContent = check.title;
      body.appendChild(titleEl);
    }

    if (check.message) {
      const msg = document.createElement('p');
      msg.className = 'check-row__message';
      msg.textContent = check.message;
      body.appendChild(msg);

      // Long messages (lists of glyphs, tables…) are clamped to a few lines,
      // with a toggle to read the rest — without touching the checkbox.
      if (check.message.length > 260 || check.message.split('\n').length > 4) {
        msg.classList.add('is-clamped');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'check-row__more';
        more.textContent = 'Show full message';
        more.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const clamped = msg.classList.toggle('is-clamped');
          more.textContent = clamped ? 'Show full message' : 'Show less';
        });
        body.appendChild(more);
      }
    }

    if (check.problem || (check.fixLinks || []).length) {
      const fix = document.createElement('p');
      fix.className = 'check-row__fix';
      const prob = state.problems.find((p) => p.id === check.problem);
      if (prob) {
        const tag = document.createElement('span');
        tag.className = 'check-row__problem cat-' + slugifyCategory(prob.category);
        tag.textContent = prob.label;
        fix.appendChild(tag);
      }
      if ((check.fixLinks || []).length) {
        fix.appendChild(document.createTextNode('How to fix: '));
        check.fixLinks.forEach((l, i) => {
          if (i) fix.appendChild(document.createTextNode(' · '));
          const a = document.createElement('a');
          a.href = l.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = l.title;
          a.addEventListener('click', (e) => e.stopPropagation());
          fix.appendChild(a);
        });
      }
      body.appendChild(fix);
    }

    // Hidden by default — the button below reveals it. Clicks inside this
    // whole block stop propagation so typing a comment (or just opening the
    // field) never accidentally toggles the row's own include checkbox,
    // since the row itself is a clickable <label>.
    const commentWrap = document.createElement('div');
    commentWrap.className = 'check-row__comment-field comment-bubble';
    commentWrap.addEventListener('click', (e) => e.stopPropagation());
    commentWrap.appendChild(commentBubbleLabel());

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Add a note for this check — appears in the comment and the report, right under it. Markdown works.';
    textarea.value = check.comment || '';
    commentWrap.appendChild(textarea);
    body.appendChild(commentWrap);

    function updateToggleLabel() {
      commentToggle.textContent = textarea.value.trim() ? 'Comment ✓' : 'Comment';
    }
    updateToggleLabel();
    if (check.comment) commentWrap.classList.add('is-visible');

    textarea.addEventListener('input', () => {
      check.comment = textarea.value;
      updateToggleLabel();
    });

    commentToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nowVisible = commentWrap.classList.toggle('is-visible');
      if (nowVisible) textarea.focus();
    });

    row.appendChild(checkbox);
    row.appendChild(body);
    return row;
  }

  /* ------------------------------- Step 5: screenshots ---------------------------- */

  // Files are read in parallel but added in the order they were picked.
  async function onScreenshotFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => {
      if (file.type && file.type.indexOf('image/') === 0) return true;
      showToast(file.name + ' is not an image — skipped.');
      return false;
    });
    const read = (file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => { showToast("Couldn't read " + file.name + '.'); resolve(null); };
      reader.readAsDataURL(file);
    });
    const urls = await Promise.all(files.map(read));
    files.forEach((file, i) => {
      if (!urls[i]) return;
      state.screenshots.push({
        id: 'shot-' + (screenshotIdCounter++),
        dataUrl: urls[i],
        filename: file.name,
        comment: '',
        problem: null,
        marks: []
      });
    });
    if (files.length) renderScreenshots();
  }

  function renderScreenshots() {
    const container = document.getElementById('screenshots-list');
    const emptyHint = document.getElementById('screenshots-empty-hint');
    container.innerHTML = '';
    state.screenshots.forEach((shot) => container.appendChild(renderScreenshotCard(shot)));
    emptyHint.style.display = state.screenshots.length ? 'none' : 'block';
    markStale();
  }

  // Options = the problems checked in step 1. A screenshot linked to a
  // problem that gets unchecked shows "not linked" (and is treated so),
  // but remembers its link in case the problem is checked again.
  function fillIssueSelect(select, shot) {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = state.selectedProblemIds.size ? '— Not linked to an issue' : '— Check problems in step 2 first';
    select.appendChild(none);
    state.problems.filter((p) => state.selectedProblemIds.has(p.id)).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      select.appendChild(opt);
    });
    select.value = shot.problem && state.selectedProblemIds.has(shot.problem) ? shot.problem : '';
    select.disabled = !state.selectedProblemIds.size;
  }

  function refreshScreenshotIssueSelects() {
    document.querySelectorAll('#screenshots-list select[data-shot-id]').forEach((select) => {
      const shot = state.screenshots.find((s) => s.id === select.dataset.shotId);
      if (shot) fillIssueSelect(select, shot);
    });
  }

  function renderScreenshotCard(shot) {
    const card = document.createElement('div');
    card.className = 'screenshot-card';

    const media = document.createElement('div');
    media.className = 'screenshot-card__media';
    const img = document.createElement('img');
    img.src = shot.dataUrl;
    img.alt = shot.filename;
    img.className = 'screenshot-card__img';
    media.appendChild(img);
    const layer = markerLayer(shot);
    media.appendChild(layer);
    img.addEventListener('load', () => sizeLayer(layer, img));
    media.addEventListener('click', () => openMarkerEditor(shot));
    media.title = 'Mark the problem on this image';
    card.appendChild(media);

    const body = document.createElement('div');
    body.className = 'screenshot-card__body';

    const name = document.createElement('p');
    name.className = 'screenshot-card__filename';
    name.textContent = shot.filename;
    body.appendChild(name);

    // Which checked problem this screenshot illustrates: the GitHub checklist
    // then says "(see the screenshots in the full report)" on that item.
    const issueField = document.createElement('label');
    issueField.className = 'screenshot-card__issue';
    const issueLabel = document.createElement('span');
    issueLabel.textContent = 'Linked issue';
    issueField.appendChild(issueLabel);
    const select = document.createElement('select');
    select.dataset.shotId = shot.id;
    select.addEventListener('change', () => { shot.problem = select.value || null; });
    fillIssueSelect(select, shot);
    issueField.appendChild(select);
    body.appendChild(issueField);

    const bubble = document.createElement('div');
    bubble.className = 'comment-bubble';
    bubble.appendChild(commentBubbleLabel());
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Comment on this screenshot — appears in the comment and the report, right under the image.';
    textarea.value = shot.comment;
    textarea.dataset.shotId = shot.id;
    textarea.addEventListener('input', () => { shot.comment = textarea.value; });
    bubble.appendChild(textarea);
    body.appendChild(bubble);

    const actions = document.createElement('div');
    actions.className = 'screenshot-card__actions';
    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className = 'btn btn--secondary';
    markBtn.textContent = shot.marks.length ? 'Mark the problem (' + shot.marks.length + ')' : 'Mark the problem';
    markBtn.addEventListener('click', () => openMarkerEditor(shot));
    actions.appendChild(markBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--danger-ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.screenshots = state.screenshots.filter((s) => s.id !== shot.id);
      renderScreenshots();
    });
    actions.appendChild(removeBtn);
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  /* ---------------------------- Screenshot markers (dots) ------------------------- */
  /* Translucent coloured dots put on a screenshot to show where the problem
     is. Kept as { x, y, r, color } with x, y, r as fractions of the image
     (r of its shorter side), drawn over the image here and burnt into the
     image when the report is generated. */

  const MARK_COLORS = [
    { name: 'Red', value: '#EA4335' },
    { name: 'Yellow', value: '#FBBC04' },
    { name: 'Green', value: '#34A853' },
    { name: 'Blue', value: '#4285F4' },
    { name: 'Purple', value: '#A142F4' }
  ];
  const SVGNS = 'http://www.w3.org/2000/svg';
  const markerUi = { shot: null, color: MARK_COLORS[0].value, size: 6, history: [] };

  function markerLayer(shot) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'marker-layer');
    svg.setAttribute('aria-hidden', 'true');
    svg.dataset.shotId = shot.id;
    drawMarks(svg, shot, 1, 1);
    return svg;
  }

  // The thumbnail is letterboxed (object-fit: contain): place the dots over the image itself.
  function sizeLayer(svg, img) {
    const box = img.getBoundingClientRect();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h || !box.width) return;
    const k = Math.min(box.width / w, box.height / h);
    const dw = w * k, dh = h * k;
    Object.assign(svg.style, { left: ((box.width - dw) / 2) + 'px', top: ((box.height - dh) / 2) + 'px', width: dw + 'px', height: dh + 'px' });
    const shot = state.screenshots.find((s) => s.id === svg.dataset.shotId);
    if (shot) drawMarks(svg, shot, w, h);
  }

  function drawMarks(svg, shot, w, h) {
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const side = Math.min(w, h);
    shot.marks.forEach((m, i) => {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', m.x * w);
      c.setAttribute('cy', m.y * h);
      c.setAttribute('r', m.r * side);
      c.setAttribute('fill', m.color);
      c.setAttribute('fill-opacity', '0.35');
      c.setAttribute('stroke', m.color);
      c.setAttribute('stroke-width', Math.max(1.5, m.r * side * 0.12));
      c.dataset.index = i;
      svg.appendChild(c);
    });
  }

  function refreshMarkerEditor() {
    const img = document.getElementById('marker-img');
    const svg = document.getElementById('marker-svg');
    drawMarks(svg, markerUi.shot, img.naturalWidth || 1, img.naturalHeight || 1);
  }

  function openMarkerEditor(shot) {
    markerUi.shot = shot;
    markerUi.history = [];
    const editor = document.getElementById('marker-editor');
    const img = document.getElementById('marker-img');
    img.onload = refreshMarkerEditor;
    img.src = shot.dataUrl;
    img.alt = shot.filename;
    document.getElementById('marker-editor-title').textContent = 'Mark the problem — ' + shot.filename;
    editor.hidden = false;
    document.body.classList.add('has-modal');
    if (img.complete) refreshMarkerEditor();
    document.getElementById('marker-done').focus();
  }

  function closeMarkerEditor() {
    document.getElementById('marker-editor').hidden = true;
    document.body.classList.remove('has-modal');
    markerUi.shot = null;
    renderScreenshots();
  }

  function setupMarkerEditor() {
    const colors = document.getElementById('marker-colors');
    MARK_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'marker-swatch';
      b.style.setProperty('--swatch', c.value);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-checked', String(i === 0));
      b.addEventListener('click', () => {
        markerUi.color = c.value;
        colors.querySelectorAll('.marker-swatch').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      });
      colors.appendChild(b);
    });
    const size = document.getElementById('marker-size');
    size.addEventListener('input', () => { markerUi.size = +size.value; });

    const svg = document.getElementById('marker-svg');
    const img = document.getElementById('marker-img');
    const point = (e) => {
      const box = svg.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) };
    };
    const save = () => markerUi.history.push(JSON.stringify(markerUi.shot.marks));
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (!markerUi.shot || e.button !== 0) return;
      e.preventDefault();
      const target = e.target.closest('circle');
      save();
      if (target) {
        const m = markerUi.shot.marks[+target.dataset.index];
        const p = point(e);
        drag = { m: m, dx: m.x - p.x, dy: m.y - p.y, moved: false };
      } else {
        const p = point(e);
        const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
        const r = markerUi.size / 100;
        markerUi.shot.marks.push({ x: p.x, y: p.y, r: r, color: markerUi.color });
        drag = { m: markerUi.shot.marks[markerUi.shot.marks.length - 1], dx: 0, dy: 0, moved: true, added: true, w: w, h: h };
      }
      svg.setPointerCapture(e.pointerId);
      refreshMarkerEditor();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = point(e);
      drag.m.x = Math.min(1, Math.max(0, p.x + drag.dx));
      drag.m.y = Math.min(1, Math.max(0, p.y + drag.dy));
      drag.moved = true;
      refreshMarkerEditor();
    });
    const end = () => {
      if (drag && !drag.moved && !drag.added) markerUi.history.pop(); // a plain click on a dot changes nothing
      drag = null;
      markStale();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    const removeAt = (e) => {
      const target = e.target.closest('circle');
      if (!target || !markerUi.shot) return;
      e.preventDefault();
      save();
      markerUi.shot.marks.splice(+target.dataset.index, 1);
      refreshMarkerEditor();
      markStale();
    };
    svg.addEventListener('dblclick', removeAt);
    svg.addEventListener('contextmenu', removeAt);

    document.getElementById('marker-undo').addEventListener('click', () => {
      if (!markerUi.shot || !markerUi.history.length) return;
      markerUi.shot.marks = JSON.parse(markerUi.history.pop());
      refreshMarkerEditor();
      markStale();
    });
    document.getElementById('marker-clear').addEventListener('click', () => {
      if (!markerUi.shot || !markerUi.shot.marks.length) return;
      save();
      markerUi.shot.marks = [];
      refreshMarkerEditor();
      markStale();
    });
    document.getElementById('marker-done').addEventListener('click', closeMarkerEditor);
    document.getElementById('marker-editor').addEventListener('click', (e) => { if (e.target.id === 'marker-editor') closeMarkerEditor(); });
    document.addEventListener('keydown', (e) => {
      if (!markerUi.shot) return;
      if (e.key === 'Escape') closeMarkerEditor();
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); document.getElementById('marker-undo').click(); }
    });
    window.addEventListener('resize', () => {
      document.querySelectorAll('.screenshot-card__media').forEach((m) => sizeLayer(m.querySelector('svg'), m.querySelector('img')));
    });
  }

  /* --------------------------------- Step 6: generate ----------------------------- */
  /* Builds the "report" object (format described at the top of
     js/github-comment.js) and the Markdown checklist around the report link.
     GitHub only makes a link clickable up to about 4,096 characters, so the
     link holds references, not the report itself (js/compact.js), and the
     screenshots go into the GitHub comment, where GitHub hosts them: the
     tool hands them over as image files, with their dots drawn in. */

  const EXPORT_MAX_SIDE = 2000;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not decode the image'));
      img.src = src;
    });
  }

  function shotFileName(index) {
    return 'screenshot-' + (index + 1) + '.png';
  }

  // The screenshot as a PNG, at most EXPORT_MAX_SIDE px, with its dots.
  async function exportShot(shot) {
    const img = await loadImage(shot.dataUrl);
    const w = img.naturalWidth;
    const hgt = img.naturalHeight;
    const scale = Math.min(1, EXPORT_MAX_SIDE / Math.max(w, hgt));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(hgt * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const side = Math.min(canvas.width, canvas.height);
    (shot.marks || []).forEach((m) => {
      const r = m.r * side;
      ctx.beginPath();
      ctx.arc(m.x * canvas.width, m.y * canvas.height, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.strokeStyle = m.color;
      ctx.stroke();
    });
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function fieldValue(id) {
    return document.getElementById(id).value.trim();
  }

  async function buildReport() {
    if (state.selectedProblemIds.size && state.linksComputedFor !== selectionKey()) refreshLinks();

    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const isIncluded = (kind, id) => state.included[includedKey(kind, id)] !== false;

    const tutorials = [];
    for (const tut of state.autoTutorials.filter((t) => isIncluded('tutorial', t.id))) {
      try {
        const res = await fetch(tut.path);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        tutorials.push({ id: tut.id, title: tut.title, markdown: await res.text() });
      } catch (err) {
        console.error('Could not load tutorial ' + tut.path, err);
        showToast('Could not load "' + tut.title + '" (' + tut.path + ') — skipped.');
      }
    }
    const loadedTutorials = new Set(tutorials.map((t) => t.id));

    const problems = selected.map((problem) => ({
      id: problem.id,
      label: problem.label,
      action: problem.action || '',
      category: problem.category,
      tutorials: state.autoTutorials
        .filter((t) => t.matchedProblemIds.includes(problem.id) && loadedTutorials.has(t.id))
        .map((t) => t.id),
      links: state.autoLinks
        .filter((l) => l.matchedProblemIds.includes(problem.id) && isIncluded('link', l.id))
        .map((l) => ({ id: l.id, title: l.title, url: l.url, explanation: l.explanation || '' }))
    }));

    const manual = state.manualLinks.filter((l) => isIncluded('link', l.id));
    if (manual.length) {
      problems.push({
        id: null,
        manual: true,
        label: 'Additional resources',
        category: '',
        tutorials: [],
        links: manual.map((l) => ({ id: null, title: l.title, url: l.url, explanation: l.explanation || '' }))
      });
    }

    const picked = state.fontspectorChecks.filter((c) => c.included);
    const meta = state.fontspectorMeta || {};
    const fontspector = picked.length ? {
      source: meta.source || null,
      version: meta.version || null,
      profile: meta.profile || null,
      files: meta.files || [],
      counts: state.fontspectorCounts || null,
      checks: picked.map((c) => ({
        status: c.status,
        id: c.id,
        title: c.title || '',
        filename: c.filename || null,
        message: c.message || '',
        comment: (c.comment || '').trim(),
        problem: c.problem || null,
        links: (c.fixLinks || []).map((l) => ({ title: l.title, url: l.url }))
      }))
    } : null;

    return {
      app: 'typo-guide-generator',
      v: 1,
      title: fieldValue('meta-title') || 'Typography review',
      author: fieldValue('meta-reviewer-name'),   // urlHosted's name for it
      date: new Date().toISOString(),            // urlHosted keeps one too
      project: fieldValue('meta-project'),
      designer: fieldValue('meta-designer'),
      notes: fieldValue('meta-notes'),
      contact: fieldValue('meta-reviewer-contact'),
      problems: problems,
      tutorials: tutorials,
      fontspector: fontspector,
      screenshots: []
    };
  }

  async function fitToComment(report) {
    const publicBase = TypoConfig.publicBaseUrl();
    const reportPage = publicBase + 'report.html';
    const linked = (shot) => (shot.problem && state.selectedProblemIds.has(shot.problem) ? shot.problem : null);
    const full = Object.assign({}, report, {
      screenshots: state.screenshots.map((s, i) => ({ name: shotFileName(i), comment: (s.comment || '').trim(), problem: linked(s), src: '', omitted: true, inComment: true }))
    });
    // the most detailed version of the link that GitHub still makes clickable
    let best = null;
    for (let level = 0; level < Compact.LEVELS; level++) {
      const payload = await UrlHosted.serialize(Compact.pack(full, level));
      const link = UrlHosted.makeLink(reportPage, payload);
      best = { payload: payload, link: link, level: level };
      if (link.length <= TypoConfig.LINK_LIMIT) break;
    }
    const markdown = GitHubComment.build(full, { reportUrl: best.link, baseUrl: publicBase });
    return {
      report: full, payload: best.payload, link: best.link, markdown: markdown, length: markdown.length,
      linkLevel: best.level, linkFits: best.link.length <= TypoConfig.LINK_LIMIT, fits: markdown.length <= TypoConfig.COMMENT_BUDGET
    };
  }

  async function onGenerate() {
    const hasProblem = state.selectedProblemIds.size > 0;
    const hasManual = state.manualLinks.some((l) => state.included[includedKey('link', l.id)] !== false);
    const hasFontspectorSelection = state.fontspectorChecks.some((c) => c.included);
    if (!hasProblem && !hasManual && !state.screenshots.length && !hasFontspectorSelection) {
      showToast('Select a problem, tick a Fontspector check, or add a screenshot before generating.');
      return;
    }
    if (!UrlHosted.supported()) {
      showToast('This browser is too old to build the report link — use a recent Chrome, Firefox, Edge or Safari.');
      return;
    }

    const btn = document.getElementById('btn-generate');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating…';

    try {
      const report = await buildReport();
      const result = await fitToComment(report);
      state.lastOutput = result;
      renderOutput(result);
    } catch (err) {
      console.error(err);
      showToast('Error while generating the comment — ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function formatNumber(n) { return Number(n).toLocaleString('en-US'); }

  // The comment on screen no longer matches the form.
  function markStale() {
    if (state.lastOutput) document.getElementById('output-stale').hidden = false;
  }

  function renderOutput(result) {
    const panel = document.getElementById('output-panel');
    panel.hidden = false;
    document.getElementById('output-stale').hidden = true;

    document.getElementById('comment-markdown').value = result.markdown;
    document.getElementById('output-edited').hidden = true;
    renderCommentPreview();
    updateMeter();

    const notes = [];
    const linkLen = formatNumber(result.link.length) + ' characters';
    if (!result.linkFits) {
      notes.push({ kind: 'warn', text: 'The report link is ' + linkLen + ': GitHub only makes links clickable up to about 4,000. Untick some links or Fontspector checks (or shorten their comments) and generate again.' });
    } else if (result.linkLevel > 0) {
      notes.push({ kind: 'info', text: 'The report link is ' + linkLen + ', under GitHub’s limit of about 4,000 for a clickable link: to fit, the Fontspector messages are ' + (result.linkLevel === 1 ? 'shortened' : 'left out') + ' in the report (the checks, their titles and your comments are all there).' });
    } else {
      notes.push({ kind: 'info', text: 'The report link is ' + linkLen + ', under GitHub’s limit of about 4,000 for a clickable link.' });
    }
    if (!result.fits) {
      notes.push({ kind: 'warn', text: 'This comment is longer than GitHub accepts. Shorten the comments and generate again.' });
    }
    if (TypoConfig.isLocal()) {
      notes.push({ kind: 'info', text: 'You are running the tool locally, so the links in the comment point to the published site (' + TypoConfig.PUBLIC_SITE_URL + '): push this version to GitHub first, so report.html exists there. “Open the full report” below uses your local copy.' });
    }
    const list = document.getElementById('output-notes');
    list.innerHTML = '';
    notes.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'output-note output-note--' + n.kind;
      li.textContent = n.text;
      list.appendChild(li);
    });

    document.getElementById('btn-open-report').href = UrlHosted.makeLink(TypoConfig.currentBaseUrl() + 'report.html', result.payload);
    renderShotsExport();

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The screenshots, as files to drag into the GitHub comment.
  const exportUrls = [];
  async function renderShotsExport() {
    const box = document.getElementById('shots-export');
    const list = document.getElementById('shots-export-list');
    exportUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    list.innerHTML = '';
    box.hidden = !state.screenshots.length;
    for (const [i, shot] of state.screenshots.entries()) {
      let blob = null;
      try { blob = await exportShot(shot); } catch (err) { console.error(err); }
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      exportUrls.push(url);
      const a = document.createElement('a');
      a.className = 'shots-export__item';
      a.href = url;
      a.download = shotFileName(i);
      const img = document.createElement('img');
      img.src = url;
      img.alt = shotFileName(i);
      const cap = document.createElement('span');
      cap.textContent = shotFileName(i);
      a.appendChild(img);
      a.appendChild(cap);
      list.appendChild(a);
    }
  }

  async function downloadAllShots() {
    const items = Array.from(document.querySelectorAll('#shots-export-list a'));
    for (const a of items) {
      a.click();
      await new Promise((r) => setTimeout(r, 350)); // browsers drop downloads fired all at once
    }
  }

  // The comment as it will be copied: the generated Markdown, or the
  // reviewer's edits of it in the Markdown tab.
  function currentComment() {
    return document.getElementById('comment-markdown').value;
  }

  function renderCommentPreview() {
    const preview = document.getElementById('comment-preview');
    preview.innerHTML = '';
    preview.appendChild(Markdown.render(currentComment(), { breaks: true, linkTarget: '_blank' }));
  }

  function updateMeter() {
    if (!state.lastOutput) return;
    const length = currentComment().length;
    const limit = TypoConfig.GITHUB_COMMENT_LIMIT;
    const ratio = Math.min(1, length / limit);
    document.getElementById('size-meter-fill').style.width = (ratio * 100).toFixed(1) + '%';
    document.getElementById('size-meter').className = 'size-meter size-meter--' + (length <= TypoConfig.COMMENT_BUDGET ? 'ok' : 'over');
    document.getElementById('size-meter-text').textContent =
      formatNumber(length) + ' / ' + formatNumber(limit) + ' characters (GitHub’s limit for a comment) — the report link takes ' +
      formatNumber(state.lastOutput.link.length) + ' of them.';
  }

  function setOutputTab(which) {
    const isPreview = which === 'preview';
    const tabPreview = document.getElementById('tab-preview');
    const tabMarkdown = document.getElementById('tab-markdown');
    tabPreview.classList.toggle('is-active', isPreview);
    tabMarkdown.classList.toggle('is-active', !isPreview);
    tabPreview.setAttribute('aria-selected', String(isPreview));
    tabMarkdown.setAttribute('aria-selected', String(!isPreview));
    if (isPreview) renderCommentPreview();
    document.getElementById('comment-preview').hidden = !isPreview;
    document.getElementById('comment-markdown').hidden = isPreview;
    document.getElementById('output-edit-hint').hidden = isPreview;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ----------------------------- Opening a report link ---------------------------- */
  /* index.html#?<payload> — the "Edit in the generator" button of the report
     page — puts a report back into the form, ready to change and generate
     again. Like urlHosted, the old link is dropped from the address bar as
     soon as something changes, since it no longer matches what's on screen. */

  async function restoreFromLink() {
    const payload = UrlHosted.payloadFromHash(window.location.hash);
    if (!payload) return;
    let report;
    try {
      report = await UrlHosted.deserialize(payload);
    } catch (err) {
      console.error(err);
      showToast("The report in this link couldn't be read — it was probably cut off when copied.");
      return;
    }
    if (!report || report.app !== 'typo-guide-generator') return;
    if (report.v === 2) {
      report = await Compact.unpack(report, { problems: state.problems, links: state.linksDb, tutorials: state.tutorialsDb, rules: state.checkRules }, false);
    }

    const dropped = applyReport(report);
    showToast('Report loaded from the link — change anything, then generate again.' +
      (dropped ? ' (' + dropped + ')' : ''));

    const forget = () => {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      document.removeEventListener('input', forget, true);
      document.removeEventListener('change', forget, true);
    };
    document.addEventListener('input', forget, true);
    document.addEventListener('change', forget, true);
  }

  function applyReport(r) {
    const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    const arr = (v) => (Array.isArray(v) ? v : []);
    const dropped = [];

    document.getElementById('meta-title').value = str(r.title) || 'Typography review';
    document.getElementById('meta-project').value = str(r.project);
    document.getElementById('meta-designer').value = str(r.designer);
    document.getElementById('meta-notes').value = str(r.notes);
    document.getElementById('meta-reviewer-name').value = str(r.author);
    document.getElementById('meta-reviewer-contact').value = str(r.contact);

    // Step 1 + 2: problems, then which of their links/tutorials were kept.
    const problems = arr(r.problems);
    const known = new Set(state.problems.map((p) => p.id));
    state.selectedProblemIds = new Set(problems.filter((p) => !p.manual && known.has(p.id)).map((p) => p.id));
    const unknown = problems.filter((p) => !p.manual && !known.has(p.id)).length;
    if (unknown) dropped.push(unknown + ' problem' + (unknown === 1 ? ' is' : 's are') + ' no longer in the list');
    renderProblems();

    if (state.selectedProblemIds.size) {
      state.autoLinks = computeAutoLinks();
      state.autoTutorials = computeAutoTutorials();
      state.linksComputedFor = selectionKey();
      const keptLinks = new Set();
      problems.forEach((p) => arr(p.links).forEach((l) => { if (l && l.id) keptLinks.add(l.id); }));
      const keptTutorials = new Set(arr(r.tutorials).map((t) => t && t.id));
      state.autoLinks.forEach((l) => { state.included[includedKey('link', l.id)] = keptLinks.has(l.id); });
      state.autoTutorials.forEach((t) => { state.included[includedKey('tutorial', t.id)] = keptTutorials.has(t.id); });
    }
    // Links added by hand, or gone from the database since: back as manual links.
    const autoIds = new Set(state.autoLinks.map((l) => l.id));
    const seen = new Set();
    problems.forEach((p) => arr(p.links).forEach((l) => {
      if (!l || !l.url) return;
      if (!p.manual && l.id && autoIds.has(l.id)) return;
      if (seen.has(l.url)) return;
      seen.add(l.url);
      const id = 'manual-' + (manualIdCounter++);
      state.manualLinks.push({ id: id, title: str(l.title) || str(l.url), url: str(l.url), explanation: str(l.explanation), tags: [] });
      state.included[includedKey('link', id)] = true;
    }));
    renderLinks();

    // Step 3: only the checks that were picked travel in the link.
    const fs = r.fontspector && typeof r.fontspector === 'object' ? r.fontspector : null;
    const checks = fs ? arr(fs.checks) : [];
    if (checks.length) {
      state.fontspectorChecks = checks.map((c, i) => ({
        key: 'fs-' + i,
        status: str(c.status).toUpperCase(),
        id: str(c.id),
        title: str(c.title),
        filename: c.filename ? str(c.filename) : null,
        message: str(c.message),
        included: true,
        comment: str(c.comment),
        problem: c.problem ? str(c.problem) : null,
        fixLinks: arr(c.links).filter((l) => l && /^https?:\/\//.test(str(l.url))).map((l) => ({ title: str(l.title) || str(l.url), url: str(l.url) }))
      }));
      const counts = {};
      if (fs.counts && typeof fs.counts === 'object') {
        Object.keys(fs.counts).forEach((k) => { if (typeof fs.counts[k] === 'number') counts[k] = fs.counts[k]; });
      } else {
        state.fontspectorChecks.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
      }
      state.fontspectorCounts = counts;
      state.fontspectorMeta = { source: str(fs.source) || 'link', version: str(fs.version), profile: str(fs.profile), files: arr(fs.files).map(str) };
      renderFontspectorChecks();
      computeDetected();
      setFontspectorStatus('Loaded from the link: the ' + checks.length + ' check' + (checks.length === 1 ? '' : 's') +
        ' picked for this report. Drop the fonts again to re-run Fontspector and set aside what the font doesn\'t have.', 'done');
    }

    // Step 4: screenshots come back at the quality they had in the link.
    const shots = arr(r.screenshots);
    state.screenshots = shots
      .filter((s) => s && !s.omitted && /^data:image\/(png|jpeg|webp|gif);base64,/.test(str(s.src)))
      .map((s) => ({ id: 'shot-' + (screenshotIdCounter++), dataUrl: str(s.src), filename: str(s.name) || 'screenshot', comment: str(s.comment), problem: s.problem ? str(s.problem) : null, marks: [] }));
    const missing = shots.length - state.screenshots.length;
    if (missing) dropped.push(missing + ' screenshot' + (missing === 1 ? ' is' : 's are') + ' in the GitHub comment, not in the link: drop ' + (missing === 1 ? 'it' : 'them') + ' again');
    renderScreenshots();

    return dropped.join(', ');
  }

  /* ----------------------------------- Misc ---------------------------------------- */

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3600);
  }

  function bindStaticEvents() {
    setupMarkerEditor();
    // Any edit in steps 1–5 after generating makes the comment out of date.
    ['input', 'change'].forEach((type) => document.addEventListener(type, (e) => {
      if (!e.target.closest || e.target.closest('#output-panel')) return;
      if (e.target.closest('.section')) markStale();
    }));
    document.getElementById('btn-show-links').addEventListener('click', onShowLinks);
    document.getElementById('btn-add-manual-link').addEventListener('click', onAddManualLink);
    document.getElementById('btn-parse-fontspector').addEventListener('click', onParseFontspectorReport);

    const fontDropzone = document.getElementById('font-dropzone');
    const fontInput = document.getElementById('font-file-input');
    fontDropzone.addEventListener('click', () => fontInput.click());
    fontDropzone.addEventListener('dragover', (e) => { e.preventDefault(); fontDropzone.classList.add('is-dragover'); });
    fontDropzone.addEventListener('dragleave', () => fontDropzone.classList.remove('is-dragover'));
    fontDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      fontDropzone.classList.remove('is-dragover');
      onFontFiles(e.dataTransfer.files);
    });
    fontInput.addEventListener('click', (e) => e.stopPropagation());
    fontInput.addEventListener('change', () => {
      onFontFiles(fontInput.files);
      fontInput.value = '';
    });
    document.getElementById('btn-generate').addEventListener('click', onGenerate);
    document.getElementById('btn-download-shots').addEventListener('click', downloadAllShots);
    document.getElementById('tab-preview').addEventListener('click', () => setOutputTab('preview'));
    document.getElementById('tab-markdown').addEventListener('click', () => setOutputTab('markdown'));
    document.getElementById('comment-markdown').addEventListener('input', () => {
      document.getElementById('output-edited').hidden = currentComment() === state.lastOutput.markdown;
      updateMeter();
    });
    document.getElementById('btn-copy-markdown').addEventListener('click', async () => {
      if (!state.lastOutput) return;
      const ok = await copyText(currentComment());
      showToast(ok ? 'Comment copied — paste it on the GitHub issue.' : "Couldn't copy — select the Markdown tab and copy by hand.");
    });
    document.getElementById('btn-copy-link').addEventListener('click', async () => {
      if (!state.lastOutput) return;
      const ok = await copyText(state.lastOutput.link);
      showToast(ok ? 'Report link copied.' : "Couldn't copy the link.");
    });

    const dropzone = document.getElementById('screenshot-dropzone');
    const fileInput = document.getElementById('screenshot-file-input');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      onScreenshotFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
      onScreenshotFiles(fileInput.files);
      fileInput.value = '';
    });
  }
})();
