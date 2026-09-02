/* ==========================================================================
   Typo Guide Generator — app logic
   No data is ever sent to a server: everything happens in the browser
   (reading the repo's JSON files, generating the PDF).
   ========================================================================== */

(function () {
  'use strict';

  const state = {
    problems: [],
    linksDb: [],
    selectedProblemIds: new Set(),
    autoLinks: [],    // links computed from tags, flat list
    manualLinks: [],  // links added by hand for this session
    included: {}      // linkId -> bool (checked/unchecked, defaults to true)
  };

  let manualIdCounter = 1;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const [problems, linksDb] = await Promise.all([
        fetchJSON('data/problems.json'),
        fetchJSON('data/links-database.json')
      ]);
      state.problems = problems;
      state.linksDb = linksDb;
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

  function slugifyCategory(cat) {
    return String(cat)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  /* ------------------------------ Step 1: problems ------------------------------ */
  /* All problem cards render into a single mixed grid — cards from different
     categories sit side by side, distinguished only by a pale category tint
     (see .cat-* classes in css/style.css) rather than by grouped sections. */

  function renderProblems() {
    const container = document.getElementById('problems-list');
    container.innerHTML = '';
    state.problems.forEach((problem) => container.appendChild(renderProblemCard(problem)));
  }

  function renderProblemCard(problem) {
    const label = document.createElement('label');
    label.className = 'problem-card cat-' + slugifyCategory(problem.category);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = problem.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedProblemIds.add(problem.id);
      else state.selectedProblemIds.delete(problem.id);
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

    const grid = document.createElement('div');
    grid.className = 'link-group__grid';
    links.forEach((link) => grid.appendChild(renderLinkRow(link, isManualGroup)));
    wrap.appendChild(grid);

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

  /* --------------------------------- Step 3: generate ----------------------------- */

  function onGenerate() {
    const hasIncludedLink = Object.keys(state.included).some((id) => state.included[id]);
    if (!hasIncludedLink) {
      showToast('Select at least one link before generating.');
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
      groups: groups
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
  }
})();
