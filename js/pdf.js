/* ==========================================================================
   PDF generation — pdfmake
   ========================================================================== */

const TypoPDF = (function () {
  const COLORS = {
    ink: '#191A16',
    inkSoft: '#55564E',
    pencil: '#24509C',
    pencilInk: '#14336B',
    rule: '#B9B49F',
    error: '#6E1E1E',
    fail: '#A23726',
    warn: '#8A5B0B',
    info: '#24509C',
    faint: '#8C8A7E'
  };

  const STATUS_LABEL = {
    ERROR: 'ERREUR',
    FAIL: 'À CORRIGER',
    WARN: 'À VÉRIFIER',
    INFO: 'INFO'
  };

  const STATUS_COLOR = {
    ERROR: COLORS.error,
    FAIL: COLORS.fail,
    WARN: COLORS.warn,
    INFO: COLORS.info
  };

  function ensureVfs() {
    try {
      if (typeof pdfFonts !== 'undefined' && pdfFonts && pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
        pdfMake.vfs = pdfFonts.pdfMake.vfs;
      }
    } catch (e) { /* vfs déjà configuré par le script vfs_fonts.js lui-même */ }
  }

  function formatDate(d) {
    return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function buildCover(payload) {
    const content = [];
    content.push({ text: payload.title || 'Guide de correction typographique', style: 'h1', margin: [0, 0, 0, 6] });

    const subLines = [];
    if (payload.projectName) subLines.push(payload.projectName);
    if (payload.fontMeta && payload.fontMeta.family) subLines.push(payload.fontMeta.family);
    if (payload.designerName) subLines.push('pour ' + payload.designerName);
    if (subLines.length) {
      content.push({ text: subLines.join(' — '), style: 'subtitle', margin: [0, 0, 0, 4] });
    }
    content.push({ text: formatDate(new Date()), style: 'metaDate', margin: [0, 0, 0, 18] });

    if (payload.notes) {
      content.push({ text: payload.notes, style: 'notes', margin: [0, 0, 0, 10] });
    }

    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: COLORS.rule }], margin: [0, 6, 0, 0] });
    return content;
  }

  function buildLinksSection(groups) {
    if (!groups || !groups.length) return [];
    const content = [];
    content.push({ text: 'Points à corriger', style: 'h2', margin: [0, 26, 0, 4] });
    content.push({ text: 'Liens et ressources sélectionnés pour ce projet, classés par problème identifié.', style: 'sectionIntro', margin: [0, 0, 0, 14] });

    groups.forEach((group) => {
      if (!group.links.length) return;
      content.push({ text: group.problemLabel, style: 'h3', margin: [0, 14, 0, 8] });
      group.links.forEach((link) => {
        content.push({
          columns: [
            {
              width: 10,
              text: '—',
              color: COLORS.pencil
            },
            {
              width: '*',
              stack: [
                { text: link.title, style: 'linkTitle', link: link.url },
                { text: link.url, style: 'linkUrl' },
                link.explanation ? { text: link.explanation, style: 'linkExplain', margin: [0, 2, 0, 0] } : null
              ].filter(Boolean)
            }
          ],
          columnGap: 8,
          margin: [0, 0, 0, 10]
        });
      });
    });
    return content;
  }

  function buildFontspectorSection(fs, checkComments) {
    if (!fs) return [];
    const content = [];
    content.push({ text: 'Rapport Fontspector', style: 'h2', margin: [0, 30, 0, 4], pageBreak: 'before' });
    content.push({
      text: 'Contrôle qualité automatisé du fichier de police, du plus critique (ERREUR) au plus informatif (INFO). Les niveaux SKIP et PASS sont résumés en fin de section.',
      style: 'sectionIntro',
      margin: [0, 0, 0, 12]
    });

    // Résumé chiffré
    const order = ['ERROR', 'FAIL', 'WARN', 'INFO', 'SKIP', 'PASS'];
    const summaryCols = order
      .filter((s) => fs.counts[s] > 0)
      .map((s) => ({
        width: 'auto',
        text: fs.counts[s] + ' ' + (STATUS_LABEL[s] || s),
        style: 'summaryChip',
        color: STATUS_COLOR[s] || COLORS.inkSoft,
        margin: [0, 0, 16, 0]
      }));
    content.push({ columns: summaryCols, margin: [0, 0, 0, 16] });

    ['ERROR', 'FAIL', 'WARN', 'INFO'].forEach((status) => {
      const items = fs.detailed[status];
      if (!items || !items.length) return;
      content.push({
        text: STATUS_LABEL[status] + ' (' + items.length + ')',
        style: 'statusHeading',
        color: STATUS_COLOR[status],
        margin: [0, 16, 0, 8]
      });

      items.forEach((check, idx) => {
        const key = status + '-' + idx;
        const comment = checkComments && checkComments[key];
        const stack = [
          { text: check.id, style: 'checkId' },
          check.message ? { text: check.message, style: 'checkMessage', margin: [0, 2, 0, 0] } : null
        ];
        if (check.explanation) {
          stack.push({
            text: [
              { text: (check.explanationTitle || 'Comment corriger : ') + ' ', bold: true },
              check.explanation
            ],
            style: 'checkExplain',
            margin: [0, 4, 0, 0]
          });
        }
        if (comment) {
          stack.push({
            text: [{ text: 'Note : ', bold: true, color: COLORS.pencilInk }, comment],
            style: 'checkComment',
            margin: [0, 4, 0, 0]
          });
        }

        content.push({
          table: {
            widths: [3, '*'],
            body: [[
              { text: '', fillColor: STATUS_COLOR[status], border: [false, false, false, false] },
              { stack: stack.filter(Boolean), border: [false, false, false, false], margin: [8, 6, 4, 6] }
            ]]
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0
          },
          margin: [0, 0, 0, 6]
        });
      });
    });

    const collapsed = ['SKIP', 'PASS'].filter((s) => fs.counts[s] > 0)
      .map((s) => fs.counts[s] + ' checks en ' + (s === 'PASS' ? 'réussite' : 'skip (non applicables)'))
      .join(' · ');
    if (collapsed) {
      content.push({ text: collapsed, style: 'collapsedNote', margin: [0, 18, 0, 0] });
    }

    return content;
  }

  function generate(payload) {
    ensureVfs();

    const content = [];
    content.push(...buildCover(payload));
    content.push(...buildLinksSection(payload.groups));
    content.push(...buildFontspectorSection(payload.fontspector, payload.checkComments));

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [48, 56, 48, 56],
      info: {
        title: payload.title || 'Guide de correction typographique'
      },
      content: content,
      styles: {
        h1: { fontSize: 24, bold: true, color: COLORS.ink },
        subtitle: { fontSize: 13, color: COLORS.inkSoft },
        metaDate: { fontSize: 9, color: COLORS.faint },
        notes: { fontSize: 10.5, color: COLORS.ink, italics: true },
        h2: { fontSize: 16, bold: true, color: COLORS.ink },
        h3: { fontSize: 12, bold: true, color: COLORS.pencilInk },
        sectionIntro: { fontSize: 9.5, color: COLORS.inkSoft },
        linkTitle: { fontSize: 10.5, bold: true, color: COLORS.pencilInk },
        linkUrl: { fontSize: 8, color: COLORS.pencil },
        linkExplain: { fontSize: 9.5, color: COLORS.inkSoft },
        summaryChip: { fontSize: 9.5, bold: true },
        statusHeading: { fontSize: 12, bold: true },
        checkId: { fontSize: 8.5, color: COLORS.faint },
        checkMessage: { fontSize: 9.5, color: COLORS.ink },
        checkExplain: { fontSize: 9.5, color: COLORS.ink },
        checkComment: { fontSize: 9.5, color: COLORS.ink },
        collapsedNote: { fontSize: 9.5, color: COLORS.faint, italics: true }
      },
      defaultStyle: {
        fontSize: 10.5,
        color: COLORS.ink,
        lineHeight: 1.25
      },
      footer: function (currentPage, pageCount) {
        return {
          margin: [48, 0, 48, 0],
          columns: [
            { text: payload.title || 'Guide de correction typographique', fontSize: 8, color: COLORS.faint },
            { text: currentPage + ' / ' + pageCount, alignment: 'right', fontSize: 8, color: COLORS.faint }
          ]
        };
      }
    };

    const safeName = (payload.projectName || payload.title || 'guide-typo')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    pdfMake.createPdf(docDefinition).download((safeName || 'guide-typo') + '.pdf');
  }

  return { generate: generate };
})();
