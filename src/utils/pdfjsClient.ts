import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite static asset URL import
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PositionedTextItem } from './pdfHelpers';

// Configure local worker with automatic offline fallback
try {
  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }
} catch {
  // Fallback handled automatically by pdfjs-dist fake worker in non-browser or restricted environments
}

export { pdfjsLib };

export async function loadPdfJsDocument(
  bytes: Uint8Array,
  password?: string
): Promise<pdfjsLib.PDFDocumentProxy> {
  // Always pass a fresh copy of Uint8Array so pdfjs worker transfer doesn't detach the caller's ArrayBuffer
  const dataCopy = new Uint8Array(bytes);
  const loadingTask = pdfjsLib.getDocument({
    data: dataCopy,
    password: password || undefined,
    stopAtErrors: false,
  });
  return await loadingTask.promise;
}

export async function renderPdfPageToDataUrl(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber1Based: number,
  scale = 1.0,
  format: 'image/png' | 'image/jpeg' = 'image/jpeg',
  quality = 0.82,
  additionalRotation = 0
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNumber1Based);
  const baseViewport = page.getViewport({ scale: 1.0 });
  const totalRotation = (baseViewport.rotation + additionalRotation) % 360;
  const viewport = page.getViewport({ scale, rotation: totalRotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  } as any).promise;

  return {
    dataUrl: canvas.toDataURL(format, quality),
    width: baseViewport.width,
    height: baseViewport.height,
  };
}

export async function renderPdfPageToCanvas(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber1Based: number,
  scale = 1.5,
  additionalRotation = 0
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNumber1Based);
  const baseViewport = page.getViewport({ scale: 1.0 });
  const totalRotation = (baseViewport.rotation + additionalRotation) % 360;
  const viewport = page.getViewport({ scale, rotation: totalRotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  } as any).promise;

  return {
    canvas,
    width: baseViewport.width,
    height: baseViewport.height,
  };
}

/**
 * Extracts positioned text items across all pages of a PDF document.
 * Coordinates `x` and `y` are normalized to top-down PDF points (0,0 at top-left of page).
 */
export async function extractPositionedTextFromPdf(
  bytes: Uint8Array,
  password?: string
): Promise<{
  fullText: string;
  pageTexts: string[];
  items: PositionedTextItem[];
  pageDimensions: { width: number; height: number }[];
}> {
  const pdfDoc = await loadPdfJsDocument(bytes, password);
  const items: PositionedTextItem[] = [];
  const pageTexts: string[] = [];
  const pageDimensions: { width: number; height: number }[] = [];

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    pageDimensions.push({ width: viewport.width, height: viewport.height });

    const textContent = await page.getTextContent();
    const pageStrings: string[] = [];

    for (const rawItem of textContent.items as any[]) {
      if (!rawItem || typeof rawItem.str !== 'string') continue;
      const tx = rawItem.transform || [12, 0, 0, 12, 0, 0];
      const fontSize = Math.max(6, Math.hypot(tx[0], tx[1]) || Math.abs(tx[3]) || 11);
      const pdfX = tx[4] || 0;
      const pdfBottomY = tx[5] || 0;
      const width = rawItem.width || rawItem.str.length * fontSize * 0.52;
      const height = rawItem.height || fontSize * 1.15;
      // Convert PDF bottom-left Y into top-down Y
      const topDownY = Math.max(0, viewport.height - pdfBottomY - height * 0.85);

      pageStrings.push(rawItem.str);
      items.push({
        str: rawItem.str,
        x: pdfX,
        y: topDownY,
        width,
        height,
        fontSize,
        pageIndex: p - 1,
      });
    }

    pageTexts.push(pageStrings.join(' '));
  }

  return {
    fullText: pageTexts.join('\n\n'),
    pageTexts,
    items,
    pageDimensions,
  };
}
