import React, { useRef, useState } from 'react';
import {
  Type,
  PenTool,
  Highlighter,
  Square,
  Minus,
  MessageSquare,
  Image as ImageIcon,
  Trash2,
  ScanSearch,
  Sparkles,
  CheckSquare,
  ListFilter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  CanvasAnnotation,
  CanvasAnnotationType,
  DetectedAcroField,
  RenderedPageThumbnail,
  ToolId,
  UploadedFileItem,
} from '../types/pdf';
import { detectHeuristicFormFields, scanRedactionPatterns } from '../utils/pdfHelpers';
import { extractPositionedTextFromPdf } from '../utils/pdfjsClient';

interface InteractivePageStudioProps {
  toolId: ToolId;
  file: UploadedFileItem;
  thumbnails: RenderedPageThumbnail[];
  activePageIndex: number;
  onChangeActivePage: (idx: number) => void;
  annotations: CanvasAnnotation[];
  onChangeAnnotations: React.Dispatch<React.SetStateAction<CanvasAnnotation[]>>;
  params: Record<string, any>;
  onChangeParam: (key: string, val: any) => void;
  detectedAcroFields: DetectedAcroField[];
  acroFieldValues: Record<string, string | boolean>;
  onChangeAcroFieldValue: (name: string, val: string | boolean) => void;
  signatureDataUrl: string | null;
  onChangeSignatureDataUrl: (url: string | null) => void;
}

export const InteractivePageStudio: React.FC<InteractivePageStudioProps> = ({
  toolId,
  file,
  thumbnails,
  activePageIndex,
  onChangeActivePage,
  annotations,
  onChangeAnnotations,
  params,
  onChangeParam,
  detectedAcroFields,
  acroFieldValues,
  onChangeAcroFieldValue,
  signatureDataUrl,
  onChangeSignatureDataUrl,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigPadRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPenPoints, setCurrentPenPoints] = useState<{ x: number; y: number }[]>([]);
  const [scanStatus, setScanStatus] = useState<string>('');

  const currentThumb = thumbnails[activePageIndex] || thumbnails[0];
  const pageAnnotations = annotations.filter((a) => a.pageIndex === activePageIndex);

  const getNormalizedCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.1, y: 0.1 };
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.annotationControl === 'true') return;
    const pt = getNormalizedCoords(e);

    if (toolId === 'edit-pdf') {
      const drawTool = (params.activeDrawTool || 'text') as CanvasAnnotationType;
      if (drawTool === 'text' || drawTool === 'comment') {
        const newAnn: CanvasAnnotation = {
          id: `ann_${Date.now()}`,
          pageIndex: activePageIndex,
          type: drawTool,
          x: pt.x,
          y: pt.y,
          width: 0.28,
          height: 0.06,
          text: drawTool === 'comment' ? 'Review Note: Verified' : 'MONO Studio Text',
          fontSize: Number(params.fontSize || 14),
          fontWeight: 'bold',
        };
        onChangeAnnotations((prev) => [...prev, newAnn]);
      } else if (drawTool === 'pen') {
        setDragStart(pt);
        setCurrentPenPoints([pt]);
      } else {
        setDragStart(pt);
      }
    } else if (toolId === 'redact-pdf') {
      setDragStart(pt);
    } else if (toolId === 'sign-pdf') {
      const newSig: CanvasAnnotation = {
        id: `sig_${Date.now()}`,
        pageIndex: activePageIndex,
        type: 'signature',
        x: Math.min(0.65, pt.x),
        y: Math.min(0.85, pt.y),
        width: 0.32,
        height: 0.09,
        imageDataUrl: signatureDataUrl || undefined,
        text: params.signerName || 'A. Mercer',
      };
      onChangeAnnotations((prev) => [...prev, newSig]);
    } else if (toolId === 'pdf-forms' && params.formMode === 'builder') {
      const fieldType = (params.builderFieldType || 'form-text') as CanvasAnnotationType;
      const newField: CanvasAnnotation = {
        id: `fld_${Date.now()}`,
        pageIndex: activePageIndex,
        type: fieldType,
        x: pt.x,
        y: pt.y,
        width: fieldType === 'form-checkbox' ? 0.035 : 0.28,
        height: fieldType === 'form-checkbox' ? 0.025 : 0.035,
        fieldName: `custom_${fieldType.replace('form-', '')}_${annotations.length + 1}`,
        text: '',
        checked: true,
      };
      onChangeAnnotations((prev) => [...prev, newField]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const pt = getNormalizedCoords(e);
    if (toolId === 'edit-pdf' && params.activeDrawTool === 'pen') {
      setCurrentPenPoints((prev) => [...prev, pt]);
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const endPt = getNormalizedCoords(e);

    if (toolId === 'edit-pdf') {
      const drawTool = (params.activeDrawTool || 'rect') as CanvasAnnotationType;
      if (drawTool === 'pen') {
        if (currentPenPoints.length > 1) {
          onChangeAnnotations((prev) => [
            ...prev,
            {
              id: `pen_${Date.now()}`,
              pageIndex: activePageIndex,
              type: 'pen',
              x: dragStart.x,
              y: dragStart.y,
              width: 0.1,
              height: 0.1,
              points: [...currentPenPoints, endPt],
            },
          ]);
        }
        setCurrentPenPoints([]);
      } else if (['rect', 'highlighter', 'line'].includes(drawTool)) {
        const x = Math.min(dragStart.x, endPt.x);
        const y = Math.min(dragStart.y, endPt.y);
        const w = Math.max(0.08, Math.abs(endPt.x - dragStart.x));
        const h = Math.max(0.03, Math.abs(endPt.y - dragStart.y));
        onChangeAnnotations((prev) => [
          ...prev,
          {
            id: `${drawTool}_${Date.now()}`,
            pageIndex: activePageIndex,
            type: drawTool,
            x,
            y,
            width: w,
            height: h,
          },
        ]);
      }
    } else if (toolId === 'redact-pdf') {
      const x = Math.min(dragStart.x, endPt.x);
      const y = Math.min(dragStart.y, endPt.y);
      const w = Math.max(0.12, Math.abs(endPt.x - dragStart.x));
      const h = Math.max(0.025, Math.abs(endPt.y - dragStart.y));
      onChangeAnnotations((prev) => [
        ...prev,
        {
          id: `redact_${Date.now()}`,
          pageIndex: activePageIndex,
          type: 'redaction',
          x,
          y,
          width: w,
          height: h,
          text: 'REDACTED',
        },
      ]);
    }

    setDragStart(null);
  };

  // Auto-Scan PII Patterns for Redact PDF (Tool 29)
  const handleAutoScanRedactions = async () => {
    setScanStatus('Scanning PDF text coordinates for PII...');
    try {
      const { items, pageDimensions } = await extractPositionedTextFromPdf(file.bytes);
      const matches = scanRedactionPatterns(items, {
        scanEmails: params.scanEmails !== false,
        scanPhones: params.scanPhones !== false,
        scanSsn: params.scanSsn !== false,
        scanCreditCards: params.scanCreditCards !== false,
        customSearchPattern: params.customSearchPattern || '',
      });

      const newBoxes: CanvasAnnotation[] = matches.map((m, idx) => {
        const dims = pageDimensions[m.pageIndex] || { width: 595.28, height: 841.89 };
        return {
          id: `auto_redact_${Date.now()}_${idx}`,
          pageIndex: m.pageIndex,
          type: 'redaction',
          x: Math.max(0, m.x / dims.width),
          y: Math.max(0, m.y / dims.height),
          width: Math.min(0.9, m.width / dims.width),
          height: Math.min(0.2, m.height / dims.height),
          text: `${m.category}: ${m.matchedText}`,
        };
      });

      onChangeAnnotations((prev) => [
        ...prev.filter((a) => a.type !== 'redaction'),
        ...newBoxes,
      ]);
      setScanStatus(`Auto-placed ${newBoxes.length} redaction box(es) across document.`);
    } catch (err: any) {
      setScanStatus(`Scan failed: ${err?.message || 'Error'}`);
    }
  };

  // Auto-Detect Form Fields (___ and [ ]) for PDF Forms (Tool 25)
  const handleAutoDetectFormFields = async () => {
    setScanStatus('Scanning page coordinates for ___ and [ ] form markers...');
    try {
      const { items, pageDimensions } = await extractPositionedTextFromPdf(file.bytes);
      const detected = detectHeuristicFormFields(items);
      const newFields: CanvasAnnotation[] = detected.map((d) => {
        const dims = pageDimensions[d.pageIndex] || { width: 595.28, height: 841.89 };
        return {
          id: d.id,
          pageIndex: d.pageIndex,
          type: d.type,
          fieldName: d.fieldName,
          x: Math.max(0, d.x / dims.width),
          y: Math.max(0, d.y / dims.height),
          width: Math.min(0.85, d.width / dims.width),
          height: Math.min(0.1, d.height / dims.height),
          text: '',
          checked: false,
        };
      });
      onChangeAnnotations((prev) => [...prev, ...newFields]);
      if (detected.length > 0 && detected[0].pageIndex !== activePageIndex) {
        onChangeActivePage(detected[0].pageIndex);
      }
      setScanStatus(`Auto-detected ${newFields.length} interactive form field(s).`);
    } catch (err: any) {
      setScanStatus(`Detection error: ${err?.message}`);
    }
  };

  // Signature Pad Drawing Handlers
  const startSigStroke = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigPadRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawingSig(true);
  };

  const moveSigStroke = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = sigPadRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endSigStroke = () => {
    if (!isDrawingSig) return;
    setIsDrawingSig(false);
    if (sigPadRef.current) {
      onChangeSignatureDataUrl(sigPadRef.current.toDataURL('image/png'));
    }
  };

  const clearSigPad = () => {
    const canvas = sigPadRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChangeSignatureDataUrl(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Studio Action Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        {/* Page Selector */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={activePageIndex <= 0}
            onClick={() => onChangeActivePage(Math.max(0, activePageIndex - 1))}
            aria-label="Previous Page"
            className="p-1.5 border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono tabular-nums px-2">
            Page {activePageIndex + 1} / {Math.max(1, thumbnails.length)}
          </span>
          <button
            type="button"
            disabled={activePageIndex >= thumbnails.length - 1}
            onClick={() =>
              onChangeActivePage(Math.min(thumbnails.length - 1, activePageIndex + 1))
            }
            aria-label="Next Page"
            className="p-1.5 border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tool-Specific Studio Controls */}
        {toolId === 'edit-pdf' && (
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: 'text', label: 'Text', icon: Type },
              { id: 'pen', label: 'Pen', icon: PenTool },
              { id: 'highlighter', label: 'Highlight', icon: Highlighter },
              { id: 'rect', label: 'Box', icon: Square },
              { id: 'line', label: 'Line', icon: Minus },
              { id: 'comment', label: 'Note', icon: MessageSquare },
            ].map((item) => {
              const Icon = item.icon;
              const isAct = (params.activeDrawTool || 'text') === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeParam('activeDrawTool', item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                    isAct
                      ? 'bg-zinc-900 text-zinc-50 border-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100'
                      : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-zinc-300 dark:border-zinc-700 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Stamp Image</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    onChangeAnnotations((prev) => [
                      ...prev,
                      {
                        id: `img_${Date.now()}`,
                        pageIndex: activePageIndex,
                        type: 'image',
                        x: 0.25,
                        y: 0.25,
                        width: 0.3,
                        height: 0.2,
                        imageDataUrl: String(reader.result),
                      },
                    ]);
                  };
                  reader.readAsDataURL(f);
                }}
              />
            </label>
          </div>
        )}

        {toolId === 'redact-pdf' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAutoScanRedactions}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950 hover:opacity-90 transition-opacity"
            >
              <ScanSearch className="w-3.5 h-3.5" />
              <span>Auto-Scan PII (Emails, Phones, SSN, Cards)</span>
            </button>
          </div>
        )}

        {toolId === 'pdf-forms' && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeParam('formMode', 'filler')}
              className={`px-2.5 py-1.5 text-xs font-medium border ${
                params.formMode === 'filler'
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-zinc-300 dark:border-zinc-700'
              }`}
            >
              Mode 1: Fill Existing ({detectedAcroFields.length})
            </button>
            <button
              type="button"
              onClick={() => onChangeParam('formMode', 'builder')}
              className={`px-2.5 py-1.5 text-xs font-medium border ${
                params.formMode !== 'filler'
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-zinc-300 dark:border-zinc-700'
              }`}
            >
              Mode 2: Form Builder
            </button>
            <button
              type="button"
              onClick={handleAutoDetectFormFields}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Detect Form Fields (___ & [ ])</span>
            </button>
          </div>
        )}

        {annotations.length > 0 && (
          <button
            type="button"
            onClick={() => onChangeAnnotations([])}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear ({annotations.length})</span>
          </button>
        )}
      </div>

      {scanStatus && (
        <div className="px-3 py-2 text-xs font-mono bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200">
          {scanStatus}
        </div>
      )}

      {/* Mode 1 AcroForm Filler Table when in PDF Forms Mode 1 */}
      {toolId === 'pdf-forms' && params.formMode === 'filler' && (
        <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Detected Embedded AcroForm Fields ({detectedAcroFields.length})
          </div>
          {detectedAcroFields.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No pre-existing AcroForm fields found. Switch to "Mode 2: Form Builder" or click "Auto-Detect Form Fields" to build interactive fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {detectedAcroFields.map((fld) => (
                <div
                  key={fld.name}
                  className="p-2.5 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5"
                >
                  <label className="text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-300">
                    {fld.name} <span className="opacity-60">({fld.type})</span>
                  </label>
                  {fld.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(acroFieldValues[fld.name] ?? fld.value)}
                      onChange={(e) => onChangeAcroFieldValue(fld.name, e.target.checked)}
                      className="w-4 h-4 accent-zinc-900 dark:accent-zinc-100"
                    />
                  ) : fld.type === 'dropdown' && fld.options ? (
                    <select
                      value={String(acroFieldValues[fld.name] ?? fld.value)}
                      onChange={(e) => onChangeAcroFieldValue(fld.name, e.target.value)}
                      className="px-2 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800"
                    >
                      {fld.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={String(acroFieldValues[fld.name] ?? fld.value)}
                      onChange={(e) => onChangeAcroFieldValue(fld.name, e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mode 2 Form Builder Palette */}
      {toolId === 'pdf-forms' && params.formMode !== 'filler' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
          <span className="font-mono text-zinc-500">Click page below to place:</span>
          {[
            { id: 'form-text', label: 'Text Input Field', icon: Type },
            { id: 'form-checkbox', label: 'Checkbox Field', icon: CheckSquare },
            { id: 'form-dropdown', label: 'Dropdown Menu', icon: ListFilter },
          ].map((b) => {
            const Icon = b.icon;
            const active = (params.builderFieldType || 'form-text') === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onChangeParam('builderFieldType', b.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 border ${
                  active
                    ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950'
                    : 'bg-white dark:bg-zinc-950 border-zinc-300 dark:border-zinc-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{b.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Signature Pad when in Sign PDF (Tool 28) */}
      {toolId === 'sign-pdf' && (
        <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold">High-DPI Signature Pad</div>
            <div className="text-[11px] text-zinc-500">
              Draw your signature below, then click anywhere on the PDF page to stamp it.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <canvas
              ref={sigPadRef}
              width={260}
              height={70}
              onMouseDown={startSigStroke}
              onMouseMove={moveSigStroke}
              onMouseUp={endSigStroke}
              onMouseLeave={endSigStroke}
              className="bg-zinc-50 border border-zinc-300 cursor-crosshair"
            />
            <button
              type="button"
              onClick={clearSigPad}
              className="px-2.5 py-1.5 text-xs font-mono border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Clear Pad
            </button>
          </div>
        </div>
      )}

      {/* Interactive Page Overlay Surface */}
      {currentThumb && (
        <div className="flex justify-center bg-zinc-200/70 dark:bg-zinc-950 p-6 border border-zinc-300 dark:border-zinc-800 overflow-auto">
          <div
            ref={containerRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            className="relative inline-block shadow-xl border border-zinc-400 dark:border-zinc-700 select-none cursor-crosshair bg-white"
            style={{ maxWidth: '640px', width: '100%' }}
          >
            <img
              src={currentThumb.dataUrl}
              alt={`PDF Page ${activePageIndex + 1}`}
              referrerPolicy="no-referrer"
              draggable={false}
              className="w-full h-auto block pointer-events-none"
            />

            {/* Crop Box Visual Overlay (Tool 23) */}
            {toolId === 'crop-pdf' && (
              <div
                className="absolute border-2 border-dashed border-zinc-950 bg-zinc-900/10 pointer-events-none"
                style={{
                  top: `${Math.min(45, (Number(params.top ?? 36) / (currentThumb.height || 842)) * 100)}%`,
                  bottom: `${Math.min(45, (Number(params.bottom ?? 36) / (currentThumb.height || 842)) * 100)}%`,
                  left: `${Math.min(45, (Number(params.left ?? 36) / (currentThumb.width || 595)) * 100)}%`,
                  right: `${Math.min(45, (Number(params.right ?? 36) / (currentThumb.width || 595)) * 100)}%`,
                }}
              >
                <span className="absolute top-1 left-1 bg-zinc-950 text-zinc-50 text-[10px] font-mono px-1.5 py-0.5">
                  CROP REGION ({Math.round(currentThumb.width - Number(params.left || 0) - Number(params.right || 0))} ×{' '}
                  {Math.round(currentThumb.height - Number(params.top || 0) - Number(params.bottom || 0))} pt)
                </span>
              </div>
            )}

            {/* Render Placed Annotations */}
            {pageAnnotations.map((ann) => (
              <div
                key={ann.id}
                data-annotation-control="true"
                style={{
                  left: `${ann.x * 100}%`,
                  top: `${ann.y * 100}%`,
                  width: `${ann.width * 100}%`,
                  height: `${ann.height * 100}%`,
                }}
                className={`absolute group flex items-center justify-between px-1.5 text-xs ${
                  ann.type === 'redaction'
                    ? 'bg-black text-white font-mono border border-zinc-700'
                    : ann.type === 'highlighter'
                    ? 'bg-zinc-400/40 border border-zinc-500'
                    : ann.type === 'signature'
                    ? 'bg-zinc-50/95 border-2 border-zinc-900 text-zinc-950 font-mono'
                    : ann.type.startsWith('form-')
                    ? 'bg-zinc-100/90 border-2 border-zinc-900 text-zinc-950 font-mono'
                    : 'bg-white/90 border border-zinc-900 text-zinc-950'
                }`}
              >
                {ann.type === 'redaction' ? (
                  <span className="text-[10px] truncate">{ann.text || 'REDACTED'}</span>
                ) : ann.type === 'signature' ? (
                  <div className="flex items-center gap-1 truncate">
                    {ann.imageDataUrl && (
                      <img
                        src={ann.imageDataUrl}
                        alt="Signature"
                        referrerPolicy="no-referrer"
                        className="h-6 object-contain"
                      />
                    )}
                    <span className="text-[10px] font-semibold truncate">
                      SIGNED: {ann.text}
                    </span>
                  </div>
                ) : ann.type.startsWith('form-') ? (
                  <input
                    data-annotation-control="true"
                    type="text"
                    value={ann.fieldName || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChangeAnnotations((prev) =>
                        prev.map((item) =>
                          item.id === ann.id ? { ...item, fieldName: val } : item
                        )
                      );
                    }}
                    className="w-full bg-transparent text-[10px] font-mono text-zinc-900 focus:outline-none"
                  />
                ) : (
                  <input
                    data-annotation-control="true"
                    type="text"
                    value={ann.text || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChangeAnnotations((prev) =>
                        prev.map((item) => (item.id === ann.id ? { ...item, text: val } : item))
                      );
                    }}
                    className="w-full bg-transparent text-xs font-semibold text-zinc-950 focus:outline-none"
                  />
                )}

                <button
                  type="button"
                  data-annotation-control="true"
                  aria-label="Delete Annotation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeAnnotations((prev) => prev.filter((item) => item.id !== ann.id));
                  }}
                  className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 bg-zinc-900 text-white"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
