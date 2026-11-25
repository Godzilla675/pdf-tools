import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { EngineOutput, UploadedFileItem } from '../types/pdf';
import {
  detectMarkupFormat,
  renderHtmlOrMarkdownToPdf,
} from '../utils/htmlPdfRenderer';
import { renderPptxToExactPdf } from '../utils/pptxToPdfRenderer';

/**
 * Helper to decode any image format (JPG, PNG, WEBP, GIF, BMP, SVG) into JPEG/PNG bytes via HTML5 Canvas
 * so pdf-lib can embed all 6 image formats reliably.
 */
async function normalizeImageToEmbeddableBytes(
  file: UploadedFileItem
): Promise<{ bytes: Uint8Array; isPng: boolean; width: number; height: number }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg' || file.type === 'image/jpeg') {
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
      img.onload = () =>
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
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
  const marginPt = params.margin === 'none' ? 0 : params.margin === 'large' ? 50 : 20;

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
 * Tool 11: WORD to PDF (.docx -> .pdf)
 * Parses .docx files offline using Mammoth to extract rich HTML (headings, bold/italic, lists,
 * tables, and embedded images) and renders it via our real browser HTML-to-PDF engine.
 */
export async function executeWordToPdf(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'doc') {
    throw new Error(
      'Legacy binary .doc files are not supported offline. Please save as .docx in Word / Google Docs and upload the .docx file.'
    );
  }

  let extractedHtml = '';
  try {
    const arrayBuffer = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength
    ) as ArrayBuffer;
    const htmlRes = await mammoth.convertToHtml({ arrayBuffer });
    extractedHtml = (htmlRes.value || '').trim();
  } catch (err: any) {
    throw new Error(
      `Could not parse "${file.name}" as a valid Word (.docx) archive (${err?.message || 'invalid file'}).`
    );
  }

  if (!extractedHtml) {
    throw new Error(`No readable document content found inside "${file.name}".`);
  }

  return await renderHtmlOrMarkdownToPdf(
    extractedHtml,
    'html',
    file.name.replace(/\.(docx|doc)$/i, '') + '.pdf',
    file.bytes.byteLength,
    params
  );
}

/**
 * Tool 12: POWERPOINT to PDF (.pptx -> .pdf)
 * Full OOXML layout renderer: preserves exact slide dimensions, slide master/layout inheritance,
 * theme colors/fonts, gradients, shapes/connectors, cropped images, tables, charts, typography,
 * and embeds an invisible searchable PDF text layer.
 */
export async function executePowerpointToPdf(
  file: UploadedFileItem,
  params: Record<string, any>,
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'ppt') {
    throw new Error(
      'Legacy binary .ppt files are not supported offline. Please save your presentation as .pptx in PowerPoint, Keynote, or Google Slides and upload the .pptx file.'
    );
  }
  return await renderPptxToExactPdf(file.bytes, file.name, params, onProgress);
}

/**
 * Tool 13: EXCEL to PDF (.xlsx, .xls, .csv -> .pdf)
 * Parses spreadsheets using SheetJS (xlsx) and draws proportionally auto-sized monochrome data tables
 * with headers, gridlines, and page-break header repetition across paginated PDF sheets.
 */
export async function executeExcelToPdf(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file.bytes, { type: 'array' });
  } catch (err: any) {
    throw new Error(`Could not parse spreadsheet "${file.name}": ${err?.message || 'Invalid format'}`);
  }

  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const isLandscape = params.orientation !== 'portrait';
  const pageW = isLandscape ? 841.89 : 595.28;
  const pageH = isLandscape ? 595.28 : 841.89;
  const margin = 36;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    if (rows.length === 0) continue;

    const numCols = Math.min(Math.max(1, ...rows.map((r) => r.length)), 14);
    const tableW = pageW - margin * 2;

    // Auto-calculate proportional column widths based on max text lengths in each column
    const colCharWeights = new Array<number>(numCols).fill(6);
    for (let r = 0; r < Math.min(rows.length, 200); r++) {
      for (let c = 0; c < numCols; c++) {
        const len = String(rows[r]?.[c] ?? '').trim().length;
        colCharWeights[c] = Math.min(36, Math.max(colCharWeights[c], len + 2));
      }
    }
    const totalWeight = colCharWeights.reduce((a, b) => a + b, 0);
    const colWidths = colCharWeights.map((w) => (w / totalWeight) * tableW);
    const colOffsets: number[] = [];
    let runningX = margin;
    for (let c = 0; c < numCols; c++) {
      colOffsets.push(runningX);
      runningX += colWidths[c];
    }

    const rowH = 20;
    const fontSize = numCols > 10 ? 7.5 : 8.5;

    let page = pdfDoc.addPage([pageW, pageH]);
    let y = pageH - margin - 18;

    const safeSheetTitle = sheetName.replace(/[^\x20-\x7E]/g, ' ').toUpperCase();
    page.drawText(`SHEET: ${safeSheetTitle}`, {
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

      for (let c = 0; c < numCols; c++) {
        if (!isHeader && params.showGridlines !== false && c > 0) {
          page.drawLine({
            start: { x: colOffsets[c], y: y - 4 },
            end: { x: colOffsets[c], y: y - 4 + rowH },
            thickness: 0.4,
            color: rgb(0.86, 0.86, 0.88),
          });
        }

        const cellVal = String(rowCells?.[c] ?? '')
          .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
          .trim();
        const activeFont = isHeader ? fontBold : fontMono;
        const availW = Math.max(12, colWidths[c] - 8);
        let clipped = cellVal;
        while (clipped.length > 1 && activeFont.widthOfTextAtSize(clipped, fontSize) > availW) {
          clipped = clipped.slice(0, -1);
        }
        if (clipped.length < cellVal.length && clipped.length > 2) {
          clipped = clipped.slice(0, -2) + '..';
        }

        page.drawText(clipped, {
          x: colOffsets[c] + 4,
          y: y + 2,
          size: fontSize,
          font: activeFont,
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
    throw new Error(`No worksheet rows found inside "${file.name}".`);
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
 * Shared HTML / Markdown renderer export for AI tools & Word to PDF.
 */
export async function renderStructuredMarkupToPdf(
  content: string,
  format: 'markdown' | 'html',
  outputFilename: string,
  beforeSize: number,
  params: Record<string, any>
): Promise<EngineOutput> {
  return await renderHtmlOrMarkdownToPdf(content, format, outputFilename, beforeSize, params);
}

/**
 * Tool 14: HTML / Markdown to PDF
 * Renders real styled HTML (with CSS, tables, layout, colors, images) or GFM Markdown
 * into a multi-page PDF with an embedded searchable text layer.
 */
export async function executeHtmlToPdf(
  file: UploadedFileItem | null,
  params: Record<string, any>
): Promise<EngineOutput> {
  const editorContent = String(params.rawContent || '');
  let content = editorContent;
  let beforeSize = new TextEncoder().encode(content).byteLength;
  let outName = 'document.pdf';

  if (file) {
    outName = file.name.replace(/\.(html|htm|md|markdown|txt)$/i, '') + '.pdf';
    if (!content.trim()) {
      content = new TextDecoder().decode(file.bytes);
      beforeSize = file.bytes.byteLength;
    }
  }

  if (!content.trim()) {
    throw new Error('Paste HTML or Markdown into the editor, or upload an .html / .md file first.');
  }

  // Respect explicit toggle, but auto-upgrade to HTML if user pasted full HTML while Markdown tab was selected
  let effectiveFormat: 'html' | 'markdown' =
    params.sourceFormat === 'markdown' ? 'markdown' : 'html';
  if (effectiveFormat === 'markdown' && detectMarkupFormat(content) === 'html') {
    effectiveFormat = 'html';
  }

  return await renderHtmlOrMarkdownToPdf(content, effectiveFormat, outName, beforeSize, params);
}
