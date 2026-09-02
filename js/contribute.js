/* ==========================================================================
   Suggest links — additive only, no editing/removal of the live database.
   Nothing here writes anywhere: "Create pull request" just opens GitHub's
   own "new file" form, pre-filled, in a new tab. GitHub handles the
   fork + branch + pull request from there — the repo owner reviews and
   merges (or doesn't) like any other PR. This page cannot touch the live
   database by itself.
   ========================================================================== */

(function () {
  'use strict';

  // Update these if the repo is ever renamed or transferred.
  const REPO_OWNER = 'emmamarichal';
  const REPO_NAME = 'fontsglowup';
  const REPO_BRANCH = 'main';

  let entries = [{ title: '', url: '', tags: '', explanation: '' }];
  let knownTags = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const res = await fetch('data/problems.json');
      if (res.ok) {
        const problems = await res.json();
        const set = new Set();
        problems.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
        knownTags = Array.from(set).sort();
      }
    } catch (e) { /* purely a helper list — fine if it fails to load */ }

    renderKnownTags();
    render();
    bindEvents();
  }

  function renderKnownTags() {
    const el = document.getElementById('known-tags');
    if (!el) return;
    if (!knownTags.length) { el.textContent = ''; return; }
    el.innerHTML = '';
    knownTags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = t;
      el.appendChild(chip);
    });
  }

  function render() {
    const container = document.getElementById('entries');
    container.innerHTML = '';
    entries.forEach((entry, idx) => container.appendChild(renderEntry(entry, idx)));
  }

  function renderEntry(entry, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'add-link-form';
    wrap.style.marginTop = idx === 0 ? '0' : '14px';

    wrap.innerHTML =
      '<p class="add-link-form__title">Link ' + (idx + 1) + '</p>' +
      '<div class="field">' +
        '<label>Title</label>' +
        '<input type="text" data-field="title" data-idx="' + idx + '" value="' + escapeAttr(entry.title) + '" placeholder="e.g. How to draw a correct ß">' +
      '</div>' +
      '<div class="field">' +
        '<label>URL</label>' +
        '<input type="url" data-field="url" data-idx="' + idx + '" value="' + escapeAttr(entry.url) + '" placeholder="https://…">' +
      '</div>' +
      '<div class="field">' +
        '<label>Tags (comma-separated — see the list above)</label>' +
        '<input type="text" data-field="tags" data-idx="' + idx + '" value="' + escapeAttr(entry.tags) + '" placeholder="e.g. german, eszett">' +
      '</div>' +
      '<div class="field">' +
        '<label>Explanation (a sentence or two)</label>' +
        '<textarea data-field="explanation" data-idx="' + idx + '" placeholder="What this resource shows, specifically.">' + escapeHtml(entry.explanation) + '</textarea>' +
      '</div>' +
      (entries.length > 1
        ? '<div class="actions-row"><button type="button" class="btn btn--danger-ghost" data-remove-idx="' + idx + '">Remove this link</button></div>'
        : '');

    return wrap;
  }

  function bindEvents() {
    const container = document.getElementById('entries');

    container.addEventListener('input', (e) => {
      const idxAttr = e.target.getAttribute('data-idx');
      const field = e.target.getAttribute('data-field');
      if (idxAttr === null || !field) return;
      entries[Number(idxAttr)][field] = e.target.value;
    });

    container.addEventListener('click', (e) => {
      const removeAttr = e.target.getAttribute('data-remove-idx');
      if (removeAttr === null) return;
      entries.splice(Number(removeAttr), 1);
      render();
    });

    document.getElementById('btn-add-entry').addEventListener('click', () => {
      entries.push({ title: '', url: '', tags: '', explanation: '' });
      render();
      const container2 = document.getElementById('entries');
      if (container2.lastElementChild && typeof container2.lastElementChild.scrollIntoView === 'function') {
        container2.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    document.getElementById('btn-create-pr').addEventListener('click', onCreatePR);
  }

  function onCreatePR() {
    const usable = entries
      .map((e) => ({
        title: e.title.trim(),
        url: e.url.trim(),
        tags: e.tags.trim(),
        explanation: e.explanation.trim()
      }))
      .filter((e) => e.title || e.url || e.tags || e.explanation);

    if (!usable.length) {
      showToast('Add at least one link first.');
      return;
    }
    const invalid = usable.filter((e) => !e.title || !e.url);
    if (invalid.length) {
      showToast('Every link needs at least a title and a URL.');
      return;
    }

    const usedIds = new Set();
    const payload = usable.map((e) => {
      let id = slugify(e.title);
      let n = 2;
      while (usedIds.has(id)) { id = slugify(e.title) + '-' + n; n++; }
      usedIds.add(id);
      return {
        id: id,
        title: e.title,
        url: e.url,
        tags: e.tags ? e.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        explanation: e.explanation
      };
    });

    const content = JSON.stringify(payload, null, 2) + '\n';
    const today = new Date().toISOString().slice(0, 10);
    const filename = 'proposed-links-' + today + '-' + (payload[0].id || 'links') + '.json';

    // Landing this at the repo root (rather than inside data/) sidesteps a
    // long-documented GitHub quirk where the ?filename= query param can
    // silently drop the deepest folder in a nested "create new file" URL.
    // The repo owner moves the content into data/links-database.json and
    // deletes this file as part of reviewing the PR — see the README.
    const url = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/new/' + REPO_BRANCH
      + '?filename=' + encodeURIComponent(filename)
      + '&value=' + encodeURIComponent(content);

    showPreview(filename, content);

    if (url.length > 7000) {
      showToast("That's a lot of content — GitHub's URL may be too long. Copy the preview below and create the file by hand instead.");
      return;
    }

    window.open(url, '_blank', 'noopener');
    showToast('Opening GitHub in a new tab…');
  }

  function showPreview(filename, content) {
    const box = document.getElementById('pr-preview');
    const nameEl = document.getElementById('pr-preview-filename');
    const pre = document.getElementById('pr-preview-pre');
    nameEl.textContent = filename;
    pre.textContent = content;
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

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 4200);
  }
})();
