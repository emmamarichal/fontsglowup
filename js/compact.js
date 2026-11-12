/* ==========================================================================
   The compact report link (format v2).

   GitHub only makes a link clickable up to about 4,096 characters, so the
   report link can't carry the whole report. It carries references instead:
   the ids of the problems, links and tutorials (report.html reads their
   text from data/*.json and tutorials/*.md on the site), the Fontspector
   checks picked, with their comments, and the screenshots' captions — the
   images themselves go into the GitHub comment, where GitHub hosts them.

     Compact.pack(report, level)  -> the small object stored in the link
                                     (level 0…4: how much check text is kept)
     Compact.unpack(small, db)    -> the full report object (format of
                                     js/github-comment.js), screenshots marked
                                     as being in the GitHub comment
     Compact.loadDb(base)         -> { problems, links, tutorials, rules } from the site
     Compact.ruleFor(rules, id)   -> the data/check-rules.json rule of a check
   ========================================================================== */

const Compact = (function () {
  'use strict';

  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const arr = (v) => (Array.isArray(v) ? v : []);

  // Level 0 keeps the most; each level drops more text from the checks.
  const LEVELS = [
    { message: 240, title: true, explain: true, notes: true },
    { message: 90, title: true, explain: false, notes: false },
    { message: 0, title: true, explain: false, notes: false },
    { message: 0, title: false, explain: false, notes: false },
    { message: 0, title: false, explain: false, notes: false, files: false }
  ];

  function clip(s, n) {
    s = str(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  function pack(r, level) {
    const L = LEVELS[Math.min(level || 0, LEVELS.length - 1)];
    const out = {
      app: 'typo-guide-generator',
      v: 2,
      title: str(r.title),
      author: str(r.author),
      date: str(r.date),
      project: str(r.project),
      designer: str(r.designer),
      contact: str(r.contact)
    };
    if (L.notes && r.notes) out.notes = str(r.notes);
    // problems: [id, [link ids]]; links added by hand: [title, url, explanation]
    out.p = arr(r.problems).filter((p) => !p.manual).map((p) => [p.id, arr(p.links).map((l) => l.id).filter(Boolean)]);
    const manual = arr(r.problems).filter((p) => p.manual).flatMap((p) => arr(p.links));
    if (manual.length) out.m = manual.map((l) => (L.explain && l.explanation ? [str(l.title), str(l.url), str(l.explanation)] : [str(l.title), str(l.url)]));
    out.t = arr(r.tutorials).map((t) => t.id);
    const fs = r.fontspector;
    if (fs && arr(fs.checks).length) {
      out.f = {
        ver: str(fs.version),
        prof: str(fs.profile),
        files: L.files === false ? [] : arr(fs.files).map(str),
        counts: fs.counts || null,
        // [status, id, filename, comment, title, message]
        c: arr(fs.checks).map((c) => {
          const row = [str(c.status), str(c.id), str(c.filename), str(c.comment)];
          if (L.title && c.title) row[4] = str(c.title);
          if (L.message && c.message) row[5] = clip(c.message, L.message);
          return row;
        })
      };
    }
    // screenshots: [file name, comment, problem id]
    const shots = arr(r.screenshots);
    if (shots.length) out.s = shots.map((s) => [str(s.name), str(s.comment), str(s.problem)]);
    return out;
  }

  function globRe(pat) {
    return new RegExp('^' + str(pat).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*') + '$');
  }

  function ruleFor(rules, checkId) {
    const id = str(checkId);
    return arr(rules).find((r) => arr(r.checks).some((pat) => globRe(pat).test(id))) || null;
  }

  async function fetchJSON(url, fallback) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (fallback !== undefined) return fallback;
      throw err;
    }
  }

  async function loadDb(base) {
    base = base || '';
    const [problems, links, tutorials, rules] = await Promise.all([
      fetchJSON(base + 'data/problems.json'),
      fetchJSON(base + 'data/links-database.json'),
      fetchJSON(base + 'data/tutorials.json', []),
      fetchJSON(base + 'data/check-rules.json', [])
    ]);
    return { problems: problems, links: links, tutorials: tutorials, rules: rules, base: base };
  }

  // withTutorialText: also fetch the tutorials' Markdown (the report page needs it, the generator doesn't)
  async function unpack(s, db, withTutorialText) {
    const linkById = new Map(arr(db.links).map((l) => [l.id, l]));
    const problemById = new Map(arr(db.problems).map((p) => [p.id, p]));
    const tutById = new Map(arr(db.tutorials).map((t) => [t.id, t]));

    const tutorials = [];
    for (const id of arr(s.t)) {
      const t = tutById.get(id);
      if (!t) continue;
      let markdown = '';
      if (withTutorialText) {
        try {
          const res = await fetch((db.base || '') + t.path);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          markdown = await res.text();
        } catch (err) {
          console.error('Tutorial ' + t.path, err);
          continue;
        }
      }
      tutorials.push({ id: t.id, title: t.title, markdown: markdown });
    }
    const tutIds = new Set(tutorials.map((t) => t.id));

    const problems = arr(s.p).map(([id, links]) => {
      const p = problemById.get(id) || { id: id, label: id, action: '', category: '', tags: [] };
      return {
        id: p.id,
        label: p.label,
        action: p.action || '',
        category: p.category || '',
        tutorials: arr(db.tutorials).filter((t) => tutIds.has(t.id) && arr(t.tags).some((tag) => arr(p.tags).includes(tag))).map((t) => t.id),
        links: arr(links).map((lid) => linkById.get(lid)).filter(Boolean)
          .map((l) => ({ id: l.id, title: l.title, url: l.url, explanation: l.explanation || '' }))
      };
    });
    if (arr(s.m).length) {
      problems.push({
        id: null, manual: true, label: 'Additional resources', category: '', tutorials: [],
        links: s.m.map(([title, url, explanation]) => ({ id: null, title: str(title) || str(url), url: str(url), explanation: str(explanation) }))
      });
    }

    let fontspector = null;
    if (s.f && arr(s.f.c).length) {
      fontspector = {
        source: 'link',
        version: str(s.f.ver),
        profile: str(s.f.prof),
        files: arr(s.f.files).map(str),
        counts: s.f.counts && typeof s.f.counts === 'object' ? s.f.counts : null,
        checks: s.f.c.map(([status, id, filename, comment, title, message]) => {
          const rule = ruleFor(db.rules, id);
          return {
            status: str(status).toUpperCase(), id: str(id), filename: str(filename) || null,
            comment: str(comment), title: str(title), message: str(message),
            problem: rule ? rule.problem || null : null,
            links: rule ? arr(rule.links).map((lid) => linkById.get(lid)).filter(Boolean).map((l) => ({ title: l.title, url: l.url })) : []
          };
        })
      };
    }

    return {
      app: 'typo-guide-generator', v: 2,
      title: str(s.title), author: str(s.author), date: str(s.date), project: str(s.project),
      designer: str(s.designer), notes: str(s.notes), contact: str(s.contact),
      problems: problems,
      tutorials: tutorials,
      fontspector: fontspector,
      // the images are in the GitHub comment, not in the link
      screenshots: arr(s.s).map(([name, comment, problem]) => ({ name: str(name), comment: str(comment), problem: str(problem) || null, src: '', omitted: true, inComment: true }))
    };
  }

  return { pack: pack, unpack: unpack, loadDb: loadDb, ruleFor: ruleFor, LEVELS: LEVELS.length };
})();
