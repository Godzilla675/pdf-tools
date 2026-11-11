import { useCallback, useEffect, useState } from 'react';
import {
  AiEngineSettings,
  CanvasAnnotation,
  DetectedAcroField,
  EngineOutput,
  RenderedPageThumbnail,
  SavedWorkflow,
  ToolCategory,
  ToolId,
  UploadedFileItem,
  WorkflowStep,
} from './types/pdf';
import { getToolById } from './registry/toolsRegistry';
import { TopNavbar } from './components/TopNavbar';
import { HomeToolsGrid } from './components/HomeToolsGrid';
import { CenterCanvas } from './components/CenterCanvas';
import { RightInspector } from './components/RightInspector';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { loadPdfJsDocument, renderPdfPageToDataUrl } from './utils/pdfjsClient';

// Engine imports (All 33 tools + Workflows)
import {
  executeExtractPages,
  executeMergePdf,
  executeOrganizePdf,
  executeRemovePages,
  executeScanToPdf,
  executeSplitPdf,
} from './engines/organizeEngine';
import {
  executeCompressPdf,
  executeOcrPdf,
  executeRepairPdf,
} from './engines/optimizeEngine';
import {
  executeExcelToPdf,
  executeHtmlToPdf,
  executeImagesToPdf,
  executePowerpointToPdf,
  executeWordToPdf,
} from './engines/convertToPdfEngine';
import {
  executePdfToExcel,
  executePdfToImages,
  executePdfToPdfA,
  executePdfToPowerpoint,
  executePdfToWord,
} from './engines/convertFromPdfEngine';
import {
  executeAddPageNumbers,
  executeCropPdf,
  executeEditPdfStudio,
  executePdfForms,
  executeRotatePdf,
  executeWatermarkPdf,
  inspectPdfAcroFields,
} from './engines/editEngine';
import {
  executeComparePdf,
  executeProtectPdf,
  executeRedactPdf,
  executeSignPdf,
  executeUnlockPdf,
} from './engines/securityEngine';
import {
  executeAiSummarizer,
  executePdfToMarkdown,
  executeTranslatePdf,
  executeWorkflowPipeline,
} from './engines/aiEngine';

const WORKFLOW_STORAGE_KEY = 'mono_pdf_saved_workflows_v1';

export default function App() {
  const [isHomeView, setIsHomeView] = useState<boolean>(true);
  const [activeToolId, setActiveToolId] = useState<ToolId>('merge-pdf');
  const [activeCategory, setActiveCategory] = useState<ToolCategory>('all');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'system'>('light');

  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [thumbnails, setThumbnails] = useState<RenderedPageThumbnail[]>([]);
  const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(false);
  const [activePageIndex, setActivePageIndex] = useState(0);

  const [toolParamsMap, setToolParamsMap] = useState<Record<string, Record<string, any>>>(() => ({
    'merge-pdf': { ...getToolById('merge-pdf').defaultParams },
  }));

  const [annotations, setAnnotations] = useState<CanvasAnnotation[]>([]);
  const [detectedAcroFields, setDetectedAcroFields] = useState<DetectedAcroField[]>([]);
  const [acroFieldValues, setAcroFieldValues] = useState<Record<string, string | boolean>>({});
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [watermarkImageBytes, setWatermarkImageBytes] = useState<Uint8Array | undefined>(
    undefined
  );
  const [capturedScans, setCapturedScans] = useState<string[]>([]);

  const [aiSettings, setAiSettings] = useState<AiEngineSettings>({
    mode: 'offline-extractive',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
  });

  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([
    { id: 'step_1', toolId: 'rotate-pdf', params: { angle: 90, targetFilter: 'all' } },
    {
      id: 'step_2',
      toolId: 'watermark-pdf',
      params: { text: 'CONFIDENTIAL', opacity: 0.2, rotation: -35 },
    },
    {
      id: 'step_3',
      toolId: 'page-numbers',
      params: { position: 'bottom-right', template: 'Page {n} of {total}' },
    },
  ]);

  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>(() => {
    try {
      const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastOutput, setLastOutput] = useState<EngineOutput | null>(null);

  const activeTool = getToolById(activeToolId);
  const currentParams = toolParamsMap[activeToolId] || activeTool.defaultParams;

  // Apply Dark / Light / System mode to <html>
  useEffect(() => {
    const root = document.documentElement;
    const apply = (isDark: boolean) => {
      if (isDark) root.classList.add('dark');
      else root.classList.remove('dark');
    };

    if (themeMode === 'dark') {
      apply(true);
    } else if (themeMode === 'light') {
      apply(false);
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
    }
  }, [themeMode]);

  // Global Cmd+K / Ctrl+K shortcut for Command Palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Render visual page thumbnails whenever PDF files change
  const rebuildThumbnailsFromFiles = useCallback(async (fileList: UploadedFileItem[]) => {
    const pdfFiles = fileList.filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    );
    if (pdfFiles.length === 0) {
      setThumbnails([]);
      setDetectedAcroFields([]);
      return;
    }

    setIsLoadingThumbnails(true);
    try {
      const rendered: RenderedPageThumbnail[] = [];
      let globalIdx = 0;

      for (const f of pdfFiles) {
        try {
          const pdfDoc = await loadPdfJsDocument(f.bytes);
          for (let p = 1; p <= pdfDoc.numPages; p++) {
            const pageRender = await renderPdfPageToDataUrl(
              pdfDoc,
              p,
              1.35,
              'image/jpeg',
              0.92
            );
            rendered.push({
              pageIndex: globalIdx,
              originalPageIndex: p - 1,
              sourceFileId: f.id,
              pageNumber: p,
              width: pageRender.width,
              height: pageRender.height,
              rotation: 0,
              dataUrl: pageRender.dataUrl,
              selected: false,
            });
            globalIdx++;
          }
        } catch {
          // Encrypted PDF awaiting password in Unlock PDF
        }
      }

      setThumbnails(rendered);
      setActivePageIndex(0);

      const fields = await inspectPdfAcroFields(pdfFiles[0].bytes);
      setDetectedAcroFields(fields);
      const initialVals: Record<string, string | boolean> = {};
      fields.forEach((fld) => {
        initialVals[fld.name] = fld.value;
      });
      setAcroFieldValues(initialVals);
    } finally {
      setIsLoadingThumbnails(false);
    }
  }, []);

  const handleSelectTool = (toolId: ToolId) => {
    setActiveToolId(toolId);
    setIsHomeView(false);
    setErrorMessage('');
    setLastOutput(null);
    const def = getToolById(toolId);
    setToolParamsMap((prev) => ({
      ...prev,
      [toolId]: prev[toolId] || { ...def.defaultParams },
    }));
  };

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage('');
    setLastOutput(null);

    const newItems: UploadedFileItem[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const ab = await f.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let pageCount = 1;
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        try {
          const doc = await loadPdfJsDocument(bytes);
          pageCount = doc.numPages;
        } catch {
          pageCount = 1;
        }
      }
      newItems.push({
        id: `upload_${Date.now()}_${i}`,
        name: f.name,
        size: bytes.byteLength,
        type: f.type || 'application/octet-stream',
        bytes,
        pageCount,
        lastModified: f.lastModified,
      });
    }

    const combined = activeTool.multipleFiles ? [...files, ...newItems] : [newItems[0]];
    setFiles(combined);
    await rebuildThumbnailsFromFiles(combined);
  };

  const handleChangeParam = (key: string, val: any) => {
    setToolParamsMap((prev) => ({
      ...prev,
      [activeToolId]: {
        ...(prev[activeToolId] || activeTool.defaultParams),
        [key]: val,
      },
    }));
  };

  const handleToggleSelectThumb = (idx: number) => {
    setThumbnails((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, selected: !t.selected } : t))
    );
  };

  const handleSelectAllThumbs = (selected: boolean) => {
    setThumbnails((prev) => prev.map((t) => ({ ...t, selected })));
  };

  const handleRotateThumb = (idx: number, deltaAngle: number) => {
    setThumbnails((prev) =>
      prev.map((t, i) =>
        i === idx ? { ...t, rotation: ((t.rotation || 0) + deltaAngle) % 360 } : t
      )
    );
  };

  const handleDuplicateThumb = (idx: number) => {
    setThumbnails((prev) => {
      const target = prev[idx];
      if (!target) return prev;
      const copy = { ...target, pageIndex: prev.length };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      return next.map((item, i) => ({ ...item, pageIndex: i }));
    });
  };

  const handleInsertBlankThumb = (afterIdx: number) => {
    setThumbnails((prev) => {
      const blank: RenderedPageThumbnail = {
        pageIndex: afterIdx + 1,
        originalPageIndex: -1,
        sourceFileId: files[0]?.id || 'blank',
        pageNumber: afterIdx + 2,
        width: 595.28,
        height: 841.89,
        rotation: 0,
        dataUrl: '',
        isBlank: true,
        selected: false,
      };
      const next = [...prev.slice(0, afterIdx + 1), blank, ...prev.slice(afterIdx + 1)];
      return next.map((item, i) => ({ ...item, pageIndex: i }));
    });
  };

  const handleDeleteThumb = (idx: number) => {
    setThumbnails((prev) =>
      prev.filter((_, i) => i !== idx).map((item, i) => ({ ...item, pageIndex: i }))
    );
  };

  const handleMoveThumb = (fromIdx: number, toIdx: number) => {
    setThumbnails((prev) => {
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy.map((item, i) => ({ ...item, pageIndex: i }));
    });
  };

  const handleMoveFile = (fromIdx: number, toIdx: number) => {
    setFiles((prev) => {
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      rebuildThumbnailsFromFiles(copy);
      return copy;
    });
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId);
      rebuildThumbnailsFromFiles(next);
      return next;
    });
  };

  const handleSaveWorkflow = (name: string, description: string) => {
    const newWf: SavedWorkflow = {
      id: `wf_${Date.now()}`,
      name,
      description,
      steps: [...workflowSteps],
      createdAt: new Date().toISOString(),
    };
    const updated = [newWf, ...savedWorkflows];
    setSavedWorkflows(updated);
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore
    }
  };

  const handleDeleteSavedWorkflow = (id: string) => {
    const updated = savedWorkflows.filter((w) => w.id !== id);
    setSavedWorkflows(updated);
    try {
      localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore
    }
  };

  const handleExecuteTool = async () => {
    setIsProcessing(true);
    setErrorMessage('');
    setProgressMessage(`Running ${activeTool.name}...`);

    try {
      const primaryFile = files[0];
      if (!primaryFile && activeToolId !== 'html-to-pdf' && activeToolId !== 'scan-to-pdf') {
        throw new Error('Please select a file first.');
      }

      let output: EngineOutput;

      switch (activeToolId) {
        case 'merge-pdf':
          output = await executeMergePdf(files, thumbnails, currentParams);
          break;
        case 'split-pdf':
          output = await executeSplitPdf(primaryFile, currentParams);
          break;
        case 'remove-pages':
          output = await executeRemovePages(primaryFile, thumbnails, currentParams);
          break;
        case 'extract-pages':
          output = await executeExtractPages(primaryFile, thumbnails, currentParams);
          break;
        case 'organize-pdf':
          output = await executeOrganizePdf(files, thumbnails, currentParams);
          break;
        case 'scan-to-pdf':
          output = await executeScanToPdf(capturedScans, files, currentParams);
          break;
        case 'compress-pdf':
          output = await executeCompressPdf(primaryFile, currentParams, setProgressMessage);
          break;
        case 'repair-pdf':
          output = await executeRepairPdf(primaryFile, currentParams, setProgressMessage);
          break;
        case 'ocr-pdf':
          output = await executeOcrPdf(primaryFile, currentParams, setProgressMessage);
          break;
        case 'images-to-pdf':
          output = await executeImagesToPdf(files, currentParams);
          break;
        case 'word-to-pdf':
          output = await executeWordToPdf(primaryFile, currentParams);
          break;
        case 'powerpoint-to-pdf':
          output = await executePowerpointToPdf(primaryFile, currentParams);
          break;
        case 'excel-to-pdf':
          output = await executeExcelToPdf(primaryFile, currentParams);
          break;
        case 'html-to-pdf':
          output = await executeHtmlToPdf(primaryFile || null, currentParams);
          break;
        case 'pdf-to-images':
          output = await executePdfToImages(primaryFile, currentParams, setProgressMessage);
          break;
        case 'pdf-to-word':
          output = await executePdfToWord(primaryFile, currentParams);
          break;
        case 'pdf-to-powerpoint':
          output = await executePdfToPowerpoint(primaryFile, currentParams, setProgressMessage);
          break;
        case 'pdf-to-excel':
          output = await executePdfToExcel(primaryFile, currentParams);
          break;
        case 'pdf-to-pdfa':
          output = await executePdfToPdfA(primaryFile, currentParams);
          break;
        case 'rotate-pdf':
          output = await executeRotatePdf(primaryFile, thumbnails, currentParams);
          break;
        case 'page-numbers':
          output = await executeAddPageNumbers(primaryFile, currentParams);
          break;
        case 'watermark-pdf':
          output = await executeWatermarkPdf(
            primaryFile,
            currentParams,
            watermarkImageBytes
          );
          break;
        case 'crop-pdf':
          output = await executeCropPdf(primaryFile, currentParams, activePageIndex);
          break;
        case 'edit-pdf':
          output = await executeEditPdfStudio(primaryFile, annotations);
          break;
        case 'pdf-forms':
          output = await executePdfForms(
            primaryFile,
            acroFieldValues,
            annotations,
            currentParams
          );
          break;
        case 'unlock-pdf':
          output = await executeUnlockPdf(primaryFile, currentParams, setProgressMessage);
          break;
        case 'protect-pdf':
          output = await executeProtectPdf(primaryFile, currentParams);
          break;
        case 'sign-pdf':
          output = await executeSignPdf(
            primaryFile,
            signatureDataUrl,
            annotations,
            currentParams
          );
          break;
        case 'redact-pdf':
          output = await executeRedactPdf(
            primaryFile,
            annotations,
            currentParams,
            setProgressMessage
          );
          break;
        case 'compare-pdf': {
          const secondFile = files[1] || primaryFile;
          output = await executeComparePdf(
            primaryFile,
            secondFile,
            currentParams,
            setProgressMessage
          );
          break;
        }
        case 'ai-summarizer':
          output = await executeAiSummarizer(
            primaryFile,
            currentParams,
            aiSettings,
            setProgressMessage
          );
          break;
        case 'translate-pdf':
          output = await executeTranslatePdf(
            primaryFile,
            currentParams,
            aiSettings,
            setProgressMessage
          );
          break;
        case 'pdf-to-markdown':
          output = await executePdfToMarkdown(primaryFile, currentParams);
          break;
        case 'custom-workflows':
          output = await executeWorkflowPipeline(
            primaryFile,
            workflowSteps,
            setProgressMessage
          );
          break;
        default:
          throw new Error(`Unsupported tool ID: ${activeToolId}`);
      }

      setLastOutput(output);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Execution failed.');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  };

  const triggerBytesDownload = (bytes: Uint8Array, filename: string, mimeType: string) => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleDownloadOutput = () => {
    if (!lastOutput) return;
    triggerBytesDownload(lastOutput.bytes, lastOutput.filename, lastOutput.mimeType);
  };

  const handleDownloadSecondary = (idx: number) => {
    const sec = lastOutput?.secondaryFiles?.[idx];
    if (!sec) return;
    triggerBytesDownload(sec.bytes, sec.filename, sec.mimeType);
  };

  const handleChainToTool = async (nextToolId: ToolId) => {
    if (!lastOutput) return;

    let pdfBytesToChain = lastOutput.bytes;
    let pdfFilename = lastOutput.filename;

    if (
      lastOutput.mimeType === 'application/zip' &&
      lastOutput.secondaryFiles &&
      lastOutput.secondaryFiles.length > 0 &&
      lastOutput.secondaryFiles[0].mimeType === 'application/pdf'
    ) {
      pdfBytesToChain = lastOutput.secondaryFiles[0].bytes;
      pdfFilename = lastOutput.secondaryFiles[0].filename;
    }

    const chainedFile: UploadedFileItem = {
      id: `chained_${Date.now()}`,
      name: pdfFilename.endsWith('.pdf') ? pdfFilename : `${pdfFilename}.pdf`,
      size: pdfBytesToChain.byteLength,
      type: 'application/pdf',
      bytes: pdfBytesToChain,
      pageCount: lastOutput.pageCount || 1,
      lastModified: Date.now(),
    };

    setActiveToolId(nextToolId);
    setIsHomeView(false);
    setLastOutput(null);
    setErrorMessage('');
    setAnnotations([]);
    setFiles([chainedFile]);
    await rebuildThumbnailsFromFiles([chainedFile]);
  };

  const showRightInspector =
    !isHomeView &&
    (files.length > 0 ||
      activeToolId === 'html-to-pdf' ||
      activeToolId === 'scan-to-pdf' ||
      activeToolId === 'custom-workflows');

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fa] text-[#202124] dark:bg-[#0d1117] dark:text-[#f0f6fc]">
      {/* iLovePDF + Kaggle Top Navigation Bar */}
      <TopNavbar
        isHomeView={isHomeView}
        activeToolId={activeToolId}
        onGoHome={() => setIsHomeView(true)}
        onSelectTool={handleSelectTool}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        themeMode={themeMode}
        onChangeTheme={setThemeMode}
      />

      {/* Main Content Area: Either iLovePDF All-Tools Grid OR Active Tool Workspace */}
      {isHomeView ? (
        <HomeToolsGrid
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          onSelectTool={handleSelectTool}
        />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <CenterCanvas
            tool={activeTool}
            files={files}
            thumbnails={thumbnails}
            isLoadingThumbnails={isLoadingThumbnails}
            onGoHome={() => setIsHomeView(true)}
            onUploadFiles={handleUploadFiles}
            onClearWorkspace={() => {
              setFiles([]);
              setThumbnails([]);
              setAnnotations([]);
              setLastOutput(null);
            }}
            onToggleSelectThumb={handleToggleSelectThumb}
            onSelectAllThumbs={handleSelectAllThumbs}
            onRotateThumb={handleRotateThumb}
            onDuplicateThumb={handleDuplicateThumb}
            onInsertBlankThumb={handleInsertBlankThumb}
            onDeleteThumb={handleDeleteThumb}
            onMoveThumb={handleMoveThumb}
            onMoveFile={handleMoveFile}
            onRemoveFile={handleRemoveFile}
            activePageIndex={activePageIndex}
            onChangeActivePage={setActivePageIndex}
            annotations={annotations}
            onChangeAnnotations={setAnnotations}
            params={currentParams}
            onChangeParam={handleChangeParam}
            detectedAcroFields={detectedAcroFields}
            acroFieldValues={acroFieldValues}
            onChangeAcroFieldValue={(name, val) =>
              setAcroFieldValues((prev) => ({ ...prev, [name]: val }))
            }
            signatureDataUrl={signatureDataUrl}
            onChangeSignatureDataUrl={setSignatureDataUrl}
            capturedScans={capturedScans}
            onAddCapturedScan={(url) => setCapturedScans((prev) => [...prev, url])}
            onClearCapturedScans={() => setCapturedScans([])}
            workflowSteps={workflowSteps}
            onChangeWorkflowSteps={setWorkflowSteps}
            savedWorkflows={savedWorkflows}
            onSaveWorkflow={handleSaveWorkflow}
            onLoadWorkflow={(wf) => setWorkflowSteps([...wf.steps])}
            onDeleteSavedWorkflow={handleDeleteSavedWorkflow}
            lastOutput={lastOutput}
            onExecuteTool={handleExecuteTool}
          />

          {showRightInspector && (
            <RightInspector
              tool={activeTool}
              files={files}
              thumbnails={thumbnails}
              params={currentParams}
              onChangeParam={handleChangeParam}
              aiSettings={aiSettings}
              onChangeAiSettings={setAiSettings}
              isProcessing={isProcessing}
              progressMessage={progressMessage}
              errorMessage={errorMessage}
              lastOutput={lastOutput}
              onExecute={handleExecuteTool}
              onDownloadOutput={handleDownloadOutput}
              onDownloadSecondary={handleDownloadSecondary}
              onChainToTool={handleChainToTool}
              onUploadWatermarkImage={setWatermarkImageBytes}
            />
          )}
        </div>
      )}

      {/* Cmd+K Instant Command Palette Modal */}
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectTool={handleSelectTool}
      />
    </div>
  );
}
