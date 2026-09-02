/* ==========================================================================
   PDF generation — pdfmake
   ========================================================================== */

const TypoPDF = (function () {
  const COLORS = {
    ink: '#202124',
    inkSoft: '#5F6368',
    blue: '#1A73E8',
    blueDark: '#174EA6',
    rule: '#D2E3FC',
    faint: '#80868B'
  };

  function ensureVfs() {
    try {
      if (typeof pdfFonts !== 'undefined' && pdfFonts && pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
        pdfMake.vfs = pdfFonts.pdfMake.vfs;
      }
    } catch (e) { /* vfs already configured by the vfs_fonts.js script itself */ }
  }

  function formatDate(d) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function buildCover(payload) {
    const content = [];
    content.push({ text: payload.title || 'Typography Correction Guide', style: 'h1', margin: [0, 0, 0, 6] });

    const subLines = [];
    if (payload.projectName) subLines.push(payload.projectName);
    if (payload.designerName) subLines.push('for ' + payload.designerName);
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
    content.push({ text: 'Points to fix', style: 'h2', margin: [0, 26, 0, 4] });
    content.push({ text: 'Links and resources selected for this project, sorted by the issue identified.', style: 'sectionIntro', margin: [0, 0, 0, 14] });

    groups.forEach((group) => {
      if (!group.links.length) return;
      content.push({ text: group.problemLabel, style: 'h3', margin: [0, 14, 0, 8] });
      group.links.forEach((link) => {
        content.push({
          columns: [
            {
              width: 10,
              text: '—',
              color: COLORS.blue
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

  function generate(payload) {
    ensureVfs();

    const content = [];
    content.push(...buildCover(payload));
    content.push(...buildLinksSection(payload.groups));

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [48, 56, 48, 56],
      info: {
        title: payload.title || 'Typography Correction Guide'
      },
      content: content,
      styles: {
        h1: { fontSize: 24, bold: true, color: COLORS.ink },
        subtitle: { fontSize: 13, color: COLORS.inkSoft },
        metaDate: { fontSize: 9, color: COLORS.faint },
        notes: { fontSize: 10.5, color: COLORS.ink, italics: true },
        h2: { fontSize: 16, bold: true, color: COLORS.ink },
        h3: { fontSize: 12, bold: true, color: COLORS.blueDark },
        sectionIntro: { fontSize: 9.5, color: COLORS.inkSoft },
        linkTitle: { fontSize: 10.5, bold: true, color: COLORS.blueDark },
        linkUrl: { fontSize: 8, color: COLORS.blue },
        linkExplain: { fontSize: 9.5, color: COLORS.inkSoft }
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
            { text: payload.title || 'Typography Correction Guide', fontSize: 8, color: COLORS.faint },
            { text: currentPage + ' / ' + pageCount, alignment: 'right', fontSize: 8, color: COLORS.faint }
          ]
        };
      }
    };

    const safeName = (payload.projectName || payload.title || 'typo-guide')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    pdfMake.createPdf(docDefinition).download((safeName || 'typo-guide') + '.pdf');
  }

  return { generate: generate };
})();
