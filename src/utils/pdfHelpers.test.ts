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
