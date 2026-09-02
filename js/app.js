/* ==========================================================================
   Typo Guide Generator — app logic
   No data is ever sent to a server: everything happens in the browser
   (reading the repo's JSON files, reading the .ttf file, generating the PDF).
   ========================================================================== */

(function () {
  'use strict';

  const state = {
    problems: [],
    linksDb: [],
    explanationsDb: [],
    selectedProblemIds: new Set(),
    autoLinks: [],    // links computed from tags, flat list
    manualLinks: [],  // links added by hand for this session
    included: {},     // linkId -> bool (checked/unchecked, defaults to true)
    fontMeta: null,
    fontspectorReport: null, // output of Fontspector.parseReport(), annotated
    checkComments: {}        // 'STATUS-index' -> free-text comment
  };

  let manualIdCounter = 1;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const [problems, linksDb, explanationsDb] = await Promise.all([
        fetchJSON('data/problems.json'),
        fetchJSON('data/links-database.json'),
        fetchJSON('data/fontspector-explanations.json')
      ]);
      state.problems = problems;
      state.linksDb = linksDb;
      state.explanationsDb = explanationsDb;
    } catch (err) {
      showToast('Error loading data — ' + err.message);
      console.error(err);
      return;
    }
    renderProblems();
    bindStaticEvents();
  }

  function fetchJSON(path) {
    return fetch(path).then((res) => {
      if (!res.ok) throw new Error(path + ' not found (HTTP ' + res.status + ')');
      return res.json();
    });
  }

  /* ------------------------------ Step 1: problems ------------------------------ */

  function renderProblems() {
    const container = document.getElementById('problems-list');
    container.innerHTML = '';

    const categories = [];
    state.problems.forEach((p) => {
      if (!categories.includes(p.category)) categories.push(p.category);
    });

    categories.forEach((cat) => {
      const group = document.createElement('div');
      group.className = 'problem-group';

      const title = document.createElement('p');
      title.className = 'problem-group__title';
      title.textContent = cat;
      group.appendChild(title);

      state.problems
        .filter((p) => p.category === cat)
        .forEach((problem) => group.appendChild(renderProblemRow(problem)));

      container.appendChild(group);
    });
  }

  function renderProblemRow(problem) {
    const label = document.createElement('label');
    label.className = 'problem-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = problem.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedProblemIds.add(problem.id);
      else state.selectedProblemIds.delete(problem.id);
    });

    const body = document.createElement('div');
    body.className = 'problem-row__body';

    const lbl = document.createElement('span');
    lbl.className = 'problem-row__label';
    lbl.textContent = problem.label;
    body.appendChild(lbl);

    if (problem.description) {
      const desc = document.createElement('p');
      desc.className = 'problem-row__desc';
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

  /* -------------------------------- Step 2: links -------------------------------- */

  function computeAutoLinks() {
    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const matches = [];
    state.linksDb.forEach((link) => {
      const matchedProblemIds = selected
        .filter((p) => (link.tags || []).some((t) => (p.tags || []).includes(t)))
        .map((p) => p.id);
      if (matchedProblemIds.length) {
        matches.push(Object.assign({}, link, { matchedProblemIds: matchedProblemIds }));
      }
    });
    return matches;
  }

  function onShowLinks() {
    if (!state.selectedProblemIds.size) {
      showToast('Check at least one problem before showing links.');
      return;
    }
    state.autoLinks = computeAutoLinks();
    state.autoLinks.forEach((l) => {
      if (!(l.id in state.included)) state.included[l.id] = true;
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
      const linksForProblem = state.autoLinks.filter((l) => l.matchedProblemIds.includes(problem.id));
      if (!linksForProblem.length) return;
      anyRendered = true;
      container.appendChild(renderLinkGroup(problem.label, linksForProblem, false));
    });

    if (state.manualLinks.length) {
      anyRendered = true;
      container.appendChild(renderLinkGroup('Added manually', state.manualLinks, true));
    }

    if (anyRendered) {
      emptyHint.style.display = 'none';
    } else {
      emptyHint.style.display = 'block';
      emptyHint.textContent = state.autoLinks.length === 0 && state.selectedProblemIds.size
        ? "No link in the database matches this selection yet — add one manually below, or fill out data/links-database.json."
        : 'Check at least one problem in step 1, then click "Show links".';
    }
  }

  function renderLinkGroup(heading, links, isManualGroup) {
    const wrap = document.createElement('div');
    wrap.className = 'link-group';

    const h = document.createElement('p');
    h.className = 'problem-group__title';
    h.textContent = heading;
    wrap.appendChild(h);

    links.forEach((link) => wrap.appendChild(renderLinkRow(link, isManualGroup)));
    return wrap;
  }

  function renderLinkRow(link, isManual) {
    const row = document.createElement('div');
    row.className = 'link-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.included[link.id] !== false;
    checkbox.dataset.linkId = link.id;
    checkbox.addEventListener('change', () => {
      state.included[link.id] = checkbox.checked;
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
        delete state.included[link.id];
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
    state.included[id] = true;

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

  function slugify(str) {
    const s = String(str)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    return s || 'link';
  }

  /* ------------------------- Step 3: font + fontspector -------------------------- */

  function onFontFile(file) {
    if (!file) return;
    file.arrayBuffer().then((buffer) => {
      let font;
      try {
        font = opentype.parse(buffer);
      } catch (err) {
        showToast("This file couldn't be read as a valid font.");
        console.error(err);
        return;
      }
      const family = pickName(font.names.fontFamily) || pickName(font.names.preferredFamily) || file.name;
      const version = pickName(font.names.version) || '';
      state.fontMeta = { family: family, version: version, glyphCount: font.glyphs.length };

      document.getElementById('font-loaded-name').textContent = family;
      document.getElementById('font-loaded-meta').textContent =
        font.glyphs.length + ' glyphs' + (version ? ' — ' + version : '');
      document.getElementById('font-loaded').classList.add('is-visible');

      const projectInput = document.getElementById('meta-project');
      if (!projectInput.value) projectInput.value = family;
    }).catch((err) => {
      showToast('Could not read this file.');
      console.error(err);
    });
  }

  function pickName(nameRecord) {
    if (!nameRecord) return null;
    if (nameRecord.en) return nameRecord.en;
    const values = Object.values(nameRecord);
    return values.length ? values[0] : null;
  }

  function onFontspectorFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let json;
      try {
        json = JSON.parse(reader.result);
      } catch (err) {
        showToast('This file is not valid JSON.');
        return;
      }
      const parsed = Fontspector.parseReport(json);
      parsed.checks.forEach((c) => {
        const exp = Fontspector.findExplanation(c.id, state.explanationsDb);
        if (exp) {
          c.explanation = exp.explanation;
          c.explanationTitle = exp.title;
        }
      });
      state.fontspectorReport = parsed;
      state.checkComments = {};
      renderFontspector();
    };
    reader.readAsText(file);
  }

  function renderFontspector() {
    const fs = state.fontspectorReport;
    const statusBox = document.getElementById('report-status');
    const list = document.getElementById('check-list');
    list.innerHTML = '';

    if (!fs) {
      statusBox.classList.remove('is-visible');
      return;
    }

    const total = fs.checks.length;
    document.getElementById('report-status-title').textContent = total
      ? total + ' results detected in the report'
      : "The report was loaded, but its structure couldn't be automatically parsed.";

    const summary = document.getElementById('report-status-summary');
    summary.innerHTML = '';
    Fontspector.STATUS_ORDER.forEach((status) => {
      const n = fs.counts[status];
      if (!n) return;
      const el = document.createElement('span');
      el.className = 'status-count';
      el.innerHTML = '<span class="status-dot status-dot--' + status.toLowerCase() + '"></span>' + n + ' ' + status;
      summary.appendChild(el);
    });
    statusBox.classList.add('is-visible');

    if (!total) {
      const raw = document.createElement('div');
      raw.className = 'empty-hint';
      raw.style.textAlign = 'left';
      raw.innerHTML = '<p style="margin:0;">Unexpected structure: the raw content will still be included as an appendix in the PDF so nothing is lost. If your Fontspector version has changed its output format, take a look at <code>js/fontspector.js</code>.</p>';
      list.appendChild(raw);
      return;
    }

    Fontspector.DETAILED_STATUSES.forEach((status) => {
      const items = fs.detailed[status];
      if (!items.length) return;
      const heading = document.createElement('p');
      heading.className = 'problem-group__title';
      heading.textContent = status + ' (' + items.length + ')';
      list.appendChild(heading);
      items.forEach((check, idx) => list.appendChild(renderCheckCard(check, status, idx)));
    });

    const collapsedParts = ['SKIP', 'PASS']
      .filter((s) => fs.counts[s])
      .map((s) => fs.counts[s] + ' ' + (s === 'PASS' ? 'checks passed' : 'checks skipped'));
    if (collapsedParts.length) {
      const p = document.createElement('p');
      p.className = 'collapsed-summary';
      p.textContent = collapsedParts.join(' · ') + ' — not detailed in the guide.';
      list.appendChild(p);
    }
  }

  function renderCheckCard(check, status, idx) {
    const card = document.createElement('div');
    card.className = 'check-card check-card--' + status.toLowerCase();

    const head = document.createElement('div');
    head.className = 'check-card__head';

    const badge = document.createElement('span');
    badge.className = 'check-badge check-badge--' + status.toLowerCase();
    badge.textContent = status;
    head.appendChild(badge);

    const idEl = document.createElement('span');
    idEl.className = 'check-card__id';
    idEl.textContent = check.id;
    head.appendChild(idEl);

    card.appendChild(head);

    if (check.message) {
      const msg = document.createElement('p');
      msg.className = 'check-card__message';
      msg.textContent = check.message;
      card.appendChild(msg);
    }

    if (check.explanation) {
      const exp = document.createElement('p');
      exp.className = 'check-card__explain';
      const strong = document.createElement('strong');
      strong.textContent = (check.explanationTitle || 'How to fix it') + ' — ';
      exp.appendChild(strong);
      exp.appendChild(document.createTextNode(check.explanation));
      card.appendChild(exp);
    }

    const commentWrap = document.createElement('div');
    commentWrap.className = 'check-card__comment';
    const key = status + '-' + idx;

    const label = document.createElement('label');
    label.setAttribute('for', 'comment-' + key);
    label.textContent = 'Add a comment (appears in the PDF)';
    commentWrap.appendChild(label);

    const textarea = document.createElement('textarea');
    textarea.id = 'comment-' + key;
    textarea.value = state.checkComments[key] || '';
    textarea.addEventListener('input', () => {
      state.checkComments[key] = textarea.value;
    });
    commentWrap.appendChild(textarea);

    card.appendChild(commentWrap);
    return card;
  }

  /* --------------------------------- Step 4: generate ----------------------------- */

  function onGenerate() {
    const hasIncludedLink = Object.keys(state.included).some((id) => state.included[id]);
    if (!hasIncludedLink && !state.fontspectorReport) {
      showToast('Select at least one link or import a Fontspector report before generating.');
      return;
    }

    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const groups = selected
      .map((problem) => {
        const links = state.autoLinks
          .filter((l) => l.matchedProblemIds.includes(problem.id) && state.included[l.id] !== false)
          .map((l) => ({ title: l.title, url: l.url, explanation: l.explanation }));
        return { problemLabel: problem.label, links: links };
      })
      .filter((g) => g.links.length);

    const manualIncluded = state.manualLinks.filter((l) => state.included[l.id] !== false);
    if (manualIncluded.length) {
      groups.push({
        problemLabel: 'Added manually',
        links: manualIncluded.map((l) => ({ title: l.title, url: l.url, explanation: l.explanation }))
      });
    }

    const payload = {
      title: document.getElementById('meta-title').value.trim() || 'Typography Correction Guide',
      projectName: document.getElementById('meta-project').value.trim(),
      designerName: document.getElementById('meta-designer').value.trim(),
      notes: document.getElementById('meta-notes').value.trim(),
      fontMeta: state.fontMeta,
      groups: groups,
      fontspector: state.fontspectorReport,
      checkComments: state.checkComments
    };

    try {
      TypoPDF.generate(payload);
      showToast('PDF generated.');
    } catch (err) {
      console.error(err);
      showToast('Error while generating the PDF — see the console.');
    }
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
    document.getElementById('btn-show-links').addEventListener('click', onShowLinks);
    document.getElementById('btn-add-manual-link').addEventListener('click', onAddManualLink);
    document.getElementById('btn-generate').addEventListener('click', onGenerate);

    const dropzone = document.getElementById('font-dropzone');
    const fontInput = document.getElementById('font-file-input');
    dropzone.addEventListener('click', () => fontInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      if (e.dataTransfer.files.length) onFontFile(e.dataTransfer.files[0]);
    });
    fontInput.addEventListener('change', () => onFontFile(fontInput.files[0]));

    document.getElementById('fs-file-input').addEventListener('change', (e) => onFontspectorFile(e.target.files[0]));
  }
})();
