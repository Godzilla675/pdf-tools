import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import {
  EngineOutput,
  EngineSecondaryFile,
  RenderedPageThumbnail,
  UploadedFileItem,
} from '../types/pdf';
import { parsePageRanges, parseSplitGroups } from '../utils/pdfHelpers';
import { extractPositionedTextFromPdf } from '../utils/pdfjsClient';

/**
 * Tool 1: Merge PDF
 * Merges multiple PDFs in custom or A-Z / Z-A order, supporting all pages or visually selected pages.
 */
export async function executeMergePdf(
  files: UploadedFileItem[],
  thumbnails: RenderedPageThumbnail[],
  params: Record<string, any>
): Promise<EngineOutput> {
  if (files.length === 0) {
    throw new Error('Upload at least one PDF file to merge.');
  }

  let orderedFiles = [...files];
  if (params.sortOrder === 'az') {
    orderedFiles.sort((a, b) => a.name.localeCompare(b.name));
  } else if (params.sortOrder === 'za') {
    orderedFiles.sort((a, b) => b.name.localeCompare(a.name));
  }

  const beforeSize = orderedFiles.reduce((acc, f) => acc + f.bytes.byteLength, 0);
  const mergedPdf = await PDFDocument.create();

  if (params.selectionMode === 'selected' && thumbnails.some((t) => t.selected)) {
    const selectedThumbs = thumbnails.filter((t) => t.selected);
    const loadedMap = new Map<string, PDFDocument>();
    for (const f of orderedFiles) {
      loadedMap.set(f.id, await PDFDocument.load(f.bytes, { ignoreEncryption: true }));
    }
    for (const thumb of selectedThumbs) {
      if (thumb.isBlank) {
        mergedPdf.addPage([thumb.width || 595.28, thumb.height || 841.89]);
        continue;
      }
      const srcDoc = loadedMap.get(thumb.sourceFileId);
      if (srcDoc && thumb.originalPageIndex < srcDoc.getPageCount()) {
        const [copiedPage] = await mergedPdf.copyPages(srcDoc, [thumb.originalPageIndex]);
        if (thumb.rotation) {
          const currentRot = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees((currentRot + thumb.rotation) % 360));
        }
        mergedPdf.addPage(copiedPage);
      }
    }
  } else {
    for (const file of orderedFiles) {
      const srcDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
      const indices = srcDoc.getPageIndices();
      const copiedPages = await mergedPdf.copyPages(srcDoc, indices);
      for (const p of copiedPages) {
        mergedPdf.addPage(p);
      }
    }
  }

  const outBytes = await mergedPdf.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `merged_${orderedFiles.length}_files.pdf`,
    mimeType: 'application/pdf',
    beforeSize,
    afterSize: outBytes.byteLength,
    pageCount: mergedPdf.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Merged ${orderedFiles.length} file(s) into ${mergedPdf.getPageCount()} total pages.`,
  };
}

/**
 * Tool 2: Split PDF
 * Modes:
 *  - 'ranges': Custom Page Ranges (e.g. 1-3, 5, 7-9)
 *  - 'interval': Fixed Page Interval (every N pages)
 *  - 'burst': Burst All Pages into individual PDFs inside a .zip
 *  - 'smart': Smart Content Split via pdfjs-dist boundary markers ("Invoice #", "Chapter", etc.)
 */
export async function executeSplitPdf(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  const srcDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const mode = params.splitMode || 'ranges';
  const baseName = file.name.replace(/\.pdf$/i, '');

  let groups: { label: string; pages: number[] }[] = [];

  if (mode === 'ranges') {
    groups = parseSplitGroups(params.rangeString || '1', totalPages);
  } else if (mode === 'interval') {
    const step = Math.max(1, parseInt(String(params.intervalPages || 1), 10));
    for (let i = 0; i < totalPages; i += step) {
      const chunk: number[] = [];
      for (let j = i; j < Math.min(totalPages, i + step); j++) chunk.push(j);
      groups.push({ label: `p${i + 1}-${i + chunk.length}`, pages: chunk });
    }
  } else if (mode === 'burst') {
    for (let i = 0; i < totalPages; i++) {
      groups.push({ label: `page_${String(i + 1).padStart(3, '0')}`, pages: [i] });
    }
  } else if (mode === 'smart') {
    const { pageTexts } = await extractPositionedTextFromPdf(file.bytes);
    const markerPattern = (params.smartMarker || 'Chapter|Invoice #|Page 1 of').trim();
    let rx: RegExp;
    try {
      rx = new RegExp(markerPattern, 'i');
    } catch {
      rx = /Chapter|Invoice|Section/i;
    }

    let currentGroup: number[] = [0];
    let sectionIdx = 1;
    for (let p = 1; p < totalPages; p++) {
      const text = pageTexts[p] || '';
      if (rx.test(text)) {
        groups.push({
          label: `section_${sectionIdx}_p${currentGroup[0] + 1}-${currentGroup[currentGroup.length - 1] + 1}`,
          pages: currentGroup,
        });
        sectionIdx++;
        currentGroup = [p];
      } else {
        currentGroup.push(p);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({
        label: `section_${sectionIdx}_p${currentGroup[0] + 1}-${currentGroup[currentGroup.length - 1] + 1}`,
        pages: currentGroup,
      });
    }
  }

  // If user requested merging ranges into a single PDF or there is only 1 group, return a single PDF
  if (groups.length === 1 || (mode === 'ranges' && params.mergeRangesIntoSinglePdf)) {
    const outDoc = await PDFDocument.create();
    for (const grp of groups) {
      const copied = await outDoc.copyPages(srcDoc, grp.pages);
      copied.forEach((p) => outDoc.addPage(p));
    }
    const outBytes = await outDoc.save({ useObjectStreams: true });
    return {
      bytes: outBytes,
      filename: `${baseName}_split.pdf`,
      mimeType: 'application/pdf',
      beforeSize: file.bytes.byteLength,
      afterSize: outBytes.byteLength,
      pageCount: outDoc.getPageCount(),
      canChainAsPdf: true,
      summaryMessage: `Extracted ${outDoc.getPageCount()} page(s) into a single split PDF.`,
    };
  }

  // Multiple output PDFs -> build each PDF and bundle in a ZIP, plus keep the first split PDF chainable
  const zip = new JSZip();
  const secondaryFiles: EngineSecondaryFile[] = [];
  let firstPdfBytes: Uint8Array | null = null;

  for (let i = 0; i < groups.length; i++) {
    const grp = groups[i];
    const partDoc = await PDFDocument.create();
    const copied = await partDoc.copyPages(srcDoc, grp.pages);
    copied.forEach((p) => partDoc.addPage(p));
    const partBytes = await partDoc.save({ useObjectStreams: true });
    const partName = `${baseName}_${grp.label}.pdf`;
    zip.file(partName, partBytes);
    secondaryFiles.push({
      filename: partName,
      bytes: partBytes,
      mimeType: 'application/pdf',
    });
    if (i === 0) firstPdfBytes = partBytes;
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

  return {
    bytes: zipBytes,
    filename: `${baseName}_split_${groups.length}_files.zip`,
    mimeType: 'application/zip',
    beforeSize: file.bytes.byteLength,
    afterSize: zipBytes.byteLength,
    pageCount: groups.length,
    canChainAsPdf: Boolean(firstPdfBytes),
    secondaryFiles,
    summaryMessage: `Split into ${groups.length} separate PDF files bundled in ZIP (${mode} mode).`,
  };
}

/**
 * Tool 3: Remove Pages
 * Deletes pages selected visually or specified by range string ("even", "odd", "2, 4-6").
 */
export async function executeRemovePages(
  file: UploadedFileItem,
  thumbnails: RenderedPageThumbnail[],
  params: Record<string, any>
): Promise<EngineOutput> {
  const srcDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const selectedVisual = thumbnails
    .filter((t) => t.selected && !t.isBlank)
    .map((t) => t.originalPageIndex);

  const toRemoveSet = new Set<number>(
    params.useVisualSelection && selectedVisual.length > 0
      ? selectedVisual
      : parsePageRanges(params.removeRanges || '2', totalPages)
  );

  const remainingIndices: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    if (!toRemoveSet.has(i)) remainingIndices.push(i);
  }

  if (remainingIndices.length === 0) {
    throw new Error('Cannot remove all pages from the document. Leave at least 1 page.');
  }

  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, remainingIndices);
  copied.forEach((p) => outDoc.addPage(p));

  const outBytes = await outDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_cleaned.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: outDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Removed ${toRemoveSet.size} page(s); exported ${outDoc.getPageCount()} remaining page(s).`,
  };
}

/**
 * Tool 4: Extract Pages
 * Extracts selected pages either as one combined PDF or as individual PDFs inside a .zip.
 */
export async function executeExtractPages(
  file: UploadedFileItem,
  thumbnails: RenderedPageThumbnail[],
  params: Record<string, any>
): Promise<EngineOutput> {
  const srcDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const baseName = file.name.replace(/\.pdf$/i, '');

  const selectedVisual = thumbnails
    .filter((t) => t.selected && !t.isBlank)
    .map((t) => t.originalPageIndex);

  const targetIndices =
    params.useVisualSelection && selectedVisual.length > 0
      ? selectedVisual
      : parsePageRanges(params.extractRanges || '1', totalPages);

  if (targetIndices.length === 0) {
    throw new Error('Select at least one valid page to extract.');
  }

  if (params.exportAsZip && targetIndices.length > 1) {
    const zip = new JSZip();
    const secondaryFiles: EngineSecondaryFile[] = [];
    for (const pageIdx of targetIndices) {
      const singleDoc = await PDFDocument.create();
      const [copied] = await singleDoc.copyPages(srcDoc, [pageIdx]);
      singleDoc.addPage(copied);
      const singleBytes = await singleDoc.save({ useObjectStreams: true });
      const fname = `${baseName}_page_${pageIdx + 1}.pdf`;
      zip.file(fname, singleBytes);
      secondaryFiles.push({
        filename: fname,
        bytes: singleBytes,
        mimeType: 'application/pdf',
      });
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return {
      bytes: zipBytes,
      filename: `${baseName}_extracted_${targetIndices.length}_pages.zip`,
      mimeType: 'application/zip',
      beforeSize: file.bytes.byteLength,
      afterSize: zipBytes.byteLength,
      pageCount: targetIndices.length,
      canChainAsPdf: true,
      secondaryFiles,
      summaryMessage: `Extracted ${targetIndices.length} individual PDF pages into a ZIP archive.`,
    };
  }

  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, targetIndices);
  copied.forEach((p) => outDoc.addPage(p));
  const outBytes = await outDoc.save({ useObjectStreams: true });

  return {
    bytes: outBytes,
    filename: `${baseName}_extracted.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: outDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Extracted ${outDoc.getPageCount()} selected page(s) into a combined PDF.`,
  };
}

/**
 * Tool 5: Organize PDF
 * Rebuilds a PDF from the interactive visual thumbnail list (reordered, rotated, blank pages inserted,
 * duplicated pages, or interleaved with a second uploaded PDF).
 */
export async function executeOrganizePdf(
  files: UploadedFileItem[],
  thumbnails: RenderedPageThumbnail[],
  params: Record<string, any>
): Promise<EngineOutput> {
  if (files.length === 0) {
    throw new Error('Upload at least one PDF to organize.');
  }

  const beforeSize = files.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  const outDoc = await PDFDocument.create();

  // If user enabled Interleave with a second PDF and uploaded >= 2 files
  if (params.interleaveSecondPdf && files.length >= 2) {
    const docA = await PDFDocument.load(files[0].bytes, { ignoreEncryption: true });
    const docB = await PDFDocument.load(files[1].bytes, { ignoreEncryption: true });
    const maxLen = Math.max(docA.getPageCount(), docB.getPageCount());
    for (let i = 0; i < maxLen; i++) {
      if (i < docA.getPageCount()) {
        const [pA] = await outDoc.copyPages(docA, [i]);
        outDoc.addPage(pA);
      }
      if (i < docB.getPageCount()) {
        const [pB] = await outDoc.copyPages(docB, [i]);
        outDoc.addPage(pB);
      }
    }
  } else {
    const loadedDocs = new Map<string, PDFDocument>();
    for (const f of files) {
      loadedDocs.set(f.id, await PDFDocument.load(f.bytes, { ignoreEncryption: true }));
    }

    for (const thumb of thumbnails) {
      if (thumb.isBlank) {
        const blankPage = outDoc.addPage([thumb.width || 595.28, thumb.height || 841.89]);
        if (thumb.rotation) {
          blankPage.setRotation(degrees(thumb.rotation % 360));
        }
        continue;
      }

      const srcDoc = loadedDocs.get(thumb.sourceFileId) || loadedDocs.values().next().value;
      if (srcDoc && thumb.originalPageIndex < srcDoc.getPageCount()) {
        const [copied] = await outDoc.copyPages(srcDoc, [thumb.originalPageIndex]);
        if (thumb.rotation) {
          const baseAngle = copied.getRotation().angle;
          copied.setRotation(degrees((baseAngle + thumb.rotation) % 360));
        }
        outDoc.addPage(copied);
      }
    }
  }

  const outBytes = await outDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${files[0].name.replace(/\.pdf$/i, '')}_organized.pdf`,
    mimeType: 'application/pdf',
    beforeSize,
    afterSize: outBytes.byteLength,
    pageCount: outDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Organized document into ${outDoc.getPageCount()} page(s) with custom order and rotations.`,
  };
}

/**
 * Helper to apply monochrome document scanner adaptive contrast / threshold filter on an image DataURL.
 */
export async function applyScannerMonochromeFilter(
  imageDataUrl: string,
  mode: 'adaptive-mono' | 'high-contrast-gray' | 'original',
  threshold = 145,
  contrast = 1.45
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 800;
      canvas.height = img.height || 1100;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (mode !== 'original') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const factor = (259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100));

        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          let cVal = factor * (lum - 128) + 128;
          cVal = Math.max(0, Math.min(255, cVal));

          if (mode === 'adaptive-mono') {
            const bw = cVal >= threshold ? 255 : cVal < threshold * 0.65 ? 12 : Math.round(cVal);
            data[i] = bw;
            data[i + 1] = bw;
            data[i + 2] = bw;
          } else {
            data[i] = cVal;
            data[i + 1] = cVal;
            data[i + 2] = cVal;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }

      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.88),
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => reject(new Error('Failed to decode captured scan image.'));
    img.src = imageDataUrl;
  });
}

/**
 * Tool 6: Scan to PDF
 * Takes captured webcam frames or uploaded scan images, applies the live monochrome document filter,
 * and compiles them into a multi-page PDF.
 */
export async function executeScanToPdf(
  capturedScans: string[],
  uploadedFiles: UploadedFileItem[],
  params: Record<string, any>
): Promise<EngineOutput> {
  const allDataUrls: string[] = [...capturedScans];

  // Also include any uploaded image files if the user dropped photos instead of using webcam
  for (const file of uploadedFiles) {
    if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
      const blob = new Blob([file.bytes as unknown as BlobPart], { type: file.type || 'image/jpeg' });
      const url = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(String(reader.result));
        reader.readAsDataURL(blob);
      });
      allDataUrls.push(url);
    }
  }

  if (allDataUrls.length === 0) {
    throw new Error('Capture at least one scan frame from camera or upload an image to scan.');
  }

  const pdfDoc = await PDFDocument.create();
  const filterMode = params.filterMode || 'adaptive-mono';
  const threshold = Number(params.threshold ?? 145);
  const contrast = Number(params.contrast ?? 1.45);

  for (const rawUrl of allDataUrls) {
    const processed = await applyScannerMonochromeFilter(rawUrl, filterMode, threshold, contrast);
    const base64 = processed.dataUrl.split(',')[1];
    const imgBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const embeddedImg = await pdfDoc.embedJpg(imgBytes);

    let pageW = 595.28;
    let pageH = 841.89;
    if (params.pageSize === 'Letter') {
      pageW = 612;
      pageH = 792;
    } else if (params.pageSize === 'Fit') {
      pageW = embeddedImg.width;
      pageH = embeddedImg.height;
    }

    const page = pdfDoc.addPage([pageW, pageH]);
    const margin = params.pageSize === 'Fit' ? 0 : 24;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;
    const scale = Math.min(availW / embeddedImg.width, availH / embeddedImg.height);
    const drawW = embeddedImg.width * scale;
    const drawH = embeddedImg.height * scale;

    page.drawImage(embeddedImg, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `scanned_document_${pdfDoc.getPageCount()}p.pdf`,
    mimeType: 'application/pdf',
    beforeSize: outBytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Compiled ${pdfDoc.getPageCount()} monochrome scanned page(s) into PDF.`,
  };
}
