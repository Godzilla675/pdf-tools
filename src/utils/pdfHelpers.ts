/**
 * Pure, deterministic utility functions for PDF range parsing, byte telemetry,
 * TF-IDF extractive summarization, regex coordinate redaction scanning,
 * form field heuristics, table coordinate clustering, and Markdown conversion.
 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[i]}`;
}

export function calculateByteDelta(before: number, after: number): {
  diffBytes: number;
  percentSaved: string;
  isSmaller: boolean;
} {
  if (before <= 0) {
    return { diffBytes: 0, percentSaved: '0.0%', isSmaller: false };
  }
  const diff = before - after;
  const pct = (diff / before) * 100;
  const sign = pct > 0 ? '-' : pct < 0 ? '+' : '';
  return {
    diffBytes: diff,
    percentSaved: `${sign}${Math.abs(pct).toFixed(1)}%`,
    isSmaller: after <= before,
  };
}

/**
 * Parses a human page range specification (1-based) into sorted unique 0-based page indices.
 * Supports: "all", "even", "odd", "1-3, 5, 7-9".
 */
export function parsePageRanges(input: string, maxPages: number): number[] {
  if (maxPages <= 0) return [];
  const cleaned = (input || '').trim().toLowerCase();
  if (!cleaned || cleaned === 'all') {
    return Array.from({ length: maxPages }, (_, i) => i);
  }
  if (cleaned === 'even') {
    const res: number[] = [];
    for (let p = 2; p <= maxPages; p += 2) res.push(p - 1);
    return res;
  }
  if (cleaned === 'odd') {
    const res: number[] = [];
    for (let p = 1; p <= maxPages; p += 2) res.push(p - 1);
    return res;
  }

  const indices = new Set<number>();
  const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part === 'even') {
      for (let p = 2; p <= maxPages; p += 2) indices.add(p - 1);
      continue;
    }
    if (part === 'odd') {
      for (let p = 1; p <= maxPages; p += 2) indices.add(p - 1);
      continue;
    }
    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-').map((s) => s.trim());
      const startNum = parseInt(startRaw, 10);
      const endNum = endRaw === 'end' || endRaw === 'last' ? maxPages : parseInt(endRaw, 10);
      if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
        const lo = Math.max(1, Math.min(startNum, endNum));
        const hi = Math.min(maxPages, Math.max(startNum, endNum));
        for (let p = lo; p <= hi; p++) {
          indices.add(p - 1);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= maxPages) {
        indices.add(num - 1);
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Splits a page range string into discrete groups of 0-based page arrays.
 * Used by Split PDF (Custom Ranges mode) where each comma-separated range can become its own file.
 */
export function parseSplitGroups(rangeString: string, maxPages: number): { label: string; pages: number[] }[] {
  if (maxPages <= 0) return [];
  const parts = (rangeString || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const groups: { label: string; pages: number[] }[] = [];
  for (const part of parts) {
    const pages = parsePageRanges(part, maxPages);
    if (pages.length > 0) {
      groups.push({ label: part.replace(/\s+/g, ''), pages });
    }
  }

  if (groups.length === 0) {
    return [{ label: `1-${maxPages}`, pages: Array.from({ length: maxPages }, (_, i) => i) }];
  }
  return groups;
}

export interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  pageIndex: number;
}

/**
 * Scans extracted PDF text items for sensitive patterns (Emails, Phones, SSNs, Credit Cards, Custom)
 * and returns bounding boxes in PDF page coordinates.
 */
export function scanRedactionPatterns(
  items: PositionedTextItem[],
  options: {
    scanEmails?: boolean;
    scanPhones?: boolean;
    scanSsn?: boolean;
    scanCreditCards?: boolean;
    customSearchPattern?: string;
  }
): {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  matchedText: string;
  category: string;
}[] {
  const results: {
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    matchedText: string;
    category: string;
  }[] = [];

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;
  const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
  const ccRegex = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

  for (const item of items) {
    const text = item.str;
    if (!text || !text.trim()) continue;

    const checkPattern = (regex: RegExp, category: string) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const matchStr = match[0];
        const startRatio = match.index / Math.max(text.length, 1);
        const lengthRatio = matchStr.length / Math.max(text.length, 1);
        results.push({
          pageIndex: item.pageIndex,
          x: item.x + item.width * startRatio,
          y: item.y,
          width: Math.max(24, item.width * lengthRatio),
          height: Math.max(12, item.height * 1.15),
          matchedText: matchStr,
          category,
        });
      }
    };

    if (options.scanEmails) checkPattern(emailRegex, 'Email');
    if (options.scanPhones) checkPattern(phoneRegex, 'Phone');
    if (options.scanSsn) checkPattern(ssnRegex, 'SSN');
    if (options.scanCreditCards) checkPattern(ccRegex, 'Card');

    if (options.customSearchPattern && options.customSearchPattern.trim()) {
      try {
        const customRx = new RegExp(options.customSearchPattern.trim(), 'gi');
        checkPattern(customRx, 'Custom');
      } catch {
        const escaped = options.customSearchPattern.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        checkPattern(new RegExp(escaped, 'gi'), 'Custom');
      }
    }
  }

  return results;
}

/**
 * Heuristic scanner for PDF Forms Mode 2 ("Auto-Detect Form Fields"):
 * Finds underscore sequences (___) for text fields and [ ] or ( ) boxes for checkboxes.
 */
export function detectHeuristicFormFields(items: PositionedTextItem[]): {
  id: string;
  type: 'form-text' | 'form-checkbox';
  fieldName: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}[] {
  const fields: {
    id: string;
    type: 'form-text' | 'form-checkbox';
    fieldName: string;
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];

  let counter = 1;

  for (const item of items) {
    const text = item.str;
    if (!text) continue;

    // Detect underscore lines e.g. "Name: ___________" or "___________"
    const underscoreMatch = /_{3,}/.exec(text);
    if (underscoreMatch) {
      const prefix = text.slice(0, underscoreMatch.index).replace(/[:\s]+$/, '').trim();
      const startRatio = underscoreMatch.index / Math.max(text.length, 1);
      const lengthRatio = underscoreMatch[0].length / Math.max(text.length, 1);
      const safeLabel = prefix
        ? prefix.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        : `field_${counter}`;
      fields.push({
        id: `auto_field_${counter}`,
        type: 'form-text',
        fieldName: `${safeLabel}_${counter}`,
        pageIndex: item.pageIndex,
        x: item.x + item.width * startRatio,
        y: item.y,
        width: Math.max(90, item.width * lengthRatio),
        height: Math.max(16, item.height * 1.25),
      });
      counter++;
    }

    // Detect checkbox brackets e.g. "[ ]" or "[  ]" or "☐"
    const checkboxMatch = /(\[\s?\]|☐)/.exec(text);
    if (checkboxMatch) {
      const suffix = text
        .slice(checkboxMatch.index + checkboxMatch[0].length)
        .trim()
        .slice(0, 24);
      const startRatio = checkboxMatch.index / Math.max(text.length, 1);
      const safeLabel = suffix
        ? suffix.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        : `check_${counter}`;
      fields.push({
        id: `auto_check_${counter}`,
        type: 'form-checkbox',
        fieldName: `${safeLabel}_${counter}`,
        pageIndex: item.pageIndex,
        x: item.x + item.width * startRatio,
        y: item.y,
        width: 16,
        height: 16,
      });
      counter++;
    }
  }

  return fields;
}

/**
 * Deterministic 100% offline TF-IDF sentence-ranking extractive summarizer.
 */
export function tfIdfSummarize(
  rawText: string,
  targetSentences = 5
): {
  executiveSummary: string;
  bulletPoints: string[];
  actionItems: string[];
  topKeywords: string[];
  wordCount: number;
  sentenceCount: number;
} {
  const clean = (rawText || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return {
      executiveSummary: 'No extractable text found in document.',
      bulletPoints: [],
      actionItems: [],
      topKeywords: [],
      wordCount: 0,
      sentenceCount: 0,
    };
  }

  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
    'have', 'has', 'had', 'not', 'but', 'what', 'all', 'can', 'will', 'into',
    'your', 'our', 'their', 'about', 'which', 'when', 'there', 'been', 'also',
    'more', 'than', 'some', 'such', 'only', 'other', 'new', 'any', 'each', 'per',
  ]);

  const words = clean
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const freqMap = new Map<string, number>();
  for (const w of words) {
    freqMap.set(w, (freqMap.get(w) || 0) + 1);
  }

  const topKeywords = Array.from(freqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  const rawSentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (rawSentences.length === 0) {
    return {
      executiveSummary: clean.slice(0, 400),
      bulletPoints: [clean.slice(0, 200)],
      actionItems: ['Verify document text layer via OCR if scanned.'],
      topKeywords,
      wordCount: clean.split(/\s+/).length,
      sentenceCount: 1,
    };
  }

  const scored = rawSentences.map((sentence, index) => {
    const sWords = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    let score = 0;
    for (const w of sWords) {
      score += freqMap.get(w) || 0;
    }
    // Normalize by length to avoid unduly favoring giant run-on lines, plus boost early introductory sentences
    const normalizedScore =
      score / Math.max(Math.sqrt(sWords.length), 1) + (index === 0 ? 3.5 : index < 3 ? 1.5 : 0);

    return { sentence, index, score: normalizedScore };
  });

  const topSelected = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(targetSentences, scored.length))
    .sort((a, b) => a.index - b.index);

  const executiveSummary = topSelected.map((s) => s.sentence).join(' ');
  const bulletPoints = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(targetSentences + 2, scored.length))
    .map((s) => s.sentence);

  // Extract sentences containing action/obligation verbs or numbers/dates
  const actionPattern = /\b(must|shall|required|deadline|submit|complete|ensure|verify|deliver|payment|invoice|due|sign|approve|action)\b/i;
  const actionItems = rawSentences
    .filter((s) => actionPattern.test(s))
    .slice(0, 5);

  if (actionItems.length === 0) {
    actionItems.push(
      `Review primary findings across ${rawSentences.length} extracted sentences.`,
      `Cross-check key domain entities: ${topKeywords.slice(0, 4).join(', ') || 'N/A'}.`
    );
  }

  return {
    executiveSummary,
    bulletPoints,
    actionItems,
    topKeywords,
    wordCount: clean.split(/\s+/).length,
    sentenceCount: rawSentences.length,
  };
}

/**
 * Groups positioned PDF text items into a structured 2D table array based on Y-coordinate rows
 * and X-coordinate column sorting (used by PDF to Excel and PDF to Markdown).
 */
export function groupItemsIntoTableRows(
  items: { str: string; x: number; y: number }[],
  yTolerance = 4
): string[][] {
  const nonEmpty = items.filter((it) => it.str && it.str.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  // Sort top-to-bottom (assuming y is normalized top-down; if bottom-up, caller normalizes first)
  const sortedByY = [...nonEmpty].sort((a, b) => a.y - b.y);
  const rows: { y: number; cells: { x: number; str: string }[] }[] = [];

  for (const item of sortedByY) {
    const existingRow = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance);
    if (existingRow) {
      existingRow.cells.push({ x: item.x, str: item.str.trim() });
    } else {
      rows.push({ y: item.y, cells: [{ x: item.x, str: item.str.trim() }] });
    }
  }

  return rows.map((row) =>
    row.cells.sort((a, b) => a.x - b.x).map((c) => c.str)
  );
}

/**
 * Converts positioned PDF pages into structured Markdown using font-size heuristics,
 * bullet detection, code detection, and tabular alignment.
 */
export function itemsToStructuredMarkdown(
  pages: {
    pageNumber: number;
    items: { str: string; x: number; y: number; fontSize: number; width: number }[];
  }[],
  options: { includePageMarkers?: boolean; detectTables?: boolean } = {
    includePageMarkers: true,
    detectTables: true,
  }
): string {
  const allFontSizes: number[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (item.str.trim()) allFontSizes.push(Math.round(item.fontSize * 10) / 10);
    }
  }

  // Compute median body font size
  const sortedSizes = [...allFontSizes].sort((a, b) => a - b);
  const bodySize = sortedSizes.length > 0 ? sortedSizes[Math.floor(sortedSizes.length * 0.5)] : 11;

  const mdLines: string[] = [];

  for (const page of pages) {
    if (options.includePageMarkers && pages.length > 1) {
      mdLines.push(`<!-- Page ${page.pageNumber} -->`);
    }

    // Group items by Y line (tolerance 4pt)
    const sorted = [...page.items]
      .filter((i) => i.str && i.str.trim())
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const lineGroups: {
      y: number;
      maxFontSize: number;
      cells: { x: number; str: string }[];
    }[] = [];

    for (const item of sorted) {
      const row = lineGroups.find((r) => Math.abs(r.y - item.y) <= 4.5);
      if (row) {
        row.cells.push({ x: item.x, str: item.str.trim() });
        row.maxFontSize = Math.max(row.maxFontSize, item.fontSize);
      } else {
        lineGroups.push({
          y: item.y,
          maxFontSize: item.fontSize,
          cells: [{ x: item.x, str: item.str.trim() }],
        });
      }
    }

    let inTable = false;
    let tableColumnCount = 0;

    for (const line of lineGroups) {
      const orderedCells = line.cells.sort((a, b) => a.x - b.x);
      // Check if cells have wide X separation suggesting columns
      let distinctCols = [orderedCells[0]?.str || ''];
      for (let i = 1; i < orderedCells.length; i++) {
        const gap = orderedCells[i].x - orderedCells[i - 1].x;
        if (gap > 65) {
          distinctCols.push(orderedCells[i].str);
        } else {
          distinctCols[distinctCols.length - 1] += ' ' + orderedCells[i].str;
        }
      }

      if (options.detectTables && distinctCols.length >= 3 && line.maxFontSize <= bodySize * 1.2) {
        if (!inTable) {
          inTable = true;
          tableColumnCount = distinctCols.length;
          mdLines.push('');
          mdLines.push(`| ${distinctCols.join(' | ')} |`);
          mdLines.push(`| ${distinctCols.map(() => '---').join(' | ')} |`);
        } else {
          // Pad or trim to match tableColumnCount
          while (distinctCols.length < tableColumnCount) distinctCols.push('');
          mdLines.push(`| ${distinctCols.slice(0, tableColumnCount).join(' | ')} |`);
        }
        continue;
      } else {
        if (inTable) {
          inTable = false;
          mdLines.push('');
        }
      }

      const fullText = orderedCells.map((c) => c.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!fullText) continue;

      if (line.maxFontSize >= bodySize * 1.55) {
        mdLines.push(`\n# ${fullText}\n`);
      } else if (line.maxFontSize >= bodySize * 1.3) {
        mdLines.push(`\n## ${fullText}\n`);
      } else if (line.maxFontSize >= bodySize * 1.15) {
        mdLines.push(`\n### ${fullText}\n`);
      } else if (/^[•\-*▪▸]\s*/.test(fullText)) {
        mdLines.push(`- ${fullText.replace(/^[•\-*▪▸]\s*/, '')}`);
      } else if (/^\d+[.)]\s+/.test(fullText)) {
        mdLines.push(fullText);
      } else {
        mdLines.push(fullText);
      }
    }

    mdLines.push('');
  }

  return mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Offline dictionary & phrase translator fallback when Ollama / Cloud AI is unavailable.
 */
export function offlineTranslateText(text: string, targetLanguage: string): string {
  const dictionaries: Record<string, Record<string, string>> = {
    Spanish: {
      'executive summary': 'resumen ejecutivo',
      'invoice': 'factura',
      'chapter': 'capítulo',
      'page': 'página',
      'document': 'documento',
      'confidential': 'confidencial',
      'total': 'total',
      'date': 'fecha',
      'signature': 'firma',
      'agreement': 'acuerdo',
      'terms': 'términos',
      'system': 'sistema',
      'architecture': 'arquitectura',
      'security': 'seguridad',
      'report': 'informe',
      'overview': 'descripción general',
      'the': 'el',
      'and': 'y',
      'of': 'de',
      'to': 'a',
      'in': 'en',
      'for': 'para',
      'with': 'con',
    },
    French: {
      'executive summary': 'résumé exécutif',
      'invoice': 'facture',
      'chapter': 'chapitre',
      'page': 'page',
      'document': 'document',
      'confidential': 'confidentiel',
      'total': 'total',
      'date': 'date',
      'signature': 'signature',
      'agreement': 'accord',
      'terms': 'conditions',
      'system': 'système',
      'architecture': 'architecture',
      'security': 'sécurité',
      'report': 'rapport',
      'overview': 'aperçu',
      'the': 'le',
      'and': 'et',
      'of': 'de',
      'to': 'à',
      'in': 'dans',
      'for': 'pour',
      'with': 'avec',
    },
    German: {
      'executive summary': 'zusammenfassung',
      'invoice': 'rechnung',
      'chapter': 'kapitel',
      'page': 'seite',
      'document': 'dokument',
      'confidential': 'vertraulich',
      'total': 'gesamt',
      'date': 'datum',
      'signature': 'unterschrift',
      'agreement': 'vereinbarung',
      'terms': 'bedingungen',
      'system': 'system',
      'architecture': 'architektur',
      'security': 'sicherheit',
      'report': 'bericht',
      'overview': 'überblick',
      'the': 'der',
      'and': 'und',
      'of': 'von',
      'to': 'zu',
      'in': 'in',
      'for': 'für',
      'with': 'mit',
    },
  };

  const dict = dictionaries[targetLanguage] || dictionaries.Spanish;
  let result = text;

  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const rx = new RegExp(`\\b${key}\\b`, 'gi');
    result = result.replace(rx, (match) => {
      const replacement = dict[key];
      if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }

  return `[${targetLanguage.toUpperCase()} TRANSLATION]\n${result}`;
}
