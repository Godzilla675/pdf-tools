import React, { useState } from 'react';
import {
  Play,
  Download,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  AiEngineSettings,
  EngineOutput,
  RenderedPageThumbnail,
  ToolDefinition,
  ToolId,
  UploadedFileItem,
} from '../types/pdf';
import { calculateByteDelta, formatBytes } from '../utils/pdfHelpers';
import { TOOLS_REGISTRY } from '../registry/toolsRegistry';
import { checkOllamaConnection } from '../engines/aiEngine';

interface RightInspectorProps {
  tool: ToolDefinition;
  files: UploadedFileItem[];
  thumbnails: RenderedPageThumbnail[];
  params: Record<string, any>;
  onChangeParam: (key: string, val: any) => void;
  aiSettings: AiEngineSettings;
  onChangeAiSettings: React.Dispatch<React.SetStateAction<AiEngineSettings>>;
  isProcessing: boolean;
  progressMessage: string;
  errorMessage: string;
  lastOutput: EngineOutput | null;
  onExecute: () => void;
  onDownloadOutput: () => void;
  onDownloadSecondary: (idx: number) => void;
  onChainToTool: (nextToolId: ToolId) => void;
  onUploadWatermarkImage: (bytes: Uint8Array) => void;
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  tool,
  files,
  thumbnails,
  params,
  onChangeParam,
  aiSettings,
  onChangeAiSettings,
  isProcessing,
  progressMessage,
  errorMessage,
  lastOutput,
  onExecute,
  onDownloadOutput,
  onDownloadSecondary,
  onChainToTool,
  onUploadWatermarkImage,
}) => {
  const [nextChainToolId, setNextChainToolId] = useState<ToolId>('compress-pdf');
  const [ollamaStatus, setOllamaStatus] = useState<string>('Unchecked');

  const totalInputBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalPages =
    thumbnails.length || files.reduce((acc, f) => acc + (f.pageCount || 1), 0);
  const selectedCount = thumbnails.filter((t) => t.selected).length;

  const chainableTools = TOOLS_REGISTRY.filter(
    (t) => t.supportsChainInput && t.id !== tool.id && t.number >= 1
  );

  const probeOllama = async () => {
    setOllamaStatus('Probing...');
    const res = await checkOllamaConnection(aiSettings.ollamaUrl);
    if (res.online) {
      setOllamaStatus(
        `Connected (${res.models.length > 0 ? res.models.slice(0, 2).join(', ') : 'Ready'})`
      );
    } else {
      setOllamaStatus('Offline (Using TF-IDF Fallback)');
    }
  };

  const delta = lastOutput
    ? calculateByteDelta(lastOutput.beforeSize, lastOutput.afterSize)
    : null;

  return (
    <aside
      aria-label="Tool Inspector Panel"
      className="w-80 shrink-0 min-h-[calc(100vh-4rem)] flex flex-col bg-white dark:bg-[#161b22] border-l border-[#dadce0] dark:border-zinc-800 select-none"
    >
      {/* Inspector Header */}
      <div className="h-12 px-4 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-mono font-bold tracking-wider uppercase text-[#202124] dark:text-zinc-100">
          {tool.name} Options
        </span>
        <span className="text-[11px] font-mono text-[#5f6368] tabular-nums">
          #{tool.number > 0 ? String(tool.number).padStart(2, '0') : 'RD'}
        </span>
      </div>

      {/* Scrollable Inspector Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Real-time Telemetry Block */}
        <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
          <div className="text-[11px] font-mono text-zinc-500 uppercase">
            INPUT STREAM TELEMETRY
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
            <div>
              <div className="text-zinc-400 text-[10px]">FILES</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {files.length}
              </div>
            </div>
            <div>
              <div className="text-zinc-400 text-[10px]">INPUT SIZE</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {formatBytes(totalInputBytes)}
              </div>
            </div>
            <div>
              <div className="text-zinc-400 text-[10px]">TOTAL PAGES</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {totalPages}
              </div>
            </div>
            <div>
              <div className="text-zinc-400 text-[10px]">SELECTED</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedCount}p
              </div>
            </div>
          </div>
        </div>

        {/* CONTEXT-AWARE CONTROLS FOR EACH OF THE 33 TOOLS */}
        <div className="space-y-4">
          {/* 1. Merge PDF */}
          {tool.id === 'merge-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">File Sort Order</label>
                <select
                  aria-label="File Sort Order"
                  value={params.sortOrder || 'custom'}
                  onChange={(e) => onChangeParam('sortOrder', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="custom">Custom Drag Order</option>
                  <option value="az">Filename A → Z</option>
                  <option value="za">Filename Z → A</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Page Selection Scope</label>
                <select
                  aria-label="Page Selection Scope"
                  value={params.selectionMode || 'all'}
                  onChange={(e) => onChangeParam('selectionMode', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="all">Merge All Pages</option>
                  <option value="selected">Merge Visually Selected Pages Only</option>
                </select>
              </div>
            </>
          )}

          {/* 2. Split PDF */}
          {tool.id === 'split-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Split Engine Mode</label>
                <select
                  aria-label="Split Engine Mode"
                  value={params.splitMode || 'ranges'}
                  onChange={(e) => onChangeParam('splitMode', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="ranges">(a) Custom Page Ranges</option>
                  <option value="interval">(b) Fixed Page Interval (Every N)</option>
                  <option value="burst">(c) Burst All Pages to ZIP</option>
                  <option value="smart">(d) Smart Content Split (Markers)</option>
                </select>
              </div>
              {params.splitMode === 'ranges' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold block">
                      Page Ranges (e.g. 1-2, 3-4)
                    </label>
                    <input
                      type="text"
                      value={params.rangeString || '1-2, 3'}
                      onChange={(e) => onChangeParam('rangeString', e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={Boolean(params.mergeRangesIntoSinglePdf)}
                      onChange={(e) =>
                        onChangeParam('mergeRangesIntoSinglePdf', e.target.checked)
                      }
                    />
                    <span>Combine extracted ranges into one PDF</span>
                  </label>
                </>
              )}
              {params.splitMode === 'interval' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold block">Split Every N Pages</label>
                  <input
                    type="number"
                    min={1}
                    value={params.intervalPages || 2}
                    onChange={(e) => onChangeParam('intervalPages', Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                  />
                </div>
              )}
              {params.splitMode === 'smart' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold block">
                    Boundary Regex Marker
                  </label>
                  <input
                    type="text"
                    value={params.smartMarker || 'Chapter|Invoice #|Page 1 of'}
                    onChange={(e) => onChangeParam('smartMarker', e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                  />
                </div>
              )}
            </>
          )}

          {/* 3. Remove Pages */}
          {tool.id === 'remove-pages' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">
                  Pages to Delete (even, odd, or 2, 4-6)
                </label>
                <input
                  type="text"
                  value={params.removeRanges || '2'}
                  onChange={(e) => onChangeParam('removeRanges', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.useVisualSelection !== false}
                  onChange={(e) => onChangeParam('useVisualSelection', e.target.checked)}
                />
                <span>Prioritize clicked visual thumbnails ({selectedCount} selected)</span>
              </label>
            </>
          )}

          {/* 4. Extract Pages */}
          {tool.id === 'extract-pages' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">
                  Pages to Extract (e.g. 1, 3 or odd)
                </label>
                <input
                  type="text"
                  value={params.extractRanges || '1, 3'}
                  onChange={(e) => onChangeParam('extractRanges', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(params.exportAsZip)}
                  onChange={(e) => onChangeParam('exportAsZip', e.target.checked)}
                />
                <span>Export as individual PDFs inside a .zip</span>
              </label>
            </>
          )}

          {/* 5. Organize PDF */}
          {tool.id === 'organize-pdf' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">
                Use the thumbnail controls in the center canvas to reorder pages, rotate 90°, duplicate pages, or insert blank pages.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(params.interleaveSecondPdf)}
                  onChange={(e) => onChangeParam('interleaveSecondPdf', e.target.checked)}
                />
                <span>Interleave pages with 2nd uploaded PDF</span>
              </label>
            </div>
          )}

          {/* 6. Scan to PDF */}
          {tool.id === 'scan-to-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Scanner Filter Mode</label>
                <select
                  value={params.filterMode || 'adaptive-mono'}
                  onChange={(e) => onChangeParam('filterMode', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="adaptive-mono">Adaptive Monochrome B&W</option>
                  <option value="high-contrast-gray">High-Contrast Grayscale</option>
                  <option value="original">Unfiltered Original</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">
                  Threshold Level ({params.threshold ?? 145})
                </label>
                <input
                  type="range"
                  min={80}
                  max={210}
                  value={params.threshold ?? 145}
                  onChange={(e) => onChangeParam('threshold', Number(e.target.value))}
                  className="w-full accent-zinc-900 dark:accent-zinc-100"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Output Page Size</label>
                <select
                  value={params.pageSize || 'A4'}
                  onChange={(e) => onChangeParam('pageSize', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="A4">ISO A4</option>
                  <option value="Letter">US Letter</option>
                  <option value="Fit">Fit to Scanned Frame</option>
                </select>
              </div>
            </>
          )}

          {/* 7. Compress PDF */}
          {tool.id === 'compress-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Compression Preset</label>
                <select
                  aria-label="Compression Preset"
                  value={params.preset || 'recommended'}
                  onChange={(e) => onChangeParam('preset', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="extreme">Extreme (0.4 Quality, 1.0x Scale)</option>
                  <option value="recommended">Recommended (0.65 Quality, 1.25x Scale)</option>
                  <option value="less">Less Compression (0.85 Quality, 1.5x Scale)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(params.grayscale)}
                  onChange={(e) => onChangeParam('grayscale', e.target.checked)}
                />
                <span>Convert pages to monochrome grayscale</span>
              </label>
            </>
          )}

          {/* 8. Repair PDF */}
          {tool.id === 'repair-pdf' && (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.deepStreamRebuild !== false}
                  onChange={(e) => onChangeParam('deepStreamRebuild', e.target.checked)}
                />
                <span>Fault-tolerant XRef & page tree reconstruction</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.sanitizeMetadata !== false}
                  onChange={(e) => onChangeParam('sanitizeMetadata', e.target.checked)}
                />
                <span>Normalize corrupted catalog metadata</span>
              </label>
            </>
          )}

          {/* 9. OCR PDF */}
          {tool.id === 'ocr-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Recognition Language</label>
                <select
                  value={params.language || 'eng'}
                  onChange={(e) => onChangeParam('language', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="eng">English (eng)</option>
                  <option value="spa">Spanish (spa)</option>
                  <option value="fra">French (fra)</option>
                  <option value="deu">German (deu)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.embedSearchableLayer !== false}
                  onChange={(e) => onChangeParam('embedSearchableLayer', e.target.checked)}
                />
                <span>Embed invisible searchable text layer in PDF</span>
              </label>
            </>
          )}

          {/* 10. Images to PDF */}
          {tool.id === 'images-to-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Page Size</label>
                <select
                  value={params.pageSize || 'A4'}
                  onChange={(e) => onChangeParam('pageSize', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="Fit">Fit to Image Dimensions</option>
                  <option value="A4">A4 (595 × 842 pt)</option>
                  <option value="Letter">US Letter (612 × 792 pt)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Orientation</label>
                <select
                  value={params.orientation || 'auto'}
                  onChange={(e) => onChangeParam('orientation', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="auto">Auto (Match Image Aspect)</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Margin Size</label>
                <select
                  value={params.margin || 'small'}
                  onChange={(e) => onChangeParam('margin', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="none">None (0 pt)</option>
                  <option value="small">Small (20 pt)</option>
                  <option value="large">Large (50 pt)</option>
                </select>
              </div>
            </>
          )}

          {/* 11. Word to PDF & 14. HTML/MD to PDF */}
          {(tool.id === 'word-to-pdf' || tool.id === 'html-to-pdf') && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Page Size</label>
                <select
                  value={params.pageSize || 'A4'}
                  onChange={(e) => onChangeParam('pageSize', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="A4">A4</option>
                  <option value="Letter">US Letter</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Base Typography Size (pt)</label>
                <input
                  type="number"
                  min={8}
                  max={18}
                  value={params.fontSize || 11}
                  onChange={(e) => onChangeParam('fontSize', Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
            </>
          )}

          {/* 12. PowerPoint to PDF */}
          {tool.id === 'powerpoint-to-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">16:9 Slide Theme</label>
                <select
                  value={params.theme || 'light'}
                  onChange={(e) => onChangeParam('theme', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="light">Stark White Monochrome</option>
                  <option value="dark">Obsidian Dark Monochrome</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.includeSlideNumbers !== false}
                  onChange={(e) => onChangeParam('includeSlideNumbers', e.target.checked)}
                />
                <span>Stamp slide index badge</span>
              </label>
            </>
          )}

          {/* 13. Excel to PDF */}
          {tool.id === 'excel-to-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Sheet Orientation</label>
                <select
                  value={params.orientation || 'landscape'}
                  onChange={(e) => onChangeParam('orientation', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="landscape">Landscape (Wide Table)</option>
                  <option value="portrait">Portrait</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.showGridlines !== false}
                  onChange={(e) => onChangeParam('showGridlines', e.target.checked)}
                />
                <span>Draw monochrome cell borders</span>
              </label>
            </>
          )}

          {/* 15. PDF to JPG/PNG */}
          {tool.id === 'pdf-to-images' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Extraction Mode</label>
                <select
                  value={params.mode || 'render'}
                  onChange={(e) => onChangeParam('mode', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="render">(a) Render Every PDF Page</option>
                  <option value="extract-embedded">(b) Extract Embedded Image Streams</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Image Format</label>
                <select
                  value={params.format || 'png'}
                  onChange={(e) => onChangeParam('format', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="png">Lossless PNG</option>
                  <option value="jpeg">High-Efficiency JPG</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Resolution Scale</label>
                <select
                  value={params.dpiScale || 2}
                  onChange={(e) => onChangeParam('dpiScale', Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value={1}>1x (72 DPI)</option>
                  <option value={2}>2x (150 DPI)</option>
                  <option value={3}>3x (300 DPI Archival)</option>
                </select>
              </div>
            </>
          )}

          {/* 16. PDF to Word */}
          {tool.id === 'pdf-to-word' && (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.detectHeadings !== false}
                  onChange={(e) => onChangeParam('detectHeadings', e.target.checked)}
                />
                <span>Infer H1/H2 headings from font height</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.preservePageBreaks !== false}
                  onChange={(e) => onChangeParam('preservePageBreaks', e.target.checked)}
                />
                <span>Insert page breaks between PDF pages</span>
              </label>
            </>
          )}

          {/* 17. PDF to PowerPoint */}
          {tool.id === 'pdf-to-powerpoint' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold block">Deck Layout Mode</label>
              <select
                value={params.mode || 'hybrid'}
                onChange={(e) => onChangeParam('mode', e.target.value)}
                className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
              >
                <option value="hybrid">Hybrid (Editable Text + Slide Visual)</option>
                <option value="visual-slides">Full-Bleed High-DPI Slide Plates</option>
                <option value="editable-text">Editable Text Boxes Only</option>
              </select>
            </div>
          )}

          {/* 18. PDF to Excel */}
          {tool.id === 'pdf-to-excel' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">
                  Row Y-Coordinate Tolerance (pt)
                </label>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={params.yTolerance || 4}
                  onChange={(e) => onChangeParam('yTolerance', Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.sheetPerPage !== false}
                  onChange={(e) => onChangeParam('sheetPerPage', e.target.checked)}
                />
                <span>Create separate worksheet per PDF page</span>
              </label>
            </>
          )}

          {/* 19. PDF to PDF/A */}
          {tool.id === 'pdf-to-pdfa' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">ISO Archival Profile</label>
                <select
                  value={params.conformanceLevel || 'PDF/A-2b'}
                  onChange={(e) => onChangeParam('conformanceLevel', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="PDF/A-2b">ISO 19005-2 (PDF/A-2b)</option>
                  <option value="PDF/A-1b">ISO 19005-1 (PDF/A-1b)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">XMP Archival Title</label>
                <input
                  type="text"
                  value={params.documentTitle || 'pdf tools Archival Record'}
                  onChange={(e) => onChangeParam('documentTitle', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
            </>
          )}

          {/* 20. Rotate PDF */}
          {tool.id === 'rotate-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Rotation Angle</label>
                <select
                  value={params.angle ?? 90}
                  onChange={(e) => onChangeParam('angle', Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value={90}>90° Clockwise</option>
                  <option value={180}>180° Upside Down</option>
                  <option value={270}>90° Counter-Clockwise (270°)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Apply to Page Filter</label>
                <select
                  value={params.targetFilter || 'all'}
                  onChange={(e) => onChangeParam('targetFilter', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="all">All Pages</option>
                  <option value="portrait">Portrait Pages Only</option>
                  <option value="landscape">Landscape Pages Only</option>
                  <option value="odd">Odd Pages (1, 3, 5...)</option>
                  <option value="even">Even Pages (2, 4, 6...)</option>
                </select>
              </div>
            </>
          )}

          {/* 21. Add Page Numbers */}
          {tool.id === 'page-numbers' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">9-Point Position Grid</label>
                <select
                  value={params.position || 'bottom-right'}
                  onChange={(e) => onChangeParam('position', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="top-left">Top Left</option>
                  <option value="top-center">Top Center</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-center">Bottom Center</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Number Template</label>
                <select
                  value={params.template || 'Page {n} of {total}'}
                  onChange={(e) => onChangeParam('template', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="Page {n} of {total}">Page 1 of N</option>
                  <option value="Page {n}">Page 1</option>
                  <option value="{n}">1</option>
                  <option value="- {n} -">- 1 -</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-mono block">Start Page</label>
                  <input
                    type="number"
                    min={1}
                    value={params.startFromPage || 1}
                    onChange={(e) => onChangeParam('startFromPage', Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono block">First Number</label>
                  <input
                    type="number"
                    min={1}
                    value={params.firstNumber || 1}
                    onChange={(e) => onChangeParam('firstNumber', Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(params.mirrorFacingPages)}
                  onChange={(e) => onChangeParam('mirrorFacingPages', e.target.checked)}
                />
                <span>Facing-page mirror mode (Even/Odd swap)</span>
              </label>
            </>
          )}

          {/* 22. Add Watermark */}
          {tool.id === 'watermark-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Watermark Text</label>
                <input
                  type="text"
                  value={params.text || 'CONFIDENTIAL'}
                  onChange={(e) => onChangeParam('text', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-mono block">Placement</label>
                  <select
                    value={params.placement || 'single'}
                    onChange={(e) => onChangeParam('placement', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                  >
                    <option value="single">Single Center</option>
                    <option value="mosaic">Mosaic Tiled Grid</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-mono block">Layer Order</label>
                  <select
                    value={params.layerOrder || 'over'}
                    onChange={(e) => onChangeParam('layerOrder', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                  >
                    <option value="over">Over Content</option>
                    <option value="under">Under Content</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-mono block">
                  Opacity ({Math.round((params.opacity ?? 0.22) * 100)}%) & Rotation ({params.rotation ?? -35}°)
                </label>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={params.opacity ?? 0.22}
                  onChange={(e) => onChangeParam('opacity', Number(e.target.value))}
                  className="w-full accent-zinc-900 dark:accent-zinc-100"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-mono block">Optional Image Stamp</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const bytes = new Uint8Array(await f.arrayBuffer());
                    onUploadWatermarkImage(bytes);
                    onChangeParam('watermarkType', 'image');
                  }}
                  className="text-xs w-full"
                />
              </div>
            </>
          )}

          {/* 23. Crop PDF */}
          {tool.id === 'crop-pdf' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                  <div key={side}>
                    <label className="text-[11px] font-mono uppercase block">{side} (pt)</label>
                    <input
                      type="number"
                      min={0}
                      max={250}
                      value={params[side] ?? 36}
                      onChange={(e) => onChangeParam(side, Number(e.target.value))}
                      className="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Apply Crop Scope</label>
                <select
                  value={params.applyTo || 'all'}
                  onChange={(e) => onChangeParam('applyTo', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="all">All Pages</option>
                  <option value="current">Current Active Page Only</option>
                  <option value="odd">Odd Pages Only</option>
                  <option value="even">Even Pages Only</option>
                </select>
              </div>
            </>
          )}

          {/* 25. PDF Forms */}
          {tool.id === 'pdf-forms' && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(params.flattenOnExport)}
                onChange={(e) => onChangeParam('flattenOnExport', e.target.checked)}
              />
              <span>Flatten form fields into static page content on export</span>
            </label>
          )}

          {/* 26. Unlock PDF */}
          {tool.id === 'unlock-pdf' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold block">Decryption Password</label>
              <input
                type="password"
                value={params.password || ''}
                onChange={(e) => onChangeParam('password', e.target.value)}
                placeholder="Enter document or .monopdf password..."
                className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
              />
            </div>
          )}

          {/* 27. Protect PDF */}
          {tool.id === 'protect-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Protection Password</label>
                <input
                  type="password"
                  value={params.password || ''}
                  onChange={(e) => onChangeParam('password', e.target.value)}
                  placeholder="Enter strong password..."
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Primary Output Mode</label>
                <select
                  value={params.encryptionMode || 'protected-pdf'}
                  onChange={(e) => onChangeParam('encryptionMode', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="protected-pdf">Protected PDF + AES-256 Vault</option>
                  <option value="aes256-vault">AES-256-GCM .monopdf Vault Primary</option>
                </select>
              </div>
            </>
          )}

          {/* 28. Sign PDF */}
          {tool.id === 'sign-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Signer Full Name</label>
                <input
                  type="text"
                  value={params.signerName || 'A. Mercer'}
                  onChange={(e) => onChangeParam('signerName', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Typed Signature Text</label>
                <input
                  type="text"
                  value={params.typedText || 'A. Mercer'}
                  onChange={(e) => onChangeParam('typedText', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.appendAuditTrailPage !== false}
                  onChange={(e) => onChangeParam('appendAuditTrailPage', e.target.checked)}
                />
                <span>Append Cryptographic SHA-256 Audit Trail Page</span>
              </label>
            </>
          )}

          {/* 29. Redact PDF */}
          {tool.id === 'redact-pdf' && (
            <>
              <div className="space-y-1.5">
                <div className="text-xs font-semibold">Auto-Pattern Regex Targets</div>
                {[
                  { key: 'scanEmails', label: 'Email Addresses' },
                  { key: 'scanPhones', label: 'Phone Numbers' },
                  { key: 'scanSsn', label: 'Social Security Numbers (SSN)' },
                  { key: 'scanCreditCards', label: 'Credit Card Numbers' },
                ].map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={params[item.key] !== false}
                      onChange={(e) => onChangeParam(item.key, e.target.checked)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Custom Redact Word / Regex</label>
                <input
                  type="text"
                  value={params.customSearchPattern || ''}
                  onChange={(e) => onChangeParam('customSearchPattern', e.target.value)}
                  placeholder="e.g. Sovereign Capital"
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                />
              </div>
            </>
          )}

          {/* 30. Compare PDF */}
          {tool.id === 'compare-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Comparison Display Mode</label>
                <select
                  value={params.compareMode || 'semantic'}
                  onChange={(e) => onChangeParam('compareMode', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="semantic">Mode 1: Semantic Text Diff</option>
                  <option value="visual">Mode 2: Visual Pixel Overlay (Difference)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Diff Granularity</label>
                <select
                  value={params.diffGranularity || 'words'}
                  onChange={(e) => onChangeParam('diffGranularity', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="words">Word-Level Diff</option>
                  <option value="lines">Line-Level Diff</option>
                </select>
              </div>
            </>
          )}

          {/* 31. AI Summarizer & 32. Translate PDF Unified AI Engine Switch */}
          {(tool.id === 'ai-summarizer' || tool.id === 'translate-pdf') && (
            <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 space-y-3">
              <div className="text-[11px] font-mono font-bold uppercase text-zinc-500">
                DUAL AI ENGINE ARCHITECTURE
              </div>
              <select
                aria-label="AI Engine Mode"
                value={aiSettings.mode}
                onChange={(e) =>
                  onChangeAiSettings((prev) => ({
                    ...prev,
                    mode: e.target.value as AiEngineSettings['mode'],
                  }))
                }
                className="w-full px-2.5 py-2 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800"
              >
                <option value="offline-extractive">
                  (b) Offline Deterministic TF-IDF Engine
                </option>
                <option value="ollama-local">
                  (a) 100% Offline Local AI (Ollama)
                </option>
                <option value="cloud-gemini">
                  (c) Cloud AI (Gemini Server Proxy)
                </option>
              </select>

              {aiSettings.mode === 'ollama-local' && (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="text-[10px] font-mono block text-zinc-500">
                      OLLAMA MODEL NAME
                    </label>
                    <input
                      type="text"
                      value={aiSettings.ollamaModel}
                      onChange={(e) =>
                        onChangeAiSettings((prev) => ({
                          ...prev,
                          ollamaModel: e.target.value,
                        }))
                      }
                      placeholder="llama3.2, qwen2.5, mistral"
                      className="w-full px-2 py-1 text-xs font-mono bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="truncate text-zinc-500">{ollamaStatus}</span>
                    <button
                      type="button"
                      onClick={probeOllama}
                      className="px-2 py-0.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Probe
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tool.id === 'ai-summarizer' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold block">Summary Depth</label>
              <select
                value={params.summaryLength || 'medium'}
                onChange={(e) => onChangeParam('summaryLength', e.target.value)}
                className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
              >
                <option value="short">Short Executive Brief (3 Sentences)</option>
                <option value="medium">Standard Dossier (5 Sentences)</option>
                <option value="long">Deep Analysis (8 Sentences)</option>
              </select>
            </div>
          )}

          {tool.id === 'translate-pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block">Target Language</label>
                <select
                  value={params.targetLanguage || 'Spanish'}
                  onChange={(e) => onChangeParam('targetLanguage', e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
                >
                  <option value="Spanish">Spanish</option>
                  <option value="French">French</option>
                  <option value="German">German</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(params.bilingualSideBySide)}
                  onChange={(e) => onChangeParam('bilingualSideBySide', e.target.checked)}
                />
                <span>Include source text alongside translation</span>
              </label>
            </>
          )}

          {/* 33. PDF to Markdown */}
          {tool.id === 'pdf-to-markdown' && (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.detectTables !== false}
                  onChange={(e) => onChangeParam('detectTables', e.target.checked)}
                />
                <span>Convert aligned X/Y columns into Markdown tables</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={params.includePageMarkers !== false}
                  onChange={(e) => onChangeParam('includePageMarkers', e.target.checked)}
                />
                <span>Include HTML page boundary comments</span>
              </label>
            </>
          )}
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-3 bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950 text-xs font-mono flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* OUTPUT RESULT & "CHAIN TO NEXT TOOL ->" CARD */}
        {lastOutput && (
          <div className="p-3.5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-950 dark:text-zinc-50">
                <CheckCircle2 className="w-4 h-4" />
                <span>OUTPUT READY</span>
              </span>
              {delta && (
                <span className="text-xs font-mono font-bold tabular-nums">
                  {delta.percentSaved}
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {lastOutput.summaryMessage}
            </p>

            {/* Before / After Byte Telemetry */}
            <div className="grid grid-cols-2 gap-2 p-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono tabular-nums">
              <div>
                <div className="text-zinc-400">BEFORE</div>
                <div className="font-semibold">{formatBytes(lastOutput.beforeSize)}</div>
              </div>
              <div>
                <div className="text-zinc-400">AFTER</div>
                <div className="font-semibold">{formatBytes(lastOutput.afterSize)}</div>
              </div>
            </div>

            {/* Optional Inspector Report Key-Values */}
            {lastOutput.report && (
              <div className="space-y-1 pt-1 border-t border-zinc-200 dark:border-zinc-800 text-[11px] font-mono">
                {Object.entries(lastOutput.report).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 truncate">{k}:</span>
                    <span className="font-semibold text-right truncate">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Primary Download Button */}
            <button
              type="button"
              onClick={onDownloadOutput}
              className="w-full py-2 px-3 flex items-center justify-center gap-2 text-xs font-bold bg-zinc-950 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950 hover:opacity-90 transition-opacity"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="truncate">Download {lastOutput.filename}</span>
            </button>

            {/* Secondary File Downloads (e.g. .txt transcript, individual split PDFs, .monopdf vault) */}
            {lastOutput.secondaryFiles && lastOutput.secondaryFiles.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-[10px] font-mono text-zinc-500 uppercase">
                  COMPANION OUTPUT FILES ({lastOutput.secondaryFiles.length})
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {lastOutput.secondaryFiles.map((sec, idx) => (
                    <button
                      key={sec.filename}
                      type="button"
                      onClick={() => onDownloadSecondary(idx)}
                      className="w-full px-2.5 py-1.5 text-[11px] font-mono flex items-center justify-between border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="truncate">{sec.filename}</span>
                      <span className="shrink-0 ml-2 text-zinc-400">
                        {formatBytes(sec.bytes.byteLength)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CHAIN TO NEXT TOOL -> */}
            {lastOutput.canChainAsPdf && (
              <div className="pt-2.5 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                <label className="text-[10px] font-mono uppercase text-zinc-500 block">
                  PIPELINE CHAIN OUTPUT UINT8ARRAY TO:
                </label>
                <select
                  aria-label="Select Next Tool in Chain"
                  value={nextChainToolId}
                  onChange={(e) => setNextChainToolId(e.target.value as ToolId)}
                  className="w-full px-2 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800"
                >
                  {chainableTools.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      #{String(ct.number).padStart(2, '0')} {ct.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onChainToTool(nextChainToolId)}
                  className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-xs font-semibold border border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-900 hover:text-zinc-50 dark:hover:bg-zinc-100 dark:hover:text-zinc-950 transition-colors"
                >
                  <span>Chain to Next Tool</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Primary Execute Footer Button */}
      {tool.id !== 'pdf-reader' && (
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090b]">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onExecute}
            className="w-full py-2.5 px-4 flex items-center justify-center gap-2 text-xs font-bold bg-zinc-950 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950 disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className="truncate">{progressMessage || 'Executing...'}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Execute & Export ({tool.shortName})</span>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
};
