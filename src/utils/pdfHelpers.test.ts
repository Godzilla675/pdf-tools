import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePageRanges,
  parseSplitGroups,
  calculateByteDelta,
  scanRedactionPatterns,
  detectHeuristicFormFields,
  tfIdfSummarize,
  groupItemsIntoTableRows,
  itemsToStructuredMarkdown,
} from './pdfHelpers';
import { TOOLS_REGISTRY } from '../registry/toolsRegistry';
import {
  sanitizeHtmlForRendering,
  detectMarkupFormat,
  buildPrintableHtmlDocument,
  stripHtmlToCleanPlainText,
} from './htmlPdfRenderer';
import {
  DEFAULT_PPTX_THEME,
  emuToPx,
  emuToPt,
  transformChildBoxInGroup,
  applyColorModifiers,
  resolveSchemeColorHex,
  resolveFontFamilyCss,
  resolveZipTargetPath,
  formatAutoNumberBullet,
} from './pptxColorAndMath';

test('TOOLS_REGISTRY contains all 33 core tools plus Workflows and Reader', () => {
  const numberedTools = TOOLS_REGISTRY.filter((t) => t.number >= 1 && t.number <= 33);
  assert.equal(numberedTools.length, 33);
  const workflowsTool = TOOLS_REGISTRY.find((t) => t.id === 'custom-workflows');
  assert.ok(workflowsTool);
  const readerTool = TOOLS_REGISTRY.find((t) => t.id === 'pdf-reader');
  assert.ok(readerTool);
});

test('parsePageRanges handles custom ranges, even, odd, and clamping', () => {
  assert.deepEqual(parsePageRanges('1-3, 5, 7-8', 8), [0, 1, 2, 4, 6, 7]);
  assert.deepEqual(parsePageRanges('even', 6), [1, 3, 5]);
  assert.deepEqual(parsePageRanges('odd', 6), [0, 2, 4]);
  assert.deepEqual(parsePageRanges('1, 99', 4), [0]);
});

test('parseSplitGroups splits comma-separated ranges into discrete groups', () => {
  const groups = parseSplitGroups('1-2, 3, 4-5', 5);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].pages, [0, 1]);
  assert.deepEqual(groups[1].pages, [2]);
  assert.deepEqual(groups[2].pages, [3, 4]);
});

test('calculateByteDelta computes accurate percentage saved', () => {
  const delta = calculateByteDelta(1000, 400);
  assert.equal(delta.diffBytes, 600);
  assert.equal(delta.percentSaved, '-60.0%');
  assert.equal(delta.isSmaller, true);
});

test('scanRedactionPatterns identifies emails, phones, SSNs, and credit cards', () => {
  const items = [
    {
      str: 'Contact: ops@monopdf.io or call 555-234-5678',
      x: 50,
      y: 100,
      width: 240,
      height: 12,
      fontSize: 12,
      pageIndex: 0,
    },
    {
      str: 'SSN: 123-45-6789 Card: 4532-1111-2222-3333',
      x: 50,
      y: 120,
      width: 240,
      height: 12,
      fontSize: 12,
      pageIndex: 0,
    },
  ];
  const matches = scanRedactionPatterns(items, {
    scanEmails: true,
    scanPhones: true,
    scanSsn: true,
    scanCreditCards: true,
  });
  assert.equal(matches.length, 4);
  assert.deepEqual(
    matches.map((m) => m.category).sort(),
    ['Card', 'Email', 'Phone', 'SSN']
  );
});

test('detectHeuristicFormFields detects underscores and checkbox brackets', () => {
  const items = [
    {
      str: 'Full Name: _______________',
      x: 40,
      y: 200,
      width: 180,
      height: 12,
      fontSize: 12,
      pageIndex: 0,
    },
    {
      str: '[ ] I accept the archival terms',
      x: 40,
      y: 240,
      width: 160,
      height: 12,
      fontSize: 12,
      pageIndex: 0,
    },
  ];
  const fields = detectHeuristicFormFields(items);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].type, 'form-text');
  assert.equal(fields[1].type, 'form-checkbox');
});

test('tfIdfSummarize ranks sentences and extracts action items', () => {
  const sample =
    'MONO PDF is a zero-latency monochrome desktop PDF suite built for offline execution. ' +
    'Every tool processes raw Uint8Array buffers directly inside the browser memory space. ' +
    'Users must verify archival compliance before submitting final legal records by the deadline.';
  const res = tfIdfSummarize(sample, 2);
  assert.ok(res.executiveSummary.length > 30);
  assert.ok(res.actionItems.some((a) => a.includes('must verify')));
});

test('groupItemsIntoTableRows and itemsToStructuredMarkdown convert positioned items accurately', () => {
  const rows = groupItemsIntoTableRows(
    [
      { str: 'Col B', x: 150, y: 50 },
      { str: 'Col A', x: 50, y: 51 },
      { str: 'Val 1', x: 50, y: 80 },
      { str: 'Val 2', x: 150, y: 81 },
    ],
    4
  );
  assert.deepEqual(rows, [
    ['Col A', 'Col B'],
    ['Val 1', 'Val 2'],
  ]);

  const md = itemsToStructuredMarkdown([
    {
      pageNumber: 1,
      items: [
        { str: 'Document Title', x: 50, y: 40, fontSize: 22, width: 140 },
        { str: 'Body paragraph text line.', x: 50, y: 90, fontSize: 11, width: 160 },
        { str: '• Bullet item one', x: 50, y: 115, fontSize: 11, width: 120 },
      ],
    },
  ]);
  assert.ok(md.includes('# Document Title'));
  assert.ok(md.includes('- Bullet item one'));
});

test('htmlPdfRenderer detects HTML vs Markdown accurately', () => {
  assert.equal(detectMarkupFormat('<!DOCTYPE html><html><body><h1>Hi</h1></body></html>'), 'html');
  assert.equal(detectMarkupFormat('<div class="card"><p>Hello</p></div>'), 'html');
  assert.equal(detectMarkupFormat('# Heading\n\n- Bullet one\n- Bullet two'), 'markdown');
  assert.equal(detectMarkupFormat('plain text', 'report.html'), 'html');
  assert.equal(detectMarkupFormat('plain text', 'notes.md'), 'markdown');
});

test('sanitizeHtmlForRendering removes scripts and inline event handlers while keeping CSS styles', () => {
  const dirty =
    '<style>body { color: #111; } .badge { background: #222; }</style>' +
    '<div class="badge" onclick="alert(1)">Invoice #42</div>' +
    '<script>window.pwn = true;</script>' +
    '<a href="javascript:evil()">Link</a>';
  const clean = sanitizeHtmlForRendering(dirty);
  assert.ok(clean.includes('<style>body { color: #111; }'));
  assert.ok(clean.includes('Invoice #42'));
  assert.ok(!clean.includes('<script'));
  assert.ok(!clean.includes('onclick='));
  assert.ok(!clean.includes('javascript:'));
});

test('buildPrintableHtmlDocument renders Markdown to real HTML tags and preserves HTML styles', () => {
  const mdDoc = buildPrintableHtmlDocument('# Quarterly Report\n\n| Metric | Value |\n|---|---|\n| Revenue | $12M |', 'markdown');
  assert.ok(mdDoc.includes('<h1>Quarterly Report</h1>'));
  assert.ok(mdDoc.includes('<table>'));
  assert.ok(mdDoc.includes('$12M'));

  const htmlDoc = buildPrintableHtmlDocument('<html><head><style>.hero { font-size: 32px; }</style></head><body><div class="hero">Styled Title</div></body></html>', 'html');
  assert.ok(htmlDoc.includes('.hero { font-size: 32px; }'));
  assert.ok(htmlDoc.includes('<div class="hero">Styled Title</div>'));
});

test('stripHtmlToCleanPlainText never leaks CSS style blocks or HTML tags into plain text', () => {
  const html =
    '<!DOCTYPE html><html><head><style>body { font-family: Arial; color: red; }</style></head>' +
    '<body><h1>Invoice #1042</h1><p>Total due: &dollar;500 &amp; tax.</p></body></html>';
  const plain = stripHtmlToCleanPlainText(html);
  assert.ok(!plain.includes('font-family'));
  assert.ok(!plain.includes('<h1>'));
  assert.ok(plain.includes('Invoice #1042'));
  assert.ok(plain.includes('Total due:'));
});

test('pptxColorAndMath converts EMUs and transforms grouped child coordinates accurately', () => {
  // Standard 16:9 slide: 12192000 x 6858000 EMU = 960 x 540 pt = 1280 x 720 px
  assert.equal(emuToPt(12192000), 960);
  assert.equal(emuToPt(6858000), 540);
  assert.equal(emuToPx(12192000), 1280);
  assert.equal(emuToPx(6858000), 720);

  const mapped = transformChildBoxInGroup(
    { x: 100, y: 50, w: 200, h: 100, rot: 15 },
    {
      offX: 1000,
      offY: 500,
      extX: 800,
      extY: 400,
      chOffX: 0,
      chOffY: 0,
      chExtX: 400,
      chExtY: 200,
      rot: 30,
    }
  );
  assert.equal(mapped.x, 1200);
  assert.equal(mapped.y, 600);
  assert.equal(mapped.w, 400);
  assert.equal(mapped.h, 200);
  assert.equal(mapped.rot, 45);
});

test('pptxColorAndMath applies OOXML color modifiers, resolves scheme colors, fonts, zip paths, and bullets', () => {
  // 50% shade on pure white => ~#808080
  assert.equal(applyColorModifiers('FFFFFF', { shade: 50000 }), '#808080');
  // 50% tint on pure black => ~#808080
  assert.equal(applyColorModifiers('000000', { tint: 50000 }), '#808080');
  // 50% alpha => rgba
  assert.equal(applyColorModifiers('102030', { alpha: 50000 }), 'rgba(16, 32, 48, 0.500)');

  assert.equal(resolveSchemeColorHex('bg1', DEFAULT_PPTX_THEME), 'FFFFFF');
  assert.equal(resolveSchemeColorHex('tx1', DEFAULT_PPTX_THEME), '000000');
  assert.equal(resolveSchemeColorHex('phClr', DEFAULT_PPTX_THEME, '#FF5500'), 'FF5500');

  assert.ok(resolveFontFamilyCss('+mj-lt', DEFAULT_PPTX_THEME).includes('Calibri Light'));
  assert.ok(resolveFontFamilyCss('+mn-lt', DEFAULT_PPTX_THEME).includes('Calibri'));
  assert.ok(resolveFontFamilyCss('Georgia', DEFAULT_PPTX_THEME).includes('serif'));

  assert.equal(
    resolveZipTargetPath('ppt/slides/slide1.xml', '../media/image1.png'),
    'ppt/media/image1.png'
  );
  assert.equal(
    resolveZipTargetPath('ppt/presentation.xml', 'slides/slide2.xml'),
    'ppt/slides/slide2.xml'
  );

  assert.equal(formatAutoNumberBullet('arabicPeriod', 3), '3.');
  assert.equal(formatAutoNumberBullet('alphaUcPeriod', 2), 'B.');
  assert.equal(formatAutoNumberBullet('romanUcPeriod', 4), 'IV.');
});


