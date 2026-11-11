import React, { useRef, useState } from 'react';
import {
  Upload,
  RotateCw,
  Copy,
  Trash2,
  PlusSquare,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckSquare,
  Square,
  ZoomIn,
  ZoomOut,
  Plus,
  Play,
  Bookmark,
  Search,
  CopyCheck,
} from 'lucide-react';
import {
  CanvasAnnotation,
  DetectedAcroField,
  EngineOutput,
  RenderedPageThumbnail,
  SavedWorkflow,
  ToolDefinition,
  ToolId,
  UploadedFileItem,
  WorkflowStep,
} from '../types/pdf';
import { formatBytes } from '../utils/pdfHelpers';
import { InteractivePageStudio } from './InteractivePageStudio';
import { applyScannerMonochromeFilter } from '../engines/organizeEngine';
import { ToolIcon } from './ToolIcon';

interface CenterCanvasProps {
  tool: ToolDefinition;
  files: UploadedFileItem[];
  thumbnails: RenderedPageThumbnail[];
  isLoadingThumbnails: boolean;
  onGoHome: () => void;
  onUploadFiles: (fileList: FileList | null) => void;
  onClearWorkspace: () => void;
  onToggleSelectThumb: (idx: number) => void;
  onSelectAllThumbs: (selected: boolean) => void;
  onRotateThumb: (idx: number, deltaAngle: number) => void;
  onDuplicateThumb: (idx: number) => void;
  onInsertBlankThumb: (afterIdx: number) => void;
  onDeleteThumb: (idx: number) => void;
  onMoveThumb: (fromIdx: number, toIdx: number) => void;
  onMoveFile: (fromIdx: number, toIdx: number) => void;
  onRemoveFile: (fileId: string) => void;
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
  capturedScans: string[];
  onAddCapturedScan: (dataUrl: string) => void;
  onClearCapturedScans: () => void;
  workflowSteps: WorkflowStep[];
  onChangeWorkflowSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>>;
  savedWorkflows: SavedWorkflow[];
  onSaveWorkflow: (name: string, description: string) => void;
  onLoadWorkflow: (wf: SavedWorkflow) => void;
  onDeleteSavedWorkflow: (id: string) => void;
  lastOutput: EngineOutput | null;
  onExecuteTool: () => void;
}

const STUDIO_TOOLS: ToolId[] = [
  'crop-pdf',
  'edit-pdf',
  'pdf-forms',
  'sign-pdf',
  'redact-pdf',
];

export const CenterCanvas: React.FC<CenterCanvasProps> = ({
  tool,
  files,
  thumbnails,
  isLoadingThumbnails,
  onGoHome,
  onUploadFiles,
  onClearWorkspace,
  onToggleSelectThumb,
  onSelectAllThumbs,
  onRotateThumb,
  onDuplicateThumb,
  onInsertBlankThumb,
  onDeleteThumb,
  onMoveThumb,
  onMoveFile,
  onRemoveFile,
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
  capturedScans,
  onAddCapturedScan,
  onClearCapturedScans,
  workflowSteps,
  onChangeWorkflowSteps,
  savedWorkflows,
  onSaveWorkflow,
  onLoadWorkflow,
  onDeleteSavedWorkflow,
  lastOutput,
  onExecuteTool,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [thumbScale, setThumbScale] = useState<number>(1);
  const [readerSearchQuery, setReaderSearchQuery] = useState('');
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [copiedText, setCopiedText] = useState(false);

  const startWebcam = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err: any) {
      setCameraError(
        err?.message || 'Camera permission unavailable. Please allow camera access or upload an image.'
      );
    }
  };

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const captureWebcamFrame = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 800;
    canvas.height = videoRef.current.videoHeight || 1000;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const rawUrl = canvas.toDataURL('image/jpeg', 0.9);
    const filtered = await applyScannerMonochromeFilter(
      rawUrl,
      params.filterMode || 'adaptive-mono',
      Number(params.threshold ?? 145),
      Number(params.contrast ?? 1.45)
    );
    onAddCapturedScan(filtered.dataUrl);
  };

  const isEmptyUploadStage =
    files.length === 0 &&
    tool.id !== 'html-to-pdf' &&
    tool.id !== 'scan-to-pdf' &&
    tool.id !== 'custom-workflows';

  return (
    <main className="flex-1 min-h-[calc(100vh-4rem)] flex flex-col bg-[#f8f9fa] dark:bg-[#0d1117] overflow-y-auto">
      {/* Sub-header Breadcrumb & Tool Title */}
      <div className="px-6 py-3.5 bg-white dark:bg-[#161b22] border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-[#f1f3f4] dark:bg-zinc-800 text-[#202124] dark:text-zinc-200 hover:bg-[#e8eaed] dark:hover:bg-zinc-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>All Tools</span>
          </button>

          <div className="w-8 h-8 rounded-lg bg-[#f1f3f4] dark:bg-zinc-800 flex items-center justify-center text-[#202124] dark:text-zinc-100 shrink-0">
            <ToolIcon toolId={tool.id} className="w-4 h-4" />
          </div>

          <h1 className="text-base font-bold text-[#202124] dark:text-zinc-50 whitespace-nowrap shrink-0">
            {tool.name}
          </h1>
          <span className="hidden lg:inline text-xs text-[#5f6368] dark:text-zinc-400 truncate">
            · {tool.description}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950 hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Select {tool.multipleFiles ? 'Files' : 'File'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={tool.acceptedFormats}
            multiple={tool.multipleFiles}
            onChange={(e) => {
              onUploadFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>
      </div>

      {/* STAGE 1: iLovePDF Centered Upload Screen when no files are uploaded */}
      {isEmptyUploadStage ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onUploadFiles(e.dataTransfer.files);
          }}
          className="flex-1 flex flex-col items-center justify-center p-8 text-center"
        >
          <div className="max-w-xl w-full bg-white dark:bg-[#161b22] rounded-3xl border border-[#dadce0] dark:border-zinc-800 p-12 shadow-xs flex flex-col items-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-[#f1f3f4] dark:bg-zinc-800 text-[#202124] dark:text-zinc-100 flex items-center justify-center">
              <ToolIcon toolId={tool.id} className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl md:text-3xl font-bold text-[#202124] dark:text-zinc-50">
                {tool.name}
              </h2>
              <p className="text-sm text-[#5f6368] dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                {tool.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full max-w-xs py-4 px-8 rounded-2xl text-base font-bold bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950 hover:opacity-95 shadow-md transition-all flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <Upload className="w-5 h-5" />
              <span>
                Select {tool.acceptedFormats.includes('.pdf') ? 'PDF' : ''} file
                {tool.multipleFiles ? 's' : ''}
              </span>
            </button>

            <div className="space-y-1 text-xs text-[#5f6368] dark:text-zinc-500">
              <p>or drop files here</p>
              <p className="font-mono text-[11px]">
                Accepted: {tool.acceptedFormats} · 100% Local Processing
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* STAGE 2: Active Workspace Canvas */
        <div className="flex-1 p-6 space-y-6 max-w-6xl w-full mx-auto">
          {/* SPECIAL VIEW 1: HTML / MARKDOWN TO PDF LIVE SPLIT EDITOR (Tool 14) */}
          {tool.id === 'html-to-pdf' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-200px)] min-h-[460px]">
              <div className="flex flex-col rounded-2xl border border-[#dadce0] dark:border-zinc-800 bg-white dark:bg-[#161b22] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between text-xs font-mono text-[#5f6368]">
                  <span>SOURCE MARKUP ({(params.sourceFormat || 'markdown').toUpperCase()})</span>
                  <span>{(params.rawContent || '').length} chars</span>
                </div>
                <textarea
                  aria-label="HTML or Markdown Source Markup"
                  value={params.rawContent || ''}
                  onChange={(e) => onChangeParam('rawContent', e.target.value)}
                  className="flex-1 p-4 font-mono text-xs bg-transparent text-[#202124] dark:text-zinc-100 focus:outline-none resize-none leading-relaxed"
                  placeholder="Type or paste Markdown or HTML here, or upload an .html/.md file..."
                />
              </div>
              <div className="flex flex-col rounded-2xl border border-[#dadce0] dark:border-zinc-800 bg-white dark:bg-[#161b22] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between text-xs font-mono text-[#5f6368]">
                  <span>LIVE PAGINATED VECTOR PREVIEW</span>
                  <span>A4 PORTRAIT</span>
                </div>
                <div className="flex-1 p-6 overflow-y-auto space-y-3 text-[#202124] dark:text-zinc-100">
                  {(params.rawContent || '').split('\n').map((line: string, i: number) => {
                    const t = line.trim();
                    if (!t) return <div key={i} className="h-2" />;
                    if (t.startsWith('# '))
                      return (
                        <h2
                          key={i}
                          className="text-xl font-bold border-b border-[#dadce0] dark:border-zinc-800 pb-1"
                        >
                          {t.slice(2)}
                        </h2>
                      );
                    if (t.startsWith('## '))
                      return (
                        <h3 key={i} className="text-base font-bold pt-2">
                          {t.slice(3)}
                        </h3>
                      );
                    if (t.startsWith('- '))
                      return (
                        <div key={i} className="text-xs pl-3 flex items-start gap-2">
                          <span>•</span>
                          <span>{t.slice(2)}</span>
                        </div>
                      );
                    if (t.startsWith('|'))
                      return (
                        <div
                          key={i}
                          className="font-mono text-xs bg-[#f1f3f4] dark:bg-zinc-900 px-2 py-1 rounded"
                        >
                          {t}
                        </div>
                      );
                    return (
                      <p key={i} className="text-xs leading-relaxed text-[#5f6368] dark:text-zinc-300">
                        {t}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* SPECIAL VIEW 2: SCAN TO PDF WEBCAM & MONOCHROME SCANNER (Tool 6) */}
          {tool.id === 'scan-to-pdf' && (
            <div className="space-y-4">
              <div className="p-5 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold">Document Camera Scanner</h2>
                  <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                    Capture pages from your camera or upload photos to apply adaptive monochrome thresholding.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isCameraActive ? (
                    <button
                      type="button"
                      onClick={startWebcam}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Start Camera</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={captureWebcamFrame}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Capture Scan Page</span>
                      </button>
                      <button
                        type="button"
                        onClick={stopWebcam}
                        className="px-3.5 py-1.5 text-xs rounded-full border border-[#dadce0] dark:border-zinc-700"
                      >
                        Stop Camera
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Photos</span>
                  </button>
                  {capturedScans.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearCapturedScans}
                      className="px-3 py-1.5 text-xs font-mono text-[#5f6368] rounded-full border border-[#dadce0] dark:border-zinc-700"
                    >
                      Clear ({capturedScans.length})
                    </button>
                  )}
                </div>
              </div>

              {cameraError && (
                <div className="px-4 py-3 text-xs font-mono rounded-xl bg-white dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800">
                  {cameraError}
                </div>
              )}

              {isCameraActive && (
                <div className="p-4 bg-black rounded-2xl flex justify-center border border-zinc-800">
                  <video ref={videoRef} className="max-h-80 w-auto grayscale contrast-125" muted playsInline />
                </div>
              )}

              {capturedScans.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {capturedScans.map((url, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-white dark:bg-[#161b22] rounded-xl border border-[#dadce0] dark:border-zinc-800 space-y-2"
                    >
                      <img
                        src={url}
                        alt={`Captured Scan ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-auto rounded border border-[#dadce0] dark:border-zinc-800"
                      />
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#5f6368]">
                        <span>SCAN #{idx + 1}</span>
                        <span>MONO FILTERED</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SPECIAL VIEW 3: CUSTOM AUTOMATED WORKFLOWS PIPELINE BUILDER (Tool 34) */}
          {tool.id === 'custom-workflows' && (
            <div className="space-y-6">
              <div className="p-6 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold">Automated Multi-Step Pipeline Builder</h2>
                    <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                      Chain multiple PDF tools into a reusable macro so the output of each step feeds into the next step.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Select Input PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={onExecuteTool}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Run Pipeline ({workflowSteps.length} Steps)</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {workflowSteps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950">
                          {idx + 1}
                        </span>
                        <ToolIcon toolId={step.toolId} className="w-4 h-4 text-[#5f6368]" />
                        <select
                          aria-label={`Pipeline Step ${idx + 1} Tool`}
                          value={step.toolId}
                          onChange={(e) => {
                            const newToolId = e.target.value as ToolId;
                            onChangeWorkflowSteps((prev) =>
                              prev.map((s, i) => (i === idx ? { ...s, toolId: newToolId } : s))
                            );
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800"
                        >
                          <option value="rotate-pdf">Rotate PDF</option>
                          <option value="watermark-pdf">Add Watermark</option>
                          <option value="page-numbers">Add Page Numbers</option>
                          <option value="crop-pdf">Crop PDF</option>
                          <option value="compress-pdf">Compress PDF</option>
                          <option value="repair-pdf">Repair PDF</option>
                          <option value="remove-pages">Remove Pages</option>
                          <option value="protect-pdf">Protect PDF</option>
                        </select>

                        {step.toolId === 'rotate-pdf' && (
                          <select
                            value={step.params.angle || 90}
                            onChange={(e) =>
                              onChangeWorkflowSteps((prev) =>
                                prev.map((s, i) =>
                                  i === idx
                                    ? { ...s, params: { ...s.params, angle: Number(e.target.value) } }
                                    : s
                                )
                              )
                            }
                            className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800"
                          >
                            <option value={90}>90° CW</option>
                            <option value={180}>180°</option>
                            <option value={270}>270° CW</option>
                          </select>
                        )}

                        {step.toolId === 'watermark-pdf' && (
                          <input
                            type="text"
                            value={step.params.text || 'CONFIDENTIAL'}
                            onChange={(e) =>
                              onChangeWorkflowSteps((prev) =>
                                prev.map((s, i) =>
                                  i === idx
                                    ? { ...s, params: { ...s.params, text: e.target.value } }
                                    : s
                                )
                              )
                            }
                            placeholder="Watermark text"
                            className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800"
                          />
                        )}

                        {step.toolId === 'compress-pdf' && (
                          <select
                            value={step.params.preset || 'recommended'}
                            onChange={(e) =>
                              onChangeWorkflowSteps((prev) =>
                                prev.map((s, i) =>
                                  i === idx
                                    ? { ...s, params: { ...s.params, preset: e.target.value } }
                                    : s
                                )
                              )
                            }
                            className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800"
                          >
                            <option value="extreme">Extreme</option>
                            <option value="recommended">Recommended</option>
                            <option value="less">Less</option>
                          </select>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onChangeWorkflowSteps((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label={`Remove Step ${idx + 1}`}
                        className="p-1.5 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() =>
                      onChangeWorkflowSteps((prev) => [
                        ...prev,
                        {
                          id: `step_${Date.now()}`,
                          toolId: 'page-numbers',
                          params: { position: 'bottom-right', template: 'Page {n} of {total}' },
                        },
                      ])
                    }
                    className="w-full py-3 rounded-xl border border-dashed border-[#dadce0] dark:border-zinc-700 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 hover:border-[#202124] flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Pipeline Step</span>
                  </button>
                </div>

                {/* Save Macro to localStorage */}
                <div className="pt-3 border-t border-[#dadce0] dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={newWorkflowName}
                      onChange={(e) => setNewWorkflowName(e.target.value)}
                      placeholder="Save macro name..."
                      className="px-3.5 py-1.5 text-xs rounded-full bg-[#f8f9fa] dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800 flex-1 max-w-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newWorkflowName.trim()) return;
                        onSaveWorkflow(
                          newWorkflowName.trim(),
                          `${workflowSteps.length} chained operations`
                        );
                        setNewWorkflowName('');
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>Save Macro</span>
                    </button>
                  </div>

                  {savedWorkflows.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {savedWorkflows.map((wf) => (
                        <div
                          key={wf.id}
                          className="flex items-center rounded-full border border-[#dadce0] dark:border-zinc-800 bg-[#f1f3f4] dark:bg-zinc-900 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => onLoadWorkflow(wf)}
                            className="px-3 py-1 font-medium hover:underline"
                          >
                            {wf.name} ({wf.steps.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSavedWorkflow(wf.id)}
                            aria-label={`Delete workflow ${wf.name}`}
                            className="px-2 py-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* UPLOADED FILES QUEUE & VISUAL THUMBNAILS */}
          {files.length > 0 && (
            <div className="space-y-6">
              {/* Uploaded File Queue Card */}
              <div className="p-4 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-[#5f6368] dark:text-zinc-400">
                    SELECTED FILES ({files.length})
                  </span>
                  <div className="flex items-center gap-2">
                    {tool.multipleFiles && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1 text-xs font-semibold rounded-full bg-[#f1f3f4] dark:bg-zinc-800 hover:bg-[#e8eaed] dark:hover:bg-zinc-700"
                      >
                        + Add More Files
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClearWorkspace}
                      className="px-3 py-1 text-xs font-mono text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100 rounded-full border border-[#dadce0] dark:border-zinc-800"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-[#f1f3f4] dark:divide-zinc-800/70">
                  {files.map((file, idx) => (
                    <div
                      key={file.id}
                      className="py-2.5 flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-[#5f6368] tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="font-semibold truncate text-[#202124] dark:text-zinc-100">
                          {file.name}
                        </span>
                        <span className="font-mono text-[#5f6368] tabular-nums shrink-0">
                          · {formatBytes(file.size)} · {file.pageCount}p
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {files.length > 1 && (
                          <>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => onMoveFile(idx, idx - 1)}
                              aria-label={`Move ${file.name} up`}
                              className="p-1 rounded border border-[#dadce0] dark:border-zinc-800 disabled:opacity-30"
                            >
                              <ArrowLeft className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === files.length - 1}
                              onClick={() => onMoveFile(idx, idx + 1)}
                              aria-label={`Move ${file.name} down`}
                              className="p-1 rounded border border-[#dadce0] dark:border-zinc-800 disabled:opacity-30"
                            >
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveFile(file.id)}
                          aria-label={`Remove ${file.name}`}
                          className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* BUILT-IN PDF READER VIEW */}
              {tool.id === 'pdf-reader' && thumbnails.length > 0 && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={activePageIndex <= 0}
                        onClick={() => onChangeActivePage(Math.max(0, activePageIndex - 1))}
                        className="px-3 py-1 text-xs rounded-full border border-[#dadce0] dark:border-zinc-700 disabled:opacity-40"
                      >
                        Prev Page
                      </button>
                      <span className="text-xs font-mono tabular-nums">
                        Page {activePageIndex + 1} of {thumbnails.length}
                      </span>
                      <button
                        type="button"
                        disabled={activePageIndex >= thumbnails.length - 1}
                        onClick={() =>
                          onChangeActivePage(Math.min(thumbnails.length - 1, activePageIndex + 1))
                        }
                        className="px-3 py-1 text-xs rounded-full border border-[#dadce0] dark:border-zinc-700 disabled:opacity-40"
                      >
                        Next Page
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[#5f6368] absolute left-3 top-2" />
                        <input
                          type="text"
                          value={readerSearchQuery}
                          onChange={(e) => setReaderSearchQuery(e.target.value)}
                          placeholder="Filter page..."
                          className="pl-8 pr-3 py-1 text-xs rounded-full bg-[#f1f3f4] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setThumbScale((s) => Math.max(0.6, s - 0.2))}
                        aria-label="Zoom Out"
                        className="p-1.5 rounded-full border border-[#dadce0] dark:border-zinc-700"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-mono tabular-nums">
                        {Math.round(thumbScale * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setThumbScale((s) => Math.min(1.8, s + 0.2))}
                        aria-label="Zoom In"
                        className="p-1.5 rounded-full border border-[#dadce0] dark:border-zinc-700"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-center bg-[#f1f3f4] dark:bg-zinc-950 p-6 rounded-2xl border border-[#dadce0] dark:border-zinc-800 overflow-auto">
                    {thumbnails[activePageIndex] && (
                      <img
                        src={thumbnails[activePageIndex].dataUrl}
                        alt={`Reader Page ${activePageIndex + 1}`}
                        referrerPolicy="no-referrer"
                        style={{ width: `${Math.round(580 * thumbScale)}px` }}
                        className="shadow-xl rounded border border-[#dadce0] dark:border-zinc-700 bg-white"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* COMPARE PDF SIDE-BY-SIDE DIFF & PIXEL OVERLAY VIEW (Tool 30) */}
              {tool.id === 'compare-pdf' && lastOutput?.diffResult && (
                <div className="p-5 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between border-b border-[#dadce0] dark:border-zinc-800 pb-3">
                    <div className="text-sm font-bold">
                      Comparison Results (
                      {params.compareMode === 'visual'
                        ? 'Visual Pixel Difference Overlay'
                        : 'Semantic Text Diff'}
                      )
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span>+{lastOutput.diffResult.addedCount} Added</span>
                      <span>·</span>
                      <span>-{lastOutput.diffResult.removedCount} Removed</span>
                    </div>
                  </div>

                  {params.compareMode === 'visual' &&
                  lastOutput.diffResult.visualOverlayDataUrls ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {lastOutput.diffResult.visualOverlayDataUrls.map((url, idx) => (
                        <div key={idx} className="space-y-1.5">
                          <div className="text-xs font-mono text-[#5f6368]">
                            PAGE {idx + 1} PIXEL DIFFERENCE OVERLAY
                          </div>
                          <img
                            src={url}
                            alt={`Visual Diff Page ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-auto rounded-lg border border-zinc-700"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800 font-mono text-xs leading-relaxed max-h-96 overflow-y-auto">
                      {lastOutput.diffResult.parts.map((part, i) => (
                        <span
                          key={i}
                          className={
                            part.added
                              ? 'font-bold underline bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950 px-1 mx-0.5'
                              : part.removed
                              ? 'line-through text-[#5f6368] dark:text-zinc-500 px-1 mx-0.5'
                              : 'text-[#202124] dark:text-zinc-300'
                          }
                        >
                          {part.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* INTERACTIVE CANVAS STUDIO OVERLAY FOR CROP, EDIT, FORMS, SIGN, REDACT */}
              {STUDIO_TOOLS.includes(tool.id) && files[0] && thumbnails.length > 0 && (
                <InteractivePageStudio
                  toolId={tool.id}
                  file={files[0]}
                  thumbnails={thumbnails}
                  activePageIndex={activePageIndex}
                  onChangeActivePage={onChangeActivePage}
                  annotations={annotations}
                  onChangeAnnotations={onChangeAnnotations}
                  params={params}
                  onChangeParam={onChangeParam}
                  detectedAcroFields={detectedAcroFields}
                  acroFieldValues={acroFieldValues}
                  onChangeAcroFieldValue={onChangeAcroFieldValue}
                  signatureDataUrl={signatureDataUrl}
                  onChangeSignatureDataUrl={onChangeSignatureDataUrl}
                />
              )}

              {/* TEXT / MARKDOWN / SUMMARY / OCR TRANSCRIPT LIVE PREVIEW */}
              {lastOutput?.textOutput && (
                <div className="p-5 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#5f6368]">
                      Generated Output Transcript / Markdown Preview
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(lastOutput.textOutput || '');
                        setCopiedText(true);
                        setTimeout(() => setCopiedText(false), 1500);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
                    >
                      <CopyCheck className="w-3.5 h-3.5" />
                      <span>{copiedText ? 'Copied!' : 'Copy Text'}</span>
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-[#dadce0] dark:border-zinc-800 text-xs font-mono whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                    {lastOutput.textOutput}
                  </pre>
                </div>
              )}

              {/* VISUAL PAGE THUMBNAIL GRID */}
              {!STUDIO_TOOLS.includes(tool.id) &&
                tool.id !== 'pdf-reader' &&
                thumbnails.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-semibold text-[#202124] dark:text-zinc-300">
                          PAGES ({thumbnails.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectAllThumbs(true)}
                          className="flex items-center gap-1 text-xs text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>Select All</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectAllThumbs(false)}
                          className="flex items-center gap-1 text-xs text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                        >
                          <Square className="w-3.5 h-3.5" />
                          <span>Deselect</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onInsertBlankThumb(thumbnails.length - 1)}
                          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full border border-[#dadce0] dark:border-zinc-700 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800"
                        >
                          <PlusSquare className="w-3.5 h-3.5" />
                          <span>Insert Blank Page</span>
                        </button>
                      </div>
                    </div>

                    {isLoadingThumbnails ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map((n) => (
                          <div
                            key={n}
                            className="h-64 rounded-2xl bg-zinc-200/60 dark:bg-zinc-900 animate-pulse border border-[#dadce0] dark:border-zinc-800"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {thumbnails.map((thumb, idx) => (
                          <div
                            key={`${thumb.sourceFileId}_${thumb.pageIndex}_${idx}`}
                            onClick={() => onToggleSelectThumb(idx)}
                            className={`group relative flex flex-col justify-between p-3.5 bg-white dark:bg-[#161b22] rounded-2xl border transition-all cursor-pointer ${
                              thumb.selected
                                ? 'border-[#202124] dark:border-zinc-100 ring-2 ring-[#202124] dark:ring-zinc-100'
                                : 'border-[#dadce0] dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2 text-[11px] font-mono">
                              <span className="font-semibold">
                                Page {idx + 1}
                                {thumb.rotation ? ` (${thumb.rotation}°)` : ''}
                              </span>
                              <span className="text-[#5f6368]">
                                {Math.round(thumb.width)}×{Math.round(thumb.height)}pt
                              </span>
                            </div>

                            <div className="relative bg-[#f8f9fa] dark:bg-zinc-950 rounded-xl border border-[#dadce0] dark:border-zinc-800 flex items-center justify-center overflow-hidden aspect-[1/1.414]">
                              {thumb.isBlank ? (
                                <span className="text-xs font-mono text-[#5f6368]">
                                  BLANK PAGE
                                </span>
                              ) : (
                                <img
                                  src={thumb.dataUrl}
                                  alt={`Page ${idx + 1}`}
                                  referrerPolicy="no-referrer"
                                  style={{
                                    transform: `rotate(${thumb.rotation || 0}deg)`,
                                  }}
                                  className="max-h-full max-w-full object-contain transition-transform"
                                />
                              )}
                            </div>

                            <div
                              className="flex items-center justify-between pt-2.5 mt-2 border-t border-[#f1f3f4] dark:border-zinc-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => onMoveThumb(idx, idx - 1)}
                                  aria-label={`Move Page ${idx + 1} Left`}
                                  className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100 disabled:opacity-30"
                                >
                                  <ArrowLeft className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === thumbnails.length - 1}
                                  onClick={() => onMoveThumb(idx, idx + 1)}
                                  aria-label={`Move Page ${idx + 1} Right`}
                                  className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100 disabled:opacity-30"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => onRotateThumb(idx, 90)}
                                  aria-label={`Rotate Page ${idx + 1} 90 degrees`}
                                  className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                                >
                                  <RotateCw className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDuplicateThumb(idx)}
                                  aria-label={`Duplicate Page ${idx + 1}`}
                                  className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                {thumbnails.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteThumb(idx)}
                                    aria-label={`Remove Page ${idx + 1}`}
                                    className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-zinc-100"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </main>
  );
};
