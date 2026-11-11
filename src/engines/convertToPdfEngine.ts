import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { EngineOutput, UploadedFileItem } from '../types/pdf';

/**
 * Helper to decode any image format (JPG, PNG, WEBP, GIF, BMP, SVG) into JPEG/PNG bytes via HTML5 Canvas
 * so pdf-lib can embed all 6 image formats reliably.
 */
async function normalizeImageToEmbeddableBytes(
  file: UploadedFileItem
): Promise<{ bytes: Uint8Array; isPng: boolean; width: number; height: number }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg' || file.type === 'image/jpeg') {
    // Also read dimensions via Image if in browser
    if (typeof document !== 'undefined') {
      try {
        const dims = await getImageDimensions(file.bytes, 'image/jpeg');
        return { bytes: file.bytes, isPng: false, width: dims.width, height: dims.height };
      } catch {
        return { bytes: file.bytes, isPng: false, width: 600, height: 800 };
      }
    }
    return { bytes: file.bytes, isPng: false, width: 600, height: 800 };
  }

  if (ext === 'png' || file.type === 'image/png') {
    if (typeof document !== 'undefined') {
      try {
        const dims = await getImageDimensions(file.bytes, 'image/png');
        return { bytes: file.bytes, isPng: true, width: dims.width, height: dims.height };
      } catch {
        return { bytes: file.bytes, isPng: true, width: 600, height: 800 };
      }
    }
    return { bytes: file.bytes, isPng: true, width: 600, height: 800 };
  }

  // Convert WEBP, GIF, BMP, SVG via HTML5 Canvas into PNG
  const mime =
    ext === 'svg'
      ? 'image/svg+xml'
      : ext === 'webp'
      ? 'image/webp'
      : ext === 'gif'
      ? 'image/gif'
      : ext === 'bmp'
      ? 'image/bmp'
      : file.type || 'image/png';

  const blob = new Blob([file.bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode image ${file.name}`));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 800;
    canvas.height = img.naturalHeight || img.height || 600;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const pngDataUrl = canvas.toDataURL('image/png');
    const base64 = pngDataUrl.split(',')[1];
    const pngBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return { bytes: pngBytes, isPng: true, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getImageDimensions(
  bytes: Uint8Array,
  mime: string
): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Tool 10: JPG / Images to PDF
 * Supports JPG, PNG, WEBP, GIF, BMP, SVG with pageSize (Fit, A4, Letter),
 * orientation (portrait, landscape, auto), margin (none=0, small=20pt, large=50pt), and centering.
 */
export async function executeImagesToPdf(
  files: UploadedFileItem[],
  params: Record<string, any>
): Promise<EngineOutput> {
  if (files.length === 0) {
    throw new Error('Upload at least one image (JPG, PNG, WEBP, GIF, BMP, SVG).');
  }

  const pdfDoc = await PDFDocument.create();
  const beforeSize = files.reduce((s, f) => s + f.bytes.byteLength, 0);
  const marginPt =
    params.margin === 'none' ? 0 : params.margin === 'large' ? 50 : 20;

  for (const file of files) {
    const normalized = await normalizeImageToEmbeddableBytes(file);
    const embedded = normalized.isPng
      ? await pdfDoc.embedPng(normalized.bytes)
      : await pdfDoc.embedJpg(normalized.bytes);

    const imgW = embedded.width;
    const imgH = embedded.height;

    let pageW = 595.28;
    let pageH = 841.89;

    if (params.pageSize === 'Fit') {
      pageW = imgW + marginPt * 2;
      pageH = imgH + marginPt * 2;
    } else {
      if (params.pageSize === 'Letter') {
        pageW = 612;
        pageH = 792;
      }
      const isImgLandscape = imgW > imgH;
      if (
        params.orientation === 'landscape' ||
        (params.orientation === 'auto' && isImgLandscape)
      ) {
        const tmp = pageW;
        pageW = pageH;
        pageH = tmp;
      }
    }

    const page = pdfDoc.addPage([pageW, pageH]);
    const availW = Math.max(10, pageW - marginPt * 2);
    const availH = Math.max(10, pageH - marginPt * 2);
    const scale = params.pageSize === 'Fit' ? 1 : Math.min(availW / imgW, availH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;

    const x = params.centerImage !== false ? (pageW - drawW) / 2 : marginPt;
    const y = params.centerImage !== false ? (pageH - drawH) / 2 : pageH - marginPt - drawH;

    page.drawImage(embedded, {
      x,
      y,
      width: drawW,
      height: drawH,
    });
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `images_compiled_${pdfDoc.getPageCount()}p.pdf`,
    mimeType: 'application/pdf',
    beforeSize,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Compiled ${files.length} image(s) into a ${pdfDoc.getPageCount()}-page PDF.`,
  };
}

/**
 * Helper to word-wrap a paragraph of text to fit within maxWidth in points.
 */
function wrapTextLines(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const safe = text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
  if (!safe) return [''];
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Tool 11: WORD to PDF (.docx -> .pdf)
 * Parses .docx files offline using Mammoth to extract structured HTML/text, headings, lists,
 * and paginates them into a multi-page pdf-lib document.
 */
export async function executeWordToPdf(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  let extractedHtml = '';
  let extractedRawText = '';

  try {
    const arrayBuffer = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength
    ) as ArrayBuffer;
    const htmlRes = await mammoth.convertToHtml({ arrayBuffer });
    extractedHtml = htmlRes.value || '';
    const rawRes = await mammoth.extractRawText({ arrayBuffer });
    extractedRawText = rawRes.value || '';
  } catch {
    extractedRawText = new TextDecoder().decode(file.bytes);
  }

  return await renderStructuredMarkupToPdf(
    extractedHtml || extractedRawText,
    extractedHtml ? 'html' : 'markdown',
    file.name.replace(/\.(docx|doc)$/i, '') + '.pdf',
    file.bytes.byteLength,
    params
  );
}

/**
 * Tool 12: POWERPOINT to PDF (.pptx -> .pdf)
 * Unzips .pptx archives in memory using JSZip, parses ppt/slides/slide*.xml text and media relationships,
 * and renders each slide onto a 16:9 landscape PDF page (960 x 540 pt).
 */
export async function executePowerpointToPdf(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const isDark = params.theme === 'dark';
  const slideW = 960;
  const slideH = 540;

  let slideTexts: { slideNumber: number; paragraphs: string[] }[] = [];

  try {
    const zip = await JSZip.loadAsync(file.bytes);
    const slideFiles = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
        return na - nb;
      });

    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('string');
      // Parse paragraph blocks <a:p> and text runs <a:t>
      const pBlocks = xml.split(/<\/a:p>/i);
      const paragraphs: string[] = [];
      for (const block of pBlocks) {
        const matches = Array.from(block.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi));
        if (matches.length > 0) {
          const textLine = matches
            .map((m) =>
              m[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
            )
            .join('')
            .trim();
          if (textLine) paragraphs.push(textLine);
        }
      }
      slideTexts.push({ slideNumber: i + 1, paragraphs });
    }
  } catch {
    const fallbackText = new TextDecoder().decode(file.bytes);
    slideTexts = [{ slideNumber: 1, paragraphs: fallbackText.split('\n').filter(Boolean) }];
  }

  if (slideTexts.length === 0) {
    slideTexts = [
      {
        slideNumber: 1,
        paragraphs: [file.name, 'Presentation converted via MONO PDF Offline PPTX Engine'],
      },
    ];
  }

  for (const slide of slideTexts) {
    const page = pdfDoc.addPage([slideW, slideH]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: slideW,
      height: slideH,
      color: isDark ? rgb(0.06, 0.06, 0.07) : rgb(0.99, 0.99, 0.99),
    });

    // Top structural hairline
    page.drawRectangle({
      x: 48,
      y: slideH - 42,
      width: slideW - 96,
      height: 1.5,
      color: isDark ? rgb(0.25, 0.25, 0.28) : rgb(0.12, 0.12, 0.14),
    });

    let y = slideH - 90;
    slide.paragraphs.forEach((para, idx) => {
      const isTitle = idx === 0;
      const fSize = isTitle ? 28 : 16;
      const activeFont = isTitle ? fontBold : fontRegular;
      const lines = wrapTextLines(para, activeFont, fSize, slideW - 110);

      for (const line of lines) {
        if (y < 55) break;
        page.drawText(line, {
          x: isTitle ? 48 : 64,
          y,
          size: fSize,
          font: activeFont,
          color: isDark ? rgb(0.95, 0.95, 0.96) : rgb(0.08, 0.08, 0.1),
        });
        y -= fSize * 1.45;
      }
      y -= isTitle ? 18 : 8;
    });

    if (params.includeSlideNumbers !== false) {
      page.drawText(`SLIDE ${String(slide.slideNumber).padStart(2, '0')} / ${String(slideTexts.length).padStart(2, '0')}`, {
        x: slideW - 140,
        y: 24,
        size: 10,
        font: fontMono,
        color: rgb(0.5, 0.5, 0.52),
      });
    }
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.(pptx|ppt)$/i, '')}_slides.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Rendered ${pdfDoc.getPageCount()} 16:9 presentation slide(s) to PDF.`,
  };
}

/**
 * Tool 13: EXCEL to PDF (.xlsx, .xls, .csv -> .pdf)
 * Parses spreadsheets using SheetJS (xlsx) and draws formatted monochrome data tables
 * with headers and cell borders across paginated PDF sheets.
 */
export async function executeExcelToPdf(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  const workbook = XLSX.read(file.bytes, { type: 'array' });
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const isLandscape = params.orientation !== 'portrait';
  const pageW = isLandscape ? 841.89 : 595.28;
  const pageH = isLandscape ? 595.28 : 841.89;
  const margin = 36;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    if (rows.length === 0) continue;

    const maxCols = Math.max(1, ...rows.map((r) => r.length));
    const tableW = pageW - margin * 2;
    const colW = tableW / Math.min(maxCols, 12);
    const rowH = 20;

    let page = pdfDoc.addPage([pageW, pageH]);
    let y = pageH - margin - 20;

    // Sheet Title
    page.drawText(`SHEET: ${sheetName.toUpperCase()}`, {
      x: margin,
      y,
      size: 12,
      font: fontBold,
      color: rgb(0.08, 0.08, 0.1),
    });
    y -= 24;

    const headerRow = rows[0] || [];

    const drawRow = (rowCells: any[], isHeader: boolean) => {
      if (isHeader) {
        page.drawRectangle({
          x: margin,
          y: y - 4,
          width: tableW,
          height: rowH,
          color: rgb(0.12, 0.12, 0.14),
        });
      } else if (params.showGridlines !== false) {
        page.drawRectangle({
          x: margin,
          y: y - 4,
          width: tableW,
          height: rowH,
          borderColor: rgb(0.82, 0.82, 0.85),
          borderWidth: 0.5,
        });
      }

      const numCols = Math.min(rowCells.length, 12);
      for (let c = 0; c < numCols; c++) {
        const cellVal = String(rowCells[c] ?? '').replace(/[^\x20-\x7E]/g, ' ').trim();
        const maxChars = Math.max(4, Math.floor((colW - 8) / 5.5));
        const clipped = cellVal.length > maxChars ? cellVal.slice(0, maxChars - 1) + '…' : cellVal;
        page.drawText(clipped, {
          x: margin + c * colW + 5,
          y: y + 2,
          size: 8.5,
          font: isHeader ? fontBold : fontMono,
          color: isHeader ? rgb(0.98, 0.98, 0.98) : rgb(0.12, 0.12, 0.14),
        });
      }
      y -= rowH;
    };

    for (let r = 0; r < rows.length; r++) {
      if (y < margin + rowH) {
        page = pdfDoc.addPage([pageW, pageH]);
        y = pageH - margin - 20;
        if (params.repeatHeaderRow !== false && r > 0) {
          drawRow(headerRow, true);
        }
      }
      drawRow(rows[r], r === 0);
    }
  }

  if (pdfDoc.getPageCount() === 0) {
    pdfDoc.addPage([pageW, pageH]);
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.(xlsx|xls|csv)$/i, '')}_table.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Compiled ${workbook.SheetNames.length} spreadsheet sheet(s) into ${pdfDoc.getPageCount()} PDF page(s).`,
  };
}

/**
 * Shared structured HTML / Markdown vector PDF compiler for Tools 11 & 14.
 */
export async function renderStructuredMarkupToPdf(
  content: string,
  format: 'markdown' | 'html',
  outputFilename: string,
  beforeSize: number,
  params: Record<string, any>
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const pageW = params.pageSize === 'Letter' ? 612 : 595.28;
  const pageH = params.pageSize === 'Letter' ? 792 : 841.89;
  const margin = 48;
  const maxW = pageW - margin * 2;
  const baseFontSize = Number(params.fontSize || 11);

  // Normalize HTML tags into Markdown-like structural lines if format is HTML
  let normalizedText = content || '';
  if (format === 'html' || /<\/?[a-z][\s\S]*>/i.test(normalizedText)) {
    normalizedText = normalizedText
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  };

  const rawLines = normalizedText.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y -= baseFontSize * 0.65;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      const size = baseFontSize * 1.75;
      ensureSpace(size * 2);
      y -= 8;
      const lines = wrapTextLines(trimmed.slice(2), fontBold, size, maxW);
      for (const l of lines) {
        ensureSpace(size * 1.35);
        page.drawText(l, { x: margin, y, size, font: fontBold, color: rgb(0.05, 0.05, 0.06) });
        y -= size * 1.35;
      }
      page.drawRectangle({ x: margin, y: y + 4, width: maxW, height: 1, color: rgb(0.85, 0.85, 0.88) });
      y -= 8;
    } else if (trimmed.startsWith('## ')) {
      const size = baseFontSize * 1.4;
      ensureSpace(size * 1.8);
      y -= 6;
      const lines = wrapTextLines(trimmed.slice(3), fontBold, size, maxW);
      for (const l of lines) {
        ensureSpace(size * 1.35);
        page.drawText(l, { x: margin, y, size, font: fontBold, color: rgb(0.08, 0.08, 0.1) });
        y -= size * 1.35;
      }
      y -= 4;
    } else if (trimmed.startsWith('### ')) {
      const size = baseFontSize * 1.18;
      ensureSpace(size * 1.6);
      const lines = wrapTextLines(trimmed.slice(4), fontBold, size, maxW);
      for (const l of lines) {
        ensureSpace(size * 1.35);
        page.drawText(l, { x: margin, y, size, font: fontBold, color: rgb(0.12, 0.12, 0.15) });
        y -= size * 1.35;
      }
    } else if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Markdown table row
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      const rowH = 18;
      ensureSpace(rowH + 4);
      const colW = maxW / Math.max(cells.length, 1);
      page.drawRectangle({
        x: margin,
        y: y - 4,
        width: maxW,
        height: rowH,
        borderColor: rgb(0.8, 0.8, 0.82),
        borderWidth: 0.5,
      });
      cells.forEach((cell, idx) => {
        const cleanCell = cell.replace(/\*\*/g, '');
        page.drawText(cleanCell.slice(0, 28), {
          x: margin + idx * colW + 6,
          y: y + 1,
          size: 9,
          font: fontMono,
          color: rgb(0.12, 0.12, 0.14),
        });
      });
      y -= rowH;
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const cleanItem = trimmed.slice(2).replace(/\*\*(.*?)\*\*/g, '$1');
      const lines = wrapTextLines(`• ${cleanItem}`, fontRegular, baseFontSize, maxW - 14);
      for (const l of lines) {
        ensureSpace(baseFontSize * 1.45);
        page.drawText(l, { x: margin + 10, y, size: baseFontSize, font: fontRegular, color: rgb(0.12, 0.12, 0.14) });
        y -= baseFontSize * 1.45;
      }
    } else {
      const cleanPara = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1');
      const lines = wrapTextLines(cleanPara, fontRegular, baseFontSize, maxW);
      for (const l of lines) {
        ensureSpace(baseFontSize * 1.45);
        page.drawText(l, { x: margin, y, size: baseFontSize, font: fontRegular, color: rgb(0.14, 0.14, 0.16) });
        y -= baseFontSize * 1.45;
      }
    }
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: outputFilename,
    mimeType: 'application/pdf',
    beforeSize: beforeSize || new TextEncoder().encode(content).byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Compiled markup into ${pdfDoc.getPageCount()}-page vector PDF.`,
  };
}

/**
 * Tool 14: HTML / Markdown to PDF
 */
export async function executeHtmlToPdf(
  file: UploadedFileItem | null,
  params: Record<string, any>
): Promise<EngineOutput> {
  let content = params.rawContent || '';
  let beforeSize = new TextEncoder().encode(content).byteLength;
  let outName = 'compiled_markup.pdf';

  if (file) {
    content = new TextDecoder().decode(file.bytes);
    beforeSize = file.bytes.byteLength;
    outName = file.name.replace(/\.(html|htm|md|markdown|txt)$/i, '') + '.pdf';
  }

  return await renderStructuredMarkupToPdf(
    content,
    params.sourceFormat === 'html' ? 'html' : 'markdown',
    outName,
    beforeSize,
    params
  );
}
