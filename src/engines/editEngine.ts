import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import {
  CanvasAnnotation,
  DetectedAcroField,
  EngineOutput,
  RenderedPageThumbnail,
  UploadedFileItem,
} from '../types/pdf';

/**
 * Tool 20: Rotate PDF
 * Rotates All, Portrait-only, Landscape-only, Even, Odd, or individually rotated pages.
 */
export async function executeRotatePdf(
  file: UploadedFileItem,
  thumbnails: RenderedPageThumbnail[],
  params: Record<string, any>
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const globalAngle = Number(params.angle ?? 90);
  const filter = params.targetFilter || 'all';
  let rotatedCount = 0;

  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();
    const isPortrait = height >= width;
    const pageNum = idx + 1;
    const thumbRot = thumbnails[idx]?.rotation || 0;

    let matchesFilter = false;
    if (filter === 'all') matchesFilter = true;
    else if (filter === 'portrait' && isPortrait) matchesFilter = true;
    else if (filter === 'landscape' && !isPortrait) matchesFilter = true;
    else if (filter === 'even' && pageNum % 2 === 0) matchesFilter = true;
    else if (filter === 'odd' && pageNum % 2 === 1) matchesFilter = true;

    const deltaAngle = (matchesFilter ? globalAngle : 0) + thumbRot;
    if (deltaAngle % 360 !== 0) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + deltaAngle + 360) % 360));
      rotatedCount++;
    }
  });

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_rotated.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pages.length,
    canChainAsPdf: true,
    summaryMessage: `Rotated ${rotatedCount} of ${pages.length} page(s) (${filter} filter, ${globalAngle}°).`,
  };
}

/**
 * Tool 21: Add Page Numbers
 * 9-point position grid, facing-page mirror mode, starting page offset, custom start number,
 * font size, margin offset, and template format ('{n}', 'Page {n}', 'Page {n} of {total}', '- {n} -').
 */
export async function executeAddPageNumbers(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const total = pages.length;

  const startFromPage = Math.max(1, Number(params.startFromPage || 1));
  const firstNumber = Number(params.firstNumber ?? 1);
  const fontSize = Math.max(6, Number(params.fontSize || 10));
  const margin = Math.max(12, Number(params.marginOffset || 28));
  const template = String(params.template || 'Page {n} of {total}');
  const basePosition = String(params.position || 'bottom-right');
  const mirror = Boolean(params.mirrorFacingPages);

  let numberedCount = 0;

  pages.forEach((page, idx) => {
    const page1Based = idx + 1;
    if (page1Based < startFromPage) return;

    const displayNum = firstNumber + (page1Based - startFromPage);
    const label = template
      .replace(/\{n\}/g, String(displayNum))
      .replace(/\{total\}/g, String(total));

    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, fontSize);

    let pos = basePosition;
    if (mirror && page1Based % 2 === 0) {
      if (pos.endsWith('-right')) pos = pos.replace('-right', '-left');
      else if (pos.endsWith('-left')) pos = pos.replace('-left', '-right');
    }

    const [vAlign, hAlign] = pos.split('-');
    let x = (width - textWidth) / 2;
    if (hAlign === 'left') x = margin;
    else if (hAlign === 'right') x = Math.max(margin, width - margin - textWidth);

    let y = margin;
    if (vAlign === 'top') y = height - margin - fontSize;
    else if (vAlign === 'middle') y = (height - fontSize) / 2;

    page.drawText(label, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.15, 0.15, 0.18),
    });
    numberedCount++;
  });

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_numbered.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: total,
    canChainAsPdf: true,
    summaryMessage: `Stamped page numbers on ${numberedCount} page(s) at ${basePosition}.`,
  };
}

/**
 * Tool 22: Add Watermark
 * Supports Text and Image watermarks with opacity, rotation, font size, grayscale shade,
 * layer order (Over vs Under), and Single vs Mosaic Tiled Grid placement.
 */
export async function executeWatermarkPdf(
  file: UploadedFileItem,
  params: Record<string, any>,
  watermarkImageBytes?: Uint8Array
): Promise<EngineOutput> {
  const srcDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);

  const opacity = Math.max(0.05, Math.min(1, Number(params.opacity ?? 0.22)));
  const rotation = Number(params.rotation ?? -35);
  const fontSize = Math.max(12, Number(params.fontSize ?? 44));
  const gray = Math.max(0, Math.min(0.95, Number(params.grayShade ?? 0.35)));
  const text = String(params.text || 'CONFIDENTIAL // MONO');
  const isMosaic = params.placement === 'mosaic';
  const isUnder = params.layerOrder === 'under';

  let embeddedWatermarkImg: any = null;
  if (params.watermarkType === 'image' && watermarkImageBytes) {
    try {
      embeddedWatermarkImg = await outDoc.embedPng(watermarkImageBytes);
    } catch {
      embeddedWatermarkImg = await outDoc.embedJpg(watermarkImageBytes);
    }
  }

  const drawStampOnPage = (page: any) => {
    const { width, height } = page.getSize();

    if (embeddedWatermarkImg) {
      const stampW = Math.min(width * 0.45, embeddedWatermarkImg.width);
      const stampH = ( embeddedWatermarkImg.height / embeddedWatermarkImg.width ) * stampW;
      if (isMosaic) {
        for (let x = 60; x < width; x += stampW + 90) {
          for (let y = 80; y < height; y += stampH + 110) {
            page.drawImage(embeddedWatermarkImg, {
              x,
              y,
              width: stampW * 0.65,
              height: stampH * 0.65,
              opacity,
              rotate: degrees(rotation),
            });
          }
        }
      } else {
        page.drawImage(embeddedWatermarkImg, {
          x: (width - stampW) / 2,
          y: (height - stampH) / 2,
          width: stampW,
          height: stampH,
          opacity,
          rotate: degrees(rotation),
        });
      }
      return;
    }

    const textW = fontBold.widthOfTextAtSize(text, fontSize);
    if (isMosaic) {
      const tileFontSize = Math.max(14, Math.round(fontSize * 0.55));
      for (let x = 40; x < width; x += 210) {
        for (let y = 60; y < height; y += 160) {
          page.drawText(text, {
            x,
            y,
            size: tileFontSize,
            font: fontBold,
            color: rgb(gray, gray, gray),
            opacity,
            rotate: degrees(rotation),
          });
        }
      }
    } else {
      page.drawText(text, {
        x: Math.max(24, (width - textW * 0.75) / 2),
        y: height / 2,
        size: fontSize,
        font: fontBold,
        color: rgb(gray, gray, gray),
        opacity,
        rotate: degrees(rotation),
      });
    }
  };

  const totalPages = srcDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    if (isUnder) {
      const srcPage = srcDoc.getPage(i);
      const { width, height } = srcPage.getSize();
      const newPage = outDoc.addPage([width, height]);
      drawStampOnPage(newPage);
      const embeddedPage = await outDoc.embedPage(srcPage);
      newPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });
    } else {
      const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(copiedPage);
      drawStampOnPage(copiedPage);
    }
  }

  const outBytes = await outDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_watermarked.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: totalPages,
    canChainAsPdf: true,
    summaryMessage: `Applied ${isMosaic ? 'Mosaic Grid' : 'Single'} watermark (${isUnder ? 'Under' : 'Over'} content) across ${totalPages} page(s).`,
  };
}

/**
 * Tool 23: Crop PDF
 * Applies custom point margins (Top, Bottom, Left, Right) to All, Current, Odd, or Even pages
 * via page.setCropBox() and page.setMediaBox().
 */
export async function executeCropPdf(
  file: UploadedFileItem,
  params: Record<string, any>,
  activePageIndex = 0
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  const top = Math.max(0, Number(params.top ?? 36));
  const bottom = Math.max(0, Number(params.bottom ?? 36));
  const left = Math.max(0, Number(params.left ?? 36));
  const right = Math.max(0, Number(params.right ?? 36));
  const applyTo = params.applyTo || 'all';

  let croppedCount = 0;
  pages.forEach((page, idx) => {
    const page1 = idx + 1;
    const shouldApply =
      applyTo === 'all' ||
      (applyTo === 'current' && idx === activePageIndex) ||
      (applyTo === 'odd' && page1 % 2 === 1) ||
      (applyTo === 'even' && page1 % 2 === 0);

    if (!shouldApply) return;

    const { width, height } = page.getSize();
    const newW = Math.max(72, width - left - right);
    const newH = Math.max(72, height - top - bottom);

    page.setCropBox(left, bottom, newW, newH);
    page.setMediaBox(left, bottom, newW, newH);
    croppedCount++;
  });

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_cropped.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pages.length,
    canChainAsPdf: true,
    summaryMessage: `Cropped ${croppedCount} page(s) (T:${top}pt B:${bottom}pt L:${left}pt R:${right}pt).`,
  };
}

/**
 * Tool 24: Edit PDF (Full Canvas Studio)
 * Flattens all interactive canvas studio overlays (Text Boxes, Freehand Pen, Highlighter,
 * Rectangles, Lines, Uploaded Images, Sticky Comments) directly into the PDF pages.
 */
export async function executeEditPdfStudio(
  file: UploadedFileItem,
  annotations: CanvasAnnotation[]
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;
    const { width, height } = page.getSize();

    const pdfX = ann.x * width;
    const boxW = ann.width * width;
    const boxH = ann.height * height;
    const pdfY = height - ann.y * height - boxH;

    if (ann.type === 'text' || ann.type === 'comment') {
      const fSize = ann.fontSize || 14;
      if (ann.type === 'comment') {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: Math.max(120, boxW),
          height: Math.max(36, boxH),
          color: rgb(0.95, 0.95, 0.96),
          borderColor: rgb(0.15, 0.15, 0.18),
          borderWidth: 1,
        });
      }
      page.drawText((ann.text || 'Note').replace(/[^\x20-\x7E]/g, ' '), {
        x: pdfX + (ann.type === 'comment' ? 6 : 0),
        y: pdfY + Math.max(4, boxH - fSize - 2),
        size: fSize,
        font: ann.fontWeight === 'bold' ? fontBold : fontRegular,
        color: rgb(0.06, 0.06, 0.08),
      });
    } else if (ann.type === 'rect') {
      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: boxW,
        height: boxH,
        borderColor: rgb(0.08, 0.08, 0.1),
        borderWidth: 2,
      });
    } else if (ann.type === 'highlighter') {
      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: boxW,
        height: boxH,
        color: rgb(0.82, 0.82, 0.85),
        opacity: 0.4,
      });
    } else if (ann.type === 'line') {
      page.drawLine({
        start: { x: pdfX, y: pdfY + boxH },
        end: { x: pdfX + boxW, y: pdfY },
        thickness: 2,
        color: rgb(0.08, 0.08, 0.1),
      });
    } else if (ann.type === 'pen' && ann.points && ann.points.length > 1) {
      for (let i = 1; i < ann.points.length; i++) {
        const p0 = ann.points[i - 1];
        const p1 = ann.points[i];
        page.drawLine({
          start: { x: p0.x * width, y: height - p0.y * height },
          end: { x: p1.x * width, y: height - p1.y * height },
          thickness: 2,
          color: rgb(0.06, 0.06, 0.08),
        });
      }
    } else if ((ann.type === 'image' || ann.type === 'signature') && ann.imageDataUrl) {
      const base64 = ann.imageDataUrl.split(',')[1];
      if (base64) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const img = ann.imageDataUrl.includes('image/png')
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
        page.drawImage(img, {
          x: pdfX,
          y: pdfY,
          width: boxW,
          height: boxH,
        });
      }
    }
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_edited.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pages.length,
    canChainAsPdf: true,
    summaryMessage: `Flattened ${annotations.length} studio canvas annotation(s) into PDF.`,
  };
}

/**
 * Inspects a PDF for existing AcroForm fields (PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup).
 */
export async function inspectPdfAcroFields(bytes: Uint8Array): Promise<DetectedAcroField[]> {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const rawFields = form.getFields();
    const result: DetectedAcroField[] = [];

    for (const f of rawFields) {
      const name = f.getName();
      if (f instanceof PDFTextField) {
        result.push({ name, type: 'text', value: f.getText() || '' });
      } else if (f instanceof PDFCheckBox) {
        result.push({ name, type: 'checkbox', value: f.isChecked() });
      } else if (f instanceof PDFDropdown) {
        const selected = f.getSelected();
        result.push({
          name,
          type: 'dropdown',
          value: selected[0] || '',
          options: f.getOptions(),
        });
      } else if (f instanceof PDFRadioGroup) {
        result.push({
          name,
          type: 'radio',
          value: f.getSelected() || '',
          options: f.getOptions(),
        });
      } else {
        result.push({ name, type: 'unknown', value: '' });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Tool 25: PDF Forms (Filler & Heuristic Builder)
 * - Mode 1 (Fill & Flatten): Updates existing AcroForm fields with user values and optionally flattens.
 * - Mode 2 (Form Builder + Smart Field Detection): Embeds new interactive AcroForm fields
 *   (PDFTextField, PDFCheckBox, PDFDropdown) from canvas annotations and auto-detected ___ / [ ] fields.
 */
export async function executePdfForms(
  file: UploadedFileItem,
  existingFieldValues: Record<string, string | boolean>,
  builderAnnotations: CanvasAnnotation[],
  params: Record<string, any>
): Promise<EngineOutput> {
  const pdfDoc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();

  // Apply updates to any existing AcroForm fields
  let updatedExistingCount = 0;
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!(name in existingFieldValues)) continue;
    const val = existingFieldValues[name];
    if (field instanceof PDFTextField) {
      field.setText(String(val ?? ''));
      updatedExistingCount++;
    } else if (field instanceof PDFCheckBox) {
      if (val) field.check();
      else field.uncheck();
      updatedExistingCount++;
    } else if (field instanceof PDFDropdown && typeof val === 'string' && val) {
      field.select(val);
      updatedExistingCount++;
    } else if (field instanceof PDFRadioGroup && typeof val === 'string' && val) {
      field.select(val);
      updatedExistingCount++;
    }
  }

  // Create new interactive AcroForm fields from Mode 2 Builder / Auto-Detected fields
  let createdBuilderCount = 0;
  const formAnnotations = builderAnnotations.filter((a) =>
    ['form-text', 'form-checkbox', 'form-dropdown'].includes(a.type)
  );

  for (let i = 0; i < formAnnotations.length; i++) {
    const ann = formAnnotations[i];
    const page = pages[ann.pageIndex];
    if (!page) continue;
    const { width, height } = page.getSize();

    const pdfX = ann.x * width;
    const boxW = Math.max(14, ann.width * width);
    const boxH = Math.max(14, ann.height * height);
    const pdfY = Math.max(10, height - ann.y * height - boxH);
    const uniqueName = `${ann.fieldName || 'field'}_${i + 1}_${Date.now().toString().slice(-3)}`;

    if (ann.type === 'form-text') {
      const tf = form.createTextField(uniqueName);
      if (ann.text) tf.setText(ann.text);
      tf.addToPage(page, { x: pdfX, y: pdfY, width: boxW, height: boxH });
      createdBuilderCount++;
    } else if (ann.type === 'form-checkbox') {
      const cb = form.createCheckBox(uniqueName);
      if (ann.checked) cb.check();
      cb.addToPage(page, { x: pdfX, y: pdfY, width: Math.min(24, boxW), height: Math.min(24, boxH) });
      createdBuilderCount++;
    } else if (ann.type === 'form-dropdown') {
      const dd = form.createDropdown(uniqueName);
      const opts = ann.fieldOptions && ann.fieldOptions.length > 0 ? ann.fieldOptions : ['Option 1', 'Option 2'];
      dd.addOptions(opts);
      dd.select(ann.text || opts[0]);
      dd.addToPage(page, { x: pdfX, y: pdfY, width: boxW, height: boxH });
      createdBuilderCount++;
    }
  }

  if (params.flattenOnExport) {
    try {
      form.flatten();
    } catch {
      // Ignore flatten warning if no fields exist
    }
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}_forms.pdf`,
    mimeType: 'application/pdf',
    beforeSize: file.bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pages.length,
    canChainAsPdf: true,
    summaryMessage: `Processed PDF Form (${updatedExistingCount} filled, ${createdBuilderCount} new interactive fields created${params.flattenOnExport ? ', flattened' : ''}).`,
  };
}
