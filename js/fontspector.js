/* ==========================================================================
   Fontspector report parser
   ----------------------------------------------------------------------
   The exact JSON schema of `fontspector --json` can change between
   versions of the tool (it's a young project, recently rewritten in
   Rust). Rather than hard-coding field names that could break on the
   next version bump, we walk the report recursively and pick out any
   object that "looks like" a check result: a known status
   (ERROR/FAIL/WARN/INFO/SKIP/PASS) accompanied by an identifier.

   If one day the automatic extraction finds nothing (too different a
   schema), the app shows the raw JSON instead of failing silently — see
   app.js, renderFontspectorEmpty().
   ========================================================================== */

const Fontspector = (function () {
  const STATUS_ORDER = ['ERROR', 'FAIL', 'WARN', 'INFO', 'SKIP', 'PASS'];
  const DETAILED_STATUSES = ['ERROR', 'FAIL', 'WARN', 'INFO'];

  function normalizeStatus(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const up = raw.trim().toUpperCase();
    if (up === 'WARNING') return 'WARN';
    if (up === 'ERR') return 'ERROR';
    return STATUS_ORDER.includes(up) ? up : null;
  }

  function flattenId(idLike) {
    if (idLike == null) return null;
    if (Array.isArray(idLike)) return idLike.map(flattenId).filter(Boolean).join(' / ');
    if (typeof idLike === 'object') return idLike.id || idLike.key || idLike.check_id || null;
    return String(idLike);
  }

  // Recursively walks the report and collects every "check result" object.
  function extractChecks(root) {
    const found = [];
    const seen = new Set();

    function walk(node, ctx) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, ctx));
        return;
      }

      const status = normalizeStatus(node.status || node.result || node.level || node.severity);
      const idLike = flattenId(
        node.check_id || node.checkid || node.checkId || node.code || node.key || node.id
      ) || ctx.id;
      const msgLike = node.message || node.description || node.rationale || node.reason || node.msg;

      if (status && idLike) {
        found.push({
          id: idLike,
          status: status,
          message: msgLike ? String(msgLike).trim() : (ctx.message || ''),
          filename: node.filename || node.file || ctx.filename || null,
          title: node.rationale || node.title || ctx.title || null
        });
      }

      const nextCtx = {
        id: idLike || ctx.id,
        filename: node.filename || node.file || ctx.filename,
        message: (msgLike ? String(msgLike).trim() : ctx.message),
        title: node.rationale || node.title || ctx.title
      };

      Object.keys(node).forEach((key) => {
        if (['status', 'result', 'level', 'severity'].includes(key)) return;
        walk(node[key], nextCtx);
      });
    }

    walk(root, {});
    return dedupe(found);
  }

  function dedupe(list) {
    const map = new Map();
    list.forEach((item) => {
      const k = [item.id, item.status, item.message, item.filename || ''].join('|');
      if (!map.has(k)) map.set(k, item);
    });
    return Array.from(map.values());
  }

  function summarize(checks) {
    const counts = { ERROR: 0, FAIL: 0, WARN: 0, INFO: 0, SKIP: 0, PASS: 0 };
    checks.forEach((c) => {
      if (counts[c.status] !== undefined) counts[c.status]++;
    });
    return counts;
  }

  // Looks up a plain-language explanation: exact match first, then
  // partial match (the check-id CONTAINS the "match" key).
  function findExplanation(checkId, explanationsDb) {
    if (!explanationsDb || !explanationsDb.length) return null;
    const exact = explanationsDb.find((e) => e.match === checkId);
    if (exact) return exact;
    const partial = explanationsDb.find((e) => checkId.toLowerCase().includes(String(e.match).toLowerCase()));
    return partial || null;
  }

  function parseReport(json) {
    const checks = extractChecks(json);
    return {
      raw: json,
      checks: checks,
      counts: summarize(checks),
      detailed: DETAILED_STATUSES.reduce((acc, status) => {
        acc[status] = checks.filter((c) => c.status === status);
        return acc;
      }, {})
    };
  }

  return {
    STATUS_ORDER: STATUS_ORDER,
    DETAILED_STATUSES: DETAILED_STATUSES,
    parseReport: parseReport,
    findExplanation: findExplanation
  };
})();
