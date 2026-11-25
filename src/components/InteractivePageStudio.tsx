import React, { useEffect, useRef, useState } from 'react';
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
  Upload,
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
  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [currentPenPoints, setCurrentPenPoints] = useState<{ x: number; y: number }[]>([]);
  const [movingAnn, setMovingAnn] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [scanStatus, setScanStatus] = useState<string>('');

  const currentThumb = thumbnails[activePageIndex] || thumbnails[0];
  const pageAnnotations = annotations.filter((a) => a.pageIndex === activePageIndex);

  // Sync typed signature preview into PNG dataUrl when in Type mode
  useEffect(() => {
    if (toolId !== 'sign-pdf' || sigMode !== 'type') return;
    const text = (params.typedText || params.signerName || '').trim();
    if (!text) {
      onChangeSignatureDataUrl(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#09090b';
    ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 32), 18, 62);
    onChangeSignatureDataUrl(canvas.toDataURL('image/png'));
  }, [toolId, sigMode, params.typedText, params.signerName, onChangeSignatureDataUrl]);

  const getNormalizedCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.1, y: 0.1 };
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const applyCropFromNormalizedRect = (
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    if (!currentThumb) return;
    const x1 = Math.min(p1.x, p2.x);
    const x2 = Math.max(p1.x, p2.x);
    const y1 = Math.min(p1.y, p2.y);
    const y2 = Math.max(p1.y, p2.y);
    if (x2 - x1 < 0.05 || y2 - y1 < 0.05) return;

    const wPt = currentThumb.width || 595.28;
    const hPt = currentThumb.height || 841.89;
    onChangeParam('left', Math.max(0, Math.round(x1 * wPt)));
    onChangeParam('right', Math.max(0, Math.round((1 - x2) * wPt)));
    onChangeParam('top', Math.max(0, Math.round(y1 * hPt)));
    onChangeParam('bottom', Math.max(0, Math.round((1 - y2) * hPt)));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-annotation-control="true"]')) return;
    const pt = getNormalizedCoords(e);

    if (toolId === 'crop-pdf') {
      setDragStart(pt);
      setDragCurrent(pt);
      return;
    }

    if (toolId === 'edit-pdf') {
      const drawTool = (params.activeDrawTool || 'text') as CanvasAnnotationType;
      if (drawTool === 'text' || drawTool === 'comment') {
        const newAnn: CanvasAnnotation = {
          id: `ann_${Date.now()}`,
          pageIndex: activePageIndex,
          type: drawTool,
          x: Math.min(0.7, pt.x),
          y: Math.min(0.92, pt.y),
          width: 0.28,
          height: drawTool === 'comment' ? 0.08 : 0.055,
          text: drawTool === 'comment' ? 'Review note' : 'New text',
          fontSize: Number(params.fontSize || 14),
          fontWeight: 'normal',
        };
        onChangeAnnotations((prev) => [...prev, newAnn]);
      } else if (drawTool === 'pen') {
        setDragStart(pt);
        setDragCurrent(pt);
        setCurrentPenPoints([pt]);
      } else {
        setDragStart(pt);
        setDragCurrent(pt);
      }
    } else if (toolId === 'redact-pdf') {
      setDragStart(pt);
      setDragCurrent(pt);
    } else if (toolId === 'sign-pdf') {
      const newSig: CanvasAnnotation = {
        id: `sig_${Date.now()}`,
        pageIndex: activePageIndex,
        type: 'signature',
        x: Math.min(0.65, pt.x),
        y: Math.min(0.86, pt.y),
        width: 0.32,
        height: 0.09,
        imageDataUrl: signatureDataUrl || undefined,
        text: params.signerName || params.typedText || 'Signed',
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
        width: fieldType === 'form-checkbox' ? 0.038 : 0.28,
        height: fieldType === 'form-checkbox' ? 0.028 : 0.038,
        fieldName: `field_${fieldType.replace('form-', '')}_${annotations.length + 1}`,
        text: '',
        checked: true,
      };
      onChangeAnnotations((prev) => [...prev, newField]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const pt = getNormalizedCoords(e);

    if (movingAnn) {
      onChangeAnnotations((prev) =>
        prev.map((item) => {
          if (item.id !== movingAnn.id) return item;
          const nextX = Math.max(0, Math.min(1 - item.width, pt.x - movingAnn.offsetX));
          const nextY = Math.max(0, Math.min(1 - item.height, pt.y - movingAnn.offsetY));
          return { ...item, x: nextX, y: nextY };
        })
      );
      return;
    }

    if (!dragStart) return;
    setDragCurrent(pt);

    if (toolId === 'edit-pdf' && params.activeDrawTool === 'pen') {
      setCurrentPenPoints((prev) => [...prev, pt]);
    } else if (toolId === 'crop-pdf') {
      applyCropFromNormalizedRect(dragStart, pt);
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (movingAnn) {
      setMovingAnn(null);
      return;
    }
    if (!dragStart) return;
    const endPt = getNormalizedCoords(e);

    if (toolId === 'crop-pdf') {
      applyCropFromNormalizedRect(dragStart, endPt);
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    if (toolId === 'edit-pdf') {
      const drawTool = (params.activeDrawTool || 'rect') as CanvasAnnotationType;
      if (drawTool === 'pen') {
        const pts = [...currentPenPoints, endPt];
        if (pts.length > 1) {
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
              points: pts,
            },
          ]);
        }
        setCurrentPenPoints([]);
      } else if (drawTool === 'line') {
        const dx = Math.abs(endPt.x - dragStart.x);
        const dy = Math.abs(endPt.y - dragStart.y);
        const finalEnd =
          dx < 0.015 && dy < 0.015
            ? { x: Math.min(0.95, dragStart.x + 0.18), y: dragStart.y }
            : endPt;
        onChangeAnnotations((prev) => [
          ...prev,
          {
            id: `line_${Date.now()}`,
            pageIndex: activePageIndex,
            type: 'line',
            x: Math.min(dragStart.x, finalEnd.x),
            y: Math.min(dragStart.y, finalEnd.y),
            width: Math.max(0.01, Math.abs(finalEnd.x - dragStart.x)),
            height: Math.max(0.01, Math.abs(finalEnd.y - dragStart.y)),
            points: [dragStart, finalEnd],
          },
        ]);
      } else if (drawTool === 'rect' || drawTool === 'highlighter') {
        const x = Math.min(dragStart.x, endPt.x);
        const y = Math.min(dragStart.y, endPt.y);
        const w = Math.max(0.06, Math.abs(endPt.x - dragStart.x));
        const h = Math.max(drawTool === 'highlighter' ? 0.022 : 0.04, Math.abs(endPt.y - dragStart.y));
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
      const w = Math.max(0.1, Math.abs(endPt.x - dragStart.x));
      const h = Math.max(0.024, Math.abs(endPt.y - dragStart.y));
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
    setDragCurrent(null);
  };

  // Auto-Scan PII Patterns for Redact PDF (Tool 29)
  const handleAutoScanRedactions = async () => {
    setScanStatus('Scanning PDF text coordinates for sensitive patterns...');
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
          width: Math.min(0.9, Math.max(0.06, m.width / dims.width)),
          height: Math.min(0.2, Math.max(0.02, m.height / dims.height)),
          text: `${m.category}: ${m.matchedText}`,
        };
      });

      onChangeAnnotations((prev) => [
        ...prev.filter((a) => a.type !== 'redaction'),
        ...newBoxes,
      ]);
      setScanStatus(
        newBoxes.length > 0
          ? `Auto-placed ${newBoxes.length} redaction box(es) across document.`
          : 'No matching emails, phones, SSNs, cards, or custom terms were detected.'
      );
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
      setScanStatus(
        newFields.length > 0
          ? `Auto-detected ${newFields.length} interactive form field(s).`
          : 'No underscore lines (___) or bracket checkboxes ([ ]) found. Click the page in Form Builder mode to place fields manually.'
      );
    } catch (err: any) {
      setScanStatus(`Detection error: ${err?.message}`);
    }
  };

  // Signature Pad Drawing Handlers with exact canvas scaling
  const getSigPadCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigPadRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || canvas.width);
    const scaleY = canvas.height / (rect.height || canvas.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startSigStroke = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigPadRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const pt = getSigPadCoords(e);
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    setIsDrawingSig(true);
  };

  const moveSigStroke = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = sigPadRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const pt = getSigPadCoords(e);
    ctx.lineTo(pt.x, pt.y);
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
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    onChangeSignatureDataUrl(null);
  };

  // Live preview rectangle when dragging rect / highlighter / redaction
  const activeDragRect =
    dragStart &&
    dragCurrent &&
    (toolId === 'redact-pdf' ||
      (toolId === 'edit-pdf' && ['rect', 'highlighter'].includes(params.activeDrawTool || '')))
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  const vectorAnnotations = pageAnnotations.filter(
    (a) => a.type === 'pen' || a.type === 'line'
  );
  const boxAnnotations = pageAnnotations.filter(
    (a) => a.type !== 'pen' && a.type !== 'line'
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Studio Action Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800">
        {/* Page Selector */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={activePageIndex <= 0}
            onClick={() => onChangeActivePage(Math.max(0, activePageIndex - 1))}
            aria-label="Previous Page"
            className="p-1.5 rounded-full border border-[#dadce0] dark:border-zinc-700 disabled:opacity-40 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
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
            className="p-1.5 rounded-full border border-[#dadce0] dark:border-zinc-700 disabled:opacity-40 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tool-Specific Studio Controls */}
        {toolId === 'edit-pdf' && (
          <div className="flex flex-wrap items-center gap-1.5">
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors cursor-pointer ${
                    isAct
                      ? 'bg-[#202124] text-white border-[#202124] dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100'
                      : 'border-[#dadce0] dark:border-zinc-700 text-[#202124] dark:text-zinc-300 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border border-[#dadce0] dark:border-zinc-700 cursor-pointer hover:bg-[#f1f3f4] dark:hover:bg-zinc-800">
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Stamp Image</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
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
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}

        {toolId === 'crop-pdf' && (
          <div className="text-xs text-[#5f6368] dark:text-zinc-400">
            Drag directly on the page below to define the crop region, or enter margins in the right panel.
          </div>
        )}

        {toolId === 'redact-pdf' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAutoScanRedactions}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950 hover:opacity-90 transition-opacity cursor-pointer"
            >
              <ScanSearch className="w-3.5 h-3.5" />
              <span>Auto-Scan PII (Emails, Phones, SSN, Cards)</span>
            </button>
          </div>
        )}

        {toolId === 'pdf-forms' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeParam('formMode', 'filler')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border cursor-pointer ${
                params.formMode === 'filler'
                  ? 'bg-[#202124] text-white border-[#202124] dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-[#dadce0] dark:border-zinc-700'
              }`}
            >
              Fill Existing ({detectedAcroFields.length})
            </button>
            <button
              type="button"
              onClick={() => onChangeParam('formMode', 'builder')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border cursor-pointer ${
                params.formMode !== 'filler'
                  ? 'bg-[#202124] text-white border-[#202124] dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-[#dadce0] dark:border-zinc-700'
              }`}
            >
              Form Builder
            </button>
            <button
              type="button"
              onClick={handleAutoDetectFormFields}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Detect (___ &amp; [ ])</span>
            </button>
          </div>
        )}

        {annotations.length > 0 && (
          <button
            type="button"
            onClick={() => onChangeAnnotations([])}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono text-[#5f6368] dark:text-zinc-400 rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear ({annotations.length})</span>
          </button>
        )}
      </div>

      {scanStatus && (
        <div className="px-4 py-2.5 text-xs font-mono rounded-xl bg-white dark:bg-[#161b22] border border-[#dadce0] dark:border-zinc-800 text-[#202124] dark:text-zinc-200">
          {scanStatus}
        </div>
      )}

      {/* Mode 1 AcroForm Filler Table when in PDF Forms Mode 1 */}
      {toolId === 'pdf-forms' && params.formMode === 'filler' && (
        <div className="p-4 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">
            Detected Embedded AcroForm Fields ({detectedAcroFields.length})
          </div>
          {detectedAcroFields.length === 0 ? (
            <p className="text-xs text-[#5f6368]">
              No pre-existing AcroForm fields found. Switch to &quot;Form Builder&quot; or click &quot;Auto-Detect&quot; to place new interactive fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {detectedAcroFields.map((fld) => (
                <div
                  key={fld.name}
                  className="p-3 rounded-xl border border-[#dadce0] dark:border-zinc-800 flex flex-col gap-1.5"
                >
                  <label className="text-xs font-mono font-semibold text-[#202124] dark:text-zinc-300">
                    {fld.name} <span className="opacity-60">({fld.type})</span>
                  </label>
                  {fld.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(acroFieldValues[fld.name] ?? fld.value)}
                      onChange={(e) => onChangeAcroFieldValue(fld.name, e.target.checked)}
                      className="w-4 h-4 accent-[#202124] dark:accent-zinc-100"
                    />
                  ) : fld.type === 'dropdown' && fld.options ? (
                    <select
                      value={String(acroFieldValues[fld.name] ?? fld.value)}
                      onChange={(e) => onChangeAcroFieldValue(fld.name, e.target.value)}
                      className="px-2.5 py-1.5 text-xs rounded-lg bg-[#f8f9fa] dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800"
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
                      className="px-2.5 py-1.5 text-xs rounded-lg bg-[#f8f9fa] dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800"
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
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 text-xs">
          <span className="font-mono text-[#5f6368]">Click page below to place:</span>
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
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border cursor-pointer ${
                  active
                    ? 'bg-[#202124] text-white border-[#202124] dark:bg-zinc-100 dark:text-zinc-950'
                    : 'bg-[#f8f9fa] dark:bg-zinc-950 border-[#dadce0] dark:border-zinc-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{b.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Signature Creator Card when in Sign PDF (Tool 28) */}
      {toolId === 'sign-pdf' && (
        <div className="p-4 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {(['draw', 'type', 'upload'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSigMode(m)}
                  className={`px-3 py-1 text-xs font-semibold rounded-full border capitalize cursor-pointer ${
                    sigMode === m
                      ? 'bg-[#202124] text-white border-[#202124] dark:bg-zinc-100 dark:text-zinc-950'
                      : 'border-[#dadce0] dark:border-zinc-700 text-[#5f6368] dark:text-zinc-300'
                  }`}
                >
                  {m === 'draw' ? 'Draw Signature' : m === 'type' ? 'Type Signature' : 'Upload Image'}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[#5f6368]">
              Create your signature, then click anywhere on the PDF page below to place it.
            </span>
          </div>

          {sigMode === 'draw' && (
            <div className="flex flex-wrap items-center gap-3">
              <canvas
                ref={sigPadRef}
                width={320}
                height={80}
                onMouseDown={startSigStroke}
                onMouseMove={moveSigStroke}
                onMouseUp={endSigStroke}
                onMouseLeave={endSigStroke}
                className="bg-[#f8f9fa] rounded-xl border border-[#dadce0] cursor-crosshair"
              />
              <button
                type="button"
                onClick={clearSigPad}
                className="px-3 py-1.5 text-xs font-mono rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 cursor-pointer"
              >
                Clear Pad
              </button>
            </div>
          )}

          {sigMode === 'type' && (
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={params.typedText || ''}
                onChange={(e) => onChangeParam('typedText', e.target.value)}
                placeholder="Type your signature name..."
                className="px-3 py-2 text-xs rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800 w-60"
              />
              <div className="px-4 py-2 rounded-xl bg-[#f8f9fa] border border-[#dadce0] min-w-[200px] h-12 flex items-center">
                {signatureDataUrl ? (
                  <img
                    src={signatureDataUrl}
                    alt="Typed signature preview"
                    className="h-9 object-contain"
                  />
                ) : (
                  <span className="text-xs text-[#5f6368] italic">Preview appears here</span>
                )}
              </div>
            </div>
          )}

          {sigMode === 'upload' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-full border border-[#dadce0] dark:border-zinc-700 cursor-pointer hover:bg-[#f1f3f4] dark:hover:bg-zinc-800">
                <Upload className="w-3.5 h-3.5" />
                <span>Choose Signature PNG / JPG</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => onChangeSignatureDataUrl(String(reader.result));
                    reader.readAsDataURL(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {signatureDataUrl && (
                <img
                  src={signatureDataUrl}
                  alt="Uploaded signature preview"
                  className="h-10 px-2 bg-[#f8f9fa] rounded-lg border border-[#dadce0] object-contain"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Interactive Page Overlay Surface */}
      {currentThumb && (
        <div className="flex justify-center bg-[#f1f3f4] dark:bg-zinc-950 p-6 rounded-2xl border border-[#dadce0] dark:border-zinc-800 overflow-auto">
          <div
            ref={containerRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={() => {
              if (movingAnn) setMovingAnn(null);
            }}
            className="relative inline-block shadow-xl border border-zinc-400 dark:border-zinc-700 select-none cursor-crosshair bg-white overflow-hidden"
            style={{ maxWidth: '640px', width: '100%' }}
          >
            <img
              src={currentThumb.dataUrl}
              alt={`PDF Page ${activePageIndex + 1}`}
              referrerPolicy="no-referrer"
              draggable={false}
              className="w-full h-auto block pointer-events-none"
            />

            {/* Vector SVG Layer for Pen Strokes, Lines, and Live Drag Previews */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              {/* Placed pen & line annotations */}
              {vectorAnnotations.map((ann) => {
                if (ann.type === 'pen' && ann.points && ann.points.length > 1) {
                  const ptsStr = ann.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
                  return (
                    <polyline
                      key={ann.id}
                      points={ptsStr}
                      fill="none"
                      stroke="#111827"
                      strokeWidth="0.45"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                }
                if (ann.type === 'line') {
                  const p1 = ann.points?.[0] || { x: ann.x, y: ann.y };
                  const p2 = ann.points?.[1] || {
                    x: ann.x + ann.width,
                    y: ann.y + ann.height,
                  };
                  return (
                    <line
                      key={ann.id}
                      x1={p1.x * 100}
                      y1={p1.y * 100}
                      x2={p2.x * 100}
                      y2={p2.y * 100}
                      stroke="#111827"
                      strokeWidth="0.5"
                      strokeLinecap="round"
                    />
                  );
                }
                return null;
              })}

              {/* Live in-progress pen stroke */}
              {currentPenPoints.length > 1 && (
                <polyline
                  points={currentPenPoints.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                  fill="none"
                  stroke="#111827"
                  strokeWidth="0.45"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Live in-progress line */}
              {toolId === 'edit-pdf' &&
                params.activeDrawTool === 'line' &&
                dragStart &&
                dragCurrent && (
                  <line
                    x1={dragStart.x * 100}
                    y1={dragStart.y * 100}
                    x2={dragCurrent.x * 100}
                    y2={dragCurrent.y * 100}
                    stroke="#111827"
                    strokeWidth="0.5"
                    strokeDasharray="1.5 1"
                  />
                )}
            </svg>

            {/* Delete pills for placed pen/line annotations */}
            {vectorAnnotations.map((ann) => {
              const anchor = ann.points?.[0] || { x: ann.x, y: ann.y };
              return (
                <button
                  key={`del_${ann.id}`}
                  type="button"
                  data-annotation-control="true"
                  aria-label={`Delete ${ann.type} annotation`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeAnnotations((prev) => prev.filter((item) => item.id !== ann.id));
                  }}
                  style={{
                    left: `${Math.min(95, Math.max(1, anchor.x * 100))}%`,
                    top: `${Math.min(95, Math.max(1, anchor.y * 100))}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 p-1 rounded-full bg-zinc-900/80 text-white opacity-60 hover:opacity-100 cursor-pointer"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              );
            })}

            {/* Live drag preview box for Rect / Highlighter / Redaction */}
            {activeDragRect && (
              <div
                className={`absolute pointer-events-none ${
                  toolId === 'redact-pdf'
                    ? 'bg-black/80 border border-white'
                    : params.activeDrawTool === 'highlighter'
                    ? 'bg-yellow-300/45 border border-yellow-500'
                    : 'border-2 border-zinc-900 bg-zinc-900/5'
                }`}
                style={{
                  left: `${activeDragRect.x * 100}%`,
                  top: `${activeDragRect.y * 100}%`,
                  width: `${activeDragRect.width * 100}%`,
                  height: `${activeDragRect.height * 100}%`,
                }}
              />
            )}

            {/* Crop Box Visual Overlay (Tool 23) */}
            {toolId === 'crop-pdf' && (
              <div
                className="absolute border-2 border-dashed border-zinc-950 pointer-events-none"
                style={{
                  top: `${Math.min(85, (Number(params.top ?? 36) / (currentThumb.height || 842)) * 100)}%`,
                  bottom: `${Math.min(85, (Number(params.bottom ?? 36) / (currentThumb.height || 842)) * 100)}%`,
                  left: `${Math.min(85, (Number(params.left ?? 36) / (currentThumb.width || 595)) * 100)}%`,
                  right: `${Math.min(85, (Number(params.right ?? 36) / (currentThumb.width || 595)) * 100)}%`,
                  boxShadow: '0 0 0 9999px rgba(9, 9, 11, 0.32)',
                }}
              >
                <span className="absolute top-1.5 left-1.5 bg-zinc-950 text-zinc-50 text-[10px] font-mono px-1.5 py-0.5 rounded">
                  CROP ({Math.max(0, Math.round(currentThumb.width - Number(params.left || 0) - Number(params.right || 0)))} ×{' '}
                  {Math.max(0, Math.round(currentThumb.height - Number(params.top || 0) - Number(params.bottom || 0)))} pt)
                </span>
              </div>
            )}

            {/* Render Placed Box / Text / Image / Signature / Redaction / Form Annotations */}
            {boxAnnotations.map((ann) => (
              <div
                key={ann.id}
                data-annotation-control="true"
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).tagName === 'INPUT') return;
                  if ((e.target as HTMLElement).tagName === 'BUTTON') return;
                  const pt = getNormalizedCoords(e as unknown as React.MouseEvent<HTMLDivElement>);
                  setMovingAnn({
                    id: ann.id,
                    offsetX: pt.x - ann.x,
                    offsetY: pt.y - ann.y,
                  });
                }}
                style={{
                  left: `${ann.x * 100}%`,
                  top: `${ann.y * 100}%`,
                  width: `${ann.width * 100}%`,
                  height: `${ann.height * 100}%`,
                }}
                className={`absolute group flex items-center justify-between cursor-move ${
                  ann.type === 'redaction'
                    ? 'bg-black text-white font-mono border border-zinc-700 px-1.5'
                    : ann.type === 'highlighter'
                    ? 'bg-yellow-300/45 border border-yellow-500/70'
                    : ann.type === 'rect'
                    ? 'bg-transparent border-2 border-zinc-900'
                    : ann.type === 'image'
                    ? 'bg-transparent border border-dashed border-zinc-500'
                    : ann.type === 'signature'
                    ? 'bg-white/90 border border-zinc-900 text-zinc-950 px-1.5'
                    : ann.type.startsWith('form-')
                    ? 'bg-zinc-100/90 border-2 border-zinc-900 text-zinc-950 font-mono px-1.5'
                    : ann.type === 'comment'
                    ? 'bg-zinc-100/95 border border-zinc-800 text-zinc-950 px-1.5'
                    : 'bg-white/90 border border-zinc-800 text-zinc-950 px-1.5'
                }`}
              >
                {ann.type === 'redaction' ? (
                  <span className="text-[10px] truncate">{ann.text || 'REDACTED'}</span>
                ) : ann.type === 'highlighter' || ann.type === 'rect' ? (
                  <span className="sr-only">{ann.type}</span>
                ) : ann.type === 'image' && ann.imageDataUrl ? (
                  <img
                    src={ann.imageDataUrl}
                    alt="Stamped graphic"
                    draggable={false}
                    className="w-full h-full object-contain pointer-events-none"
                  />
                ) : ann.type === 'signature' ? (
                  <div className="flex items-center gap-1.5 w-full h-full overflow-hidden">
                    {ann.imageDataUrl ? (
                      <img
                        src={ann.imageDataUrl}
                        alt="Signature"
                        draggable={false}
                        className="max-h-full max-w-full object-contain pointer-events-none"
                      />
                    ) : (
                      <span className="text-xs italic font-serif truncate">
                        {ann.text || 'Signed'}
                      </span>
                    )}
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
                    className="w-full bg-transparent text-[10px] font-mono text-zinc-900 focus:outline-none cursor-text"
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
                    className="w-full bg-transparent text-xs font-medium text-zinc-950 focus:outline-none cursor-text"
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
                  className="opacity-0 group-hover:opacity-100 absolute -top-2.5 -right-2.5 p-1 rounded-full bg-zinc-900 text-white shadow cursor-pointer"
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
