import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { marked } from 'marked';
import html2canvas from 'html2canvas-pro';
import { EngineOutput } from '../types/pdf';

/**
 * Strips executable scripts and inline JS event handlers from user HTML
 * while preserving CSS <style>, inline styles, tables, images, and semantic structure.
 */
export function sanitizeHtmlForRendering(rawHtml: string): string {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, 'blocked:');
}

/**
 * Detects whether a string is likely HTML markup rather than Markdown.
 */
export function detectMarkupFormat(content: string, filename?: string): 'html' | 'markdown' {
  const lowerName = (filename || '').toLowerCase();
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'html';
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'markdown';

  const trimmed = (content || '').trim();
  if (!trimmed) return 'html';
  if (
    /^<!doctype\s+html/i.test(trimmed) ||
    /<html[\s>]/i.test(trimmed) ||
    /<head[\s>]/i.test(trimmed) ||
    /<body[\s>]/i.test(trimmed) ||
    /<style[\s>]/i.test(trimmed) ||
    /<(div|section|article|header|footer|table|tr|td|h1|h2|h3|p|ul|ol|span)\b[^>]*>[\s\S]*<\/\1>/i.test(
      trimmed
    )
  ) {
    return 'html';
  }
  return 'markdown';
}

const DEFAULT_PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #18181b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .pdf-doc-body {
    padding: 40px 48px;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  h1 { font-size: 2em; font-weight: 700; margin: 0 0 0.5em 0; padding-bottom: 0.25em; border-bottom: 1.5px solid #e4e4e7; line-height: 1.25; }
  h2 { font-size: 1.45em; font-weight: 700; margin: 1.25em 0 0.45em 0; line-height: 1.3; }
  h3 { font-size: 1.18em; font-weight: 600; margin: 1em 0 0.4em 0; }
  p { margin: 0 0 0.85em 0; }
  ul, ol { margin: 0 0 0.9em 0; padding-left: 1.5em; }
  li { margin: 0.25em 0; }
  blockquote { margin: 0.9em 0; padding: 0.5em 1em; border-left: 3px solid #27272a; background: #f4f4f5; color: #3f3f46; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.88em; background: #f4f4f5; padding: 0.15em 0.35em; border-radius: 4px; }
  pre { background: #18181b; color: #fafafa; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 0.85em; line-height: 1.5; margin: 0 0 1em 0; }
  pre code { background: transparent; color: inherit; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.92em; }
  th, td { border: 1px solid #d4d4d8; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; }
  img { max-width: 100%; height: auto; display: block; margin: 0.75em 0; }
  hr { border: 0; border-top: 1px solid #d4d4d8; margin: 1.25em 0; }
`;

/**
 * Builds a complete, sanitized, standalone HTML document suitable for both
 * live iframe preview and high-DPI PDF rendering.
 */
export function buildPrintableHtmlDocument(
  content: string,
  format: 'html' | 'markdown',
  baseFontSizePt = 11
): string {
  const fontPx = Math.round(baseFontSizePt * 1.333);

  if (format === 'markdown') {
    const renderedMd = marked.parse(content || '', {
      gfm: true,
      breaks: true,
      async: false,
    }) as string;
    const safeBody = sanitizeHtmlForRendering(renderedMd);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
${DEFAULT_PRINT_CSS}
body { font-size: ${fontPx}px; }
</style>
</head>
<body>
<div class="pdf-doc-body">${safeBody}</div>
</body>
</html>`;
  }

  // HTML mode: preserve full user CSS, <head> styles, and document layout
  const sanitized = sanitizeHtmlForRendering(content || '');
  const hasHtmlWrapper = /<html[\s>]/i.test(sanitized) && /<body[\s>]/i.test(sanitized);

  if (hasHtmlWrapper) {
    // Inject minimal safe print reset before </head> without overriding user styles
    const baseReset = `<style>html, body { background-color: #ffffff; } img { max-width: 100%; height: auto; }</style>`;
    if (/<\/head>/i.test(sanitized)) {
      return sanitized.replace(/<\/head>/i, `${baseReset}</head>`);
    }
    return sanitized.replace(/<body/i, `<head>${baseReset}</head><body`);
  }

  // Fragment HTML (e.g., <h1>Title</h1><p>...</p> or <style>...</style><div>...</div>)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
${DEFAULT_PRINT_CSS}
body { font-size: ${fontPx}px; }
</style>
</head>
<body>
<div class="pdf-doc-body">${sanitized}</div>
</body>
</html>`;
}

/**
 * Extracts clean plain text from HTML (stripping style, script, head, comments)
 * for non-browser fallback or invisible search layer.
 */
export function stripHtmlToCleanPlainText(html: string): string {
  return (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/(p|div|tr|section|article|header|footer|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface TextBoundingBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * Renders real styled HTML or Markdown inside an isolated same-origin iframe,
 * captures crisp high-DPI page slices with html2canvas-pro, paginates cleanly into pdf-lib,
 * and embeds an invisible searchable text layer at real DOM coordinates.
 */
export async function renderHtmlOrMarkdownToPdf(
  content: string,
  format: 'html' | 'markdown',
  outputFilename: string,
  beforeSize: number,
  params: Record<string, any> = {}
): Promise<EngineOutput> {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    throw new Error('Enter HTML/Markdown content or upload a file before converting to PDF.');
  }

  const pageSize = params.pageSize === 'Letter' ? 'Letter' : 'A4';
  const pageWpt = pageSize === 'Letter' ? 612 : 595.28;
  const pageHpt = pageSize === 'Letter' ? 792 : 841.89;
  const baseFontSize = Number(params.fontSize || 11);

  // Non-browser fallback (e.g., Node unit tests)
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return await renderPlainTextFallbackPdf(
      format === 'html' ? stripHtmlToCleanPlainText(trimmed) : trimmed,
      outputFilename,
      beforeSize,
      pageWpt,
      pageHpt,
      baseFontSize
    );
  }

  // Exact CSS pixel dimensions at 96 DPI (1pt = 96/72 px = 1.3333px)
  const PT_TO_PX = 96 / 72;
  const pageWpx = Math.round(pageWpt * PT_TO_PX); // 794px for A4, 816px for Letter
  const pageHpx = Math.round(pageHpt * PT_TO_PX); // 1123px for A4, 1056px for Letter
  const renderScale = 2; // 192 DPI crisp output

  const htmlDocString = buildPrintableHtmlDocument(trimmed, format, baseFontSize);

  // Yield a frame so the UI renders processing state cleanly before offscreen layout
  await new Promise((resolve) => setTimeout(resolve, 16));

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${pageWpx}px`;
  iframe.style.height = `${pageHpx}px`;
  iframe.style.border = 'none';
  iframe.style.background = '#ffffff';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';

  try {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      iframe.addEventListener('load', finish, { once: true });
      setTimeout(finish, 1800);
      iframe.srcdoc = htmlDocString;
      document.body.appendChild(iframe);
    });

    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc || !iframeDoc.body) {
      throw new Error('Unable to initialize isolated HTML rendering frame.');
    }

    // Wait for layout, styles, and embedded images to finish loading
    await new Promise<void>((resolve) => {
      const imgs = Array.from(iframeDoc.images || []);
      if (imgs.length === 0) {
        setTimeout(resolve, 100);
        return;
      }
      let settled = 0;
      const done = () => {
        settled++;
        if (settled >= imgs.length) setTimeout(resolve, 80);
      };
      const safetyTimer = setTimeout(resolve, 1500);
      imgs.forEach((img) => {
        if (img.complete) {
          done();
        } else {
          img.addEventListener('load', () => {
            clearTimeout(safetyTimer);
            done();
          });
          img.addEventListener('error', () => {
            clearTimeout(safetyTimer);
            done();
          });
        }
      });
    });

    const body = iframeDoc.body;
    const docEl = iframeDoc.documentElement;
    const totalHeightPx = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      docEl.scrollHeight,
      pageHpx
    );
    iframe.style.height = `${totalHeightPx}px`;

    // Collect text node bounding boxes for an invisible selectable/searchable text layer
    const textBoxes: TextBoundingBox[] = [];
    const walker = iframeDoc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      const parentTag = currentNode.parentElement?.tagName?.toUpperCase();
      if (parentTag === 'STYLE' || parentTag === 'SCRIPT' || parentTag === 'NOSCRIPT') continue;
      const rawText = currentNode.textContent?.replace(/\s+/g, ' ').trim();
      if (!rawText) continue;
      const range = iframeDoc.createRange();
      range.selectNodeContents(currentNode);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const computed = currentNode.parentElement
          ? iframe.contentWindow?.getComputedStyle(currentNode.parentElement)
          : null;
        const fSizePx = computed ? parseFloat(computed.fontSize) || 14 : 14;
        textBoxes.push({
          text: rawText,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          fontSize: Math.max(6, fSizePx / PT_TO_PX),
        });
      }
    }

    // Collect block element bottoms to compute smart page break Y positions (avoid cutting text mid-line)
    const blockBottoms: number[] = [];
    const blockEls = body.querySelectorAll('p, h1, h2, h3, h4, li, tr, pre, blockquote, hr, img, div');
    blockEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < pageHpx * 0.85) {
        blockBottoms.push(Math.round(r.bottom));
      }
    });

    // Capture full styled document via html2canvas-pro at 2x DPI
    const fullCanvas = await html2canvas(body, {
      scale: renderScale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: pageWpx,
      height: totalHeightPx,
      windowWidth: pageWpx,
      windowHeight: totalHeightPx,
      logging: false,
    });

    // Compute clean page break ranges in CSS pixels
    const pageBreaks: { startY: number; endY: number }[] = [];
    let cursorY = 0;
    const minPageFill = pageHpx * 0.65;

    while (cursorY < totalHeightPx) {
      let targetEnd = cursorY + pageHpx;
      if (targetEnd >= totalHeightPx) {
        pageBreaks.push({ startY: cursorY, endY: totalHeightPx });
        break;
      }

      // Look for a clean block boundary slightly before targetEnd
      const candidates = blockBottoms.filter(
        (b) => b > cursorY + minPageFill && b <= targetEnd - 12
      );
      if (candidates.length > 0) {
        targetEnd = Math.max(...candidates) + 6;
      }

      pageBreaks.push({ startY: cursorY, endY: targetEnd });
      cursorY = targetEnd;
    }

    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const slice of pageBreaks) {
      const sliceHeightPx = Math.max(1, slice.endY - slice.startY);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = pageWpx * renderScale;
      sliceCanvas.height = pageHpx * renderScale;
      const ctx = sliceCanvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);

      const srcY = Math.round(slice.startY * renderScale);
      const srcH = Math.min(
        Math.round(sliceHeightPx * renderScale),
        fullCanvas.height - srcY
      );

      if (srcH > 0) {
        ctx.drawImage(
          fullCanvas,
          0,
          srcY,
          fullCanvas.width,
          srcH,
          0,
          0,
          sliceCanvas.width,
          srcH
        );
      }

      const jpgDataUrl = sliceCanvas.toDataURL('image/jpeg', 0.94);
      const base64 = jpgDataUrl.split(',')[1];
      const jpgBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const embeddedImg = await pdfDoc.embedJpg(jpgBytes);

      const pdfPage = pdfDoc.addPage([pageWpt, pageHpt]);
      pdfPage.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: pageWpt,
        height: pageHpt,
      });

      // Overlay invisible searchable/selectable text layer for this page slice
      const pageBoxes = textBoxes.filter(
        (tb) => tb.y >= slice.startY - 2 && tb.y < slice.endY
      );
      for (const tb of pageBoxes) {
        const safeAscii = tb.text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
        if (!safeAscii) continue;
        const pdfX = Math.max(0, tb.x / PT_TO_PX);
        const relY = (tb.y - slice.startY) / PT_TO_PX;
        const pdfY = Math.max(4, pageHpt - relY - tb.fontSize);
        try {
          pdfPage.drawText(safeAscii, {
            x: pdfX,
            y: pdfY,
            size: Math.min(24, Math.max(6, tb.fontSize)),
            font: fontRegular,
            color: rgb(0, 0, 0),
            opacity: 0.005,
          });
        } catch {
          // Skip unsupported glyphs in invisible text overlay (already visibly rendered in high-DPI canvas!)
        }
      }
    }

    const outBytes = await pdfDoc.save({ useObjectStreams: true });
    return {
      bytes: outBytes,
      filename: outputFilename,
      mimeType: 'application/pdf',
      beforeSize: beforeSize || new TextEncoder().encode(trimmed).byteLength,
      afterSize: outBytes.byteLength,
      pageCount: pdfDoc.getPageCount(),
      canChainAsPdf: true,
      summaryMessage: `Rendered ${format.toUpperCase()} into ${pdfDoc.getPageCount()}-page styled PDF (${pageSize}, searchable text layer embedded).`,
    };
  } finally {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }
}

async function renderPlainTextFallbackPdf(
  plainText: string,
  outputFilename: string,
  beforeSize: number,
  pageW: number,
  pageH: number,
  baseFontSize: number
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const maxW = pageW - margin * 2;
  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  };

  for (const rawLine of plainText.split(/\r?\n/)) {
    const line = rawLine.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
    if (!line) {
      y -= baseFontSize * 0.7;
      continue;
    }
    const isHeading = line.startsWith('# ');
    const text = isHeading ? line.slice(2) : line;
    const size = isHeading ? baseFontSize * 1.5 : baseFontSize;
    const font = isHeading ? fontBold : fontRegular;
    const words = text.split(/\s+/);
    let current = '';
    for (const w of words) {
      const cand = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) <= maxW || !current) {
        current = cand;
      } else {
        ensureSpace(size * 1.4);
        page.drawText(current, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.12) });
        y -= size * 1.4;
        current = w;
      }
    }
    if (current) {
      ensureSpace(size * 1.4);
      page.drawText(current, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= size * 1.4;
    }
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: outputFilename,
    mimeType: 'application/pdf',
    beforeSize: beforeSize || new TextEncoder().encode(plainText).byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Compiled into ${pdfDoc.getPageCount()}-page PDF.`,
  };
}
