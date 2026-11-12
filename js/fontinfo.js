/* ==========================================================================
   What is in the dropped fonts: characters (cmap), variable axes (fvar),
   family name. Read straight from the font bytes, in the browser.

   FontInfo.read(bytes)        -> { family, codepoints: Set, variable, axes: [tag…] }
   FontInfo.merge([info…])     -> the same, for a whole family (union of characters)
   FontInfo.coverage(info)     -> what the tool needs to know: scripts and features
   FontInfo.meets(info, req)   -> does the font meet a "requires" rule of problems.json
   ========================================================================== */

const FontInfo = (function () {
  'use strict';

  function tables(view) {
    const out = {};
    const n = view.getUint16(4);
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
      out[tag] = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
    }
    return out;
  }

  function readCmap(view, t) {
    const cps = new Set();
    if (!t) return cps;
    const base = t.offset;
    const n = view.getUint16(base + 2);
    const subs = [];
    for (let i = 0; i < n; i++) {
      const rec = base + 4 + i * 8;
      subs.push({ platform: view.getUint16(rec), encoding: view.getUint16(rec + 2), offset: base + view.getUint32(rec + 4) });
    }
    // Unicode subtables only (platform 0, or Windows 1 / 10)
    const unicode = subs.filter((s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)));
    unicode.forEach((s) => {
      const format = view.getUint16(s.offset);
      if (format === 4) {
        const segX2 = view.getUint16(s.offset + 6);
        const ends = s.offset + 14;
        const starts = ends + segX2 + 2;
        const deltas = starts + segX2;
        const rangeOffsets = deltas + segX2;
        for (let i = 0; i < segX2 / 2; i++) {
          const end = view.getUint16(ends + i * 2);
          const start = view.getUint16(starts + i * 2);
          const delta = view.getInt16(deltas + i * 2);
          const ro = view.getUint16(rangeOffsets + i * 2);
          for (let c = start; c <= end && c !== 0xFFFF; c++) {
            let gid;
            if (ro === 0) gid = (c + delta) & 0xFFFF;
            else {
              const addr = rangeOffsets + i * 2 + ro + (c - start) * 2;
              gid = view.getUint16(addr);
              if (gid) gid = (gid + delta) & 0xFFFF;
            }
            if (gid) cps.add(c);
          }
        }
      } else if (format === 12) {
        const groups = view.getUint32(s.offset + 12);
        for (let i = 0; i < groups; i++) {
          const g = s.offset + 16 + i * 12;
          const start = view.getUint32(g);
          const end = Math.min(view.getUint32(g + 4), start + 0x30000);
          for (let c = start; c <= end; c++) cps.add(c);
        }
      }
    });
    return cps;
  }

  function readName(view, t, ids) {
    if (!t) return '';
    const base = t.offset;
    const count = view.getUint16(base + 2);
    const strings = base + view.getUint16(base + 4);
    for (const want of ids) {
      for (let i = 0; i < count; i++) {
        const rec = base + 6 + i * 12;
        const platform = view.getUint16(rec);
        const nameId = view.getUint16(rec + 6);
        if (nameId !== want || platform !== 3) continue;
        const len = view.getUint16(rec + 8);
        const off = strings + view.getUint16(rec + 10);
        let s = '';
        for (let j = 0; j < len; j += 2) s += String.fromCharCode(view.getUint16(off + j));
        if (s) return s;
      }
    }
    return '';
  }

  function readAxes(view, t) {
    if (!t) return [];
    const base = t.offset;
    const axesOffset = view.getUint16(base + 4);
    const count = view.getUint16(base + 8);
    const size = view.getUint16(base + 10);
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = base + axesOffset + i * size;
      out.push(String.fromCharCode(view.getUint8(a), view.getUint8(a + 1), view.getUint8(a + 2), view.getUint8(a + 3)));
    }
    return out;
  }

  function read(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sig = view.getUint32(0);
    if (sig === 0x774F4646 || sig === 0x774F4632) throw new Error('WOFF files are not supported, drop the .ttf or .otf');
    if (sig === 0x74746366) throw new Error('font collections (.ttc) are not supported');
    const t = tables(view);
    return {
      family: readName(view, t.name, [16, 1]),
      codepoints: readCmap(view, t.cmap),
      variable: !!t.fvar,
      axes: readAxes(view, t.fvar),
      outlines: t.CFF || t.CFF2 ? 'CFF' : 'TrueType'
    };
  }

  function merge(list) {
    const out = { family: '', codepoints: new Set(), variable: false, axes: [], files: list.length };
    list.forEach((f) => {
      out.family = out.family || f.family;
      f.codepoints.forEach((c) => out.codepoints.add(c));
      out.variable = out.variable || f.variable;
      f.axes.forEach((a) => { if (!out.axes.includes(a)) out.axes.push(a); });
    });
    return out;
  }

  function parseRange(r) {
    const [a, b] = String(r).split('-').map((x) => parseInt(x, 16));
    return [a, isNaN(b) ? a : b];
  }

  function countIn(info, ranges) {
    const rs = (ranges || []).map(parseRange);
    let n = 0;
    info.codepoints.forEach((c) => { if (rs.some(([a, b]) => c >= a && c <= b)) n++; });
    return n;
  }

  // A "requires" rule from data/problems.json:
  //   { "ranges": ["0370-03FF"], "min": 20 }  at least `min` characters (default 1) in these ranges
  //   { "chars": "ßẞ" }                       at least one of these characters
  //   { "variable": true }                   a variable font
  function meets(info, req) {
    if (!req || !info) return true;
    if (req.variable && !info.variable) return false;
    if (req.chars && !Array.from(req.chars).some((ch) => info.codepoints.has(ch.codePointAt(0)))) return false;
    if (req.ranges && countIn(info, req.ranges) < (req.min || 1)) return false;
    return true;
  }

  const SCRIPTS = [
    ['Latin', ['0041-005A', '0061-007A', '00C0-024F', '1E00-1EFF']],
    ['Greek', ['0370-03FF', '1F00-1FFF']],
    ['Cyrillic', ['0400-052F', '1C80-1C8F', '2DE0-2DFF', 'A640-A69F']],
    ['Armenian', ['0530-058F']],
    ['Hebrew', ['0590-05FF']],
    ['Arabic', ['0600-06FF', '0750-077F', '08A0-08FF', 'FB50-FDFF', 'FE70-FEFF']],
    ['Devanagari', ['0900-097F']],
    ['Bengali', ['0980-09FF']],
    ['Thai', ['0E00-0E7F']],
    ['Georgian', ['10A0-10FF']],
    ['Khmer', ['1780-17FF']],
    ['CJK', ['3040-30FF', '4E00-9FFF', 'AC00-D7AF']]
  ];

  // Scripts with at least 10 characters in the font, in order of importance.
  function coverage(info) {
    const scripts = SCRIPTS.map(([name, ranges]) => ({ name: name, count: countIn(info, ranges) }))
      .filter((s) => s.count >= 10);
    return { scripts: scripts, chars: info.codepoints.size };
  }

  return { read: read, merge: merge, meets: meets, coverage: coverage };
})();
