/* ==========================================================================
   Typo Guide Generator — app logic
   Aucune donnée n'est envoyée à un serveur : tout se passe dans le
   navigateur (lecture des JSON du repo, lecture du .ttf, génération du PDF).
   ========================================================================== */

(function () {
  'use strict';

  const state = {
    problems: [],
    linksDb: [],
    explanationsDb: [],
    selectedProblemIds: new Set(),
    autoLinks: [],    // liens calculés à partir des tags, à plat
    manualLinks: [],  // liens ajoutés à la main pour cette session
    included: {},     // linkId -> bool (coche/décoche, vaut true par défaut)
    fontMeta: null,
    fontspectorReport: null, // sortie de Fontspector.parseReport(), annotée
    checkComments: {}        // 'STATUS-index' -> commentaire libre
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
      showToast('Erreur de chargement des données — ' + err.message);
      console.error(err);
      return;
    }
    renderProblems();
    bindStaticEvents();
  }

  function fetchJSON(path) {
    return fetch(path).then((res) => {
      if (!res.ok) throw new Error(path + ' introuvable (HTTP ' + res.status + ')');
      return res.json();
    });
  }

  /* ---------------------------- Étape 1 : problèmes ---------------------------- */

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

  /* ----------------------------- Étape 2 : liens ------------------------------- */

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
      showToast('Coche au moins un problème avant de voir les liens.');
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
      container.appendChild(renderLinkGroup('Ajoutés manuellement', state.manualLinks, true));
    }

    if (anyRendered) {
      emptyHint.style.display = 'none';
    } else {
      emptyHint.style.display = 'block';
      emptyHint.textContent = state.autoLinks.length === 0 && state.selectedProblemIds.size
        ? "Aucun lien de la base ne correspond à cette sélection pour l'instant — ajoute-en un manuellement ci-dessous, ou complète data/links-database.json."
        : 'Coche au moins un problème à l\'étape 1, puis clique sur « Voir les liens ».';
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
      badge.textContent = 'manuel';
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
      removeBtn.textContent = 'Supprimer';
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
      showToast('Un titre et une URL sont nécessaires.');
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
    return s || 'lien';
  }

  /* ------------------------- Étape 3 : police + fontspector --------------------- */

  function onFontFile(file) {
    if (!file) return;
    file.arrayBuffer().then((buffer) => {
      let font;
      try {
        font = opentype.parse(buffer);
      } catch (err) {
        showToast("Ce fichier n'a pas pu être lu comme une police valide.");
        console.error(err);
        return;
      }
      const family = pickName(font.names.fontFamily) || pickName(font.names.preferredFamily) || file.name;
      const version = pickName(font.names.version) || '';
      state.fontMeta = { family: family, version: version, glyphCount: font.glyphs.length };

      document.getElementById('font-loaded-name').textContent = family;
      document.getElementById('font-loaded-meta').textContent =
        font.glyphs.length + ' glyphes' + (version ? ' — ' + version : '');
      document.getElementById('font-loaded').classList.add('is-visible');

      const projectInput = document.getElementById('meta-project');
      if (!projectInput.value) projectInput.value = family;
    }).catch((err) => {
      showToast('Impossible de lire ce fichier.');
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
        showToast("Ce fichier n'est pas un JSON valide.");
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
      ? total + ' résultats détectés dans le rapport'
      : "Le rapport a été chargé, mais sa structure n'a pas pu être analysée automatiquement.";

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
      raw.innerHTML = '<p style="margin:0;">Structure inattendue : le contenu brut sera tout de même inclus en annexe du PDF pour que rien ne soit perdu. Si ta version de Fontspector a changé son format de sortie, jette un œil à <code>js/fontspector.js</code>.</p>';
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
      .map((s) => fs.counts[s] + ' ' + (s === 'PASS' ? 'checks réussis' : 'checks skip'));
    if (collapsedParts.length) {
      const p = document.createElement('p');
      p.className = 'collapsed-summary';
      p.textContent = collapsedParts.join(' · ') + ' — non détaillés dans le guide.';
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
      strong.textContent = (check.explanationTitle || 'Comment corriger') + ' — ';
      exp.appendChild(strong);
      exp.appendChild(document.createTextNode(check.explanation));
      card.appendChild(exp);
    }

    const commentWrap = document.createElement('div');
    commentWrap.className = 'check-card__comment';
    const key = status + '-' + idx;

    const label = document.createElement('label');
    label.setAttribute('for', 'comment-' + key);
    label.textContent = 'Ajouter un commentaire (apparaît dans le PDF)';
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

  /* ----------------------------- Étape 4 : génération --------------------------- */

  function onGenerate() {
    const hasIncludedLink = Object.keys(state.included).some((id) => state.included[id]);
    if (!hasIncludedLink && !state.fontspectorReport) {
      showToast('Sélectionne au moins un lien ou importe un rapport Fontspector avant de générer.');
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
        problemLabel: 'Ajoutés manuellement',
        links: manualIncluded.map((l) => ({ title: l.title, url: l.url, explanation: l.explanation }))
      });
    }

    const payload = {
      title: document.getElementById('meta-title').value.trim() || 'Guide de correction typographique',
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
      showToast('PDF généré.');
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la génération du PDF — voir la console.');
    }
  }

  /* ---------------------------------- Divers ------------------------------------ */

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
