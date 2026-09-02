/* ==========================================================================
   Link database editor.
   Loads data/links-database.json, lets you edit/add/remove entries, then
   exports a new links-database.json to replace in the repo (this site is
   static: nothing is ever written back to GitHub automatically — this is
   a deliberate manual round-trip).
   ========================================================================== */

(function () {
  'use strict';

  let entries = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const res = await fetch('data/links-database.json');
      entries = res.ok ? await res.json() : [];
    } catch (e) {
      entries = [];
    }
    render();
    bindEvents();
  }

  function render() {
    const container = document.getElementById('entries');
    container.innerHTML = '';
    entries.forEach((entry, idx) => container.appendChild(renderEntry(entry, idx)));
    const count = document.getElementById('entry-count');
    count.textContent = entries.length + (entries.length > 1 ? ' links in the database' : ' link in the database');
  }

  function renderEntry(entry, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'add-link-form';
    wrap.style.marginTop = '14px';

    wrap.innerHTML =
      '<div class="field">' +
        '<label>ID (slug — auto-generated if left blank)</label>' +
        '<input type="text" data-field="id" data-idx="' + idx + '" value="' + escapeAttr(entry.id || '') + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>Title</label>' +
        '<input type="text" data-field="title" data-idx="' + idx + '" value="' + escapeAttr(entry.title || '') + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>URL</label>' +
        '<input type="url" data-field="url" data-idx="' + idx + '" value="' + escapeAttr(entry.url || '') + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>Tags (comma-separated — should match the tags in data/problems.json)</label>' +
        '<input type="text" data-field="tags" data-idx="' + idx + '" value="' + escapeAttr((entry.tags || []).join(', ')) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>Explanation (appears in the PDF under the link)</label>' +
        '<textarea data-field="explanation" data-idx="' + idx + '">' + escapeHtml(entry.explanation || '') + '</textarea>' +
      '</div>' +
      '<div class="actions-row">' +
        '<button type="button" class="btn btn--danger-ghost" data-remove-idx="' + idx + '">Remove this entry</button>' +
      '</div>';

    return wrap;
  }

  function bindEvents() {
    const container = document.getElementById('entries');

    container.addEventListener('input', (e) => {
      const idxAttr = e.target.getAttribute('data-idx');
      const field = e.target.getAttribute('data-field');
      if (idxAttr === null || !field) return;
      const i = Number(idxAttr);
      if (field === 'tags') {
        entries[i].tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
      } else {
        entries[i][field] = e.target.value;
      }
    });

    container.addEventListener('click', (e) => {
      const removeAttr = e.target.getAttribute('data-remove-idx');
      if (removeAttr === null) return;
      entries.splice(Number(removeAttr), 1);
      render();
    });

    document.getElementById('btn-add-entry').addEventListener('click', () => {
      entries.push({ id: '', title: '', url: '', tags: [], explanation: '' });
      render();
      const container2 = document.getElementById('entries');
      if (container2.lastElementChild && typeof container2.lastElementChild.scrollIntoView === 'function') {
        container2.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    document.getElementById('btn-export').addEventListener('click', exportJson);
    document.getElementById('import-file').addEventListener('change', (e) => importJson(e.target.files[0]));
  }

  function exportJson() {
    entries.forEach((e) => {
      if (!e.id || !e.id.trim()) e.id = slugify(e.title || 'link');
    });
    const blob = new Blob([JSON.stringify(entries, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links-database.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    render();
  }

  function importJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('invalid format');
        entries = data;
        render();
      } catch (e) {
        alert('The imported file is not valid JSON for a link list (must be an array).');
      }
    };
    reader.readAsText(file);
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
})();
