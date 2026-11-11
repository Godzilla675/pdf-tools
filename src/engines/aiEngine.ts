import {
  AiEngineSettings,
  EngineOutput,
  UploadedFileItem,
  WorkflowStep,
} from '../types/pdf';
import {
  itemsToStructuredMarkdown,
  offlineTranslateText,
  tfIdfSummarize,
} from '../utils/pdfHelpers';
import { extractPositionedTextFromPdf } from '../utils/pdfjsClient';
import { renderStructuredMarkupToPdf } from './convertToPdfEngine';
import {
  executeAddPageNumbers,
  executeCropPdf,
  executeRotatePdf,
  executeWatermarkPdf,
} from './editEngine';
import { executeCompressPdf, executeRepairPdf } from './optimizeEngine';
import { executeRemovePages } from './organizeEngine';
import { executeProtectPdf, executeUnlockPdf } from './securityEngine';

/**
 * Checks whether a local Ollama instance is reachable at the configured URL.
 */
export async function checkOllamaConnection(ollamaUrl = 'http://localhost:11434'): Promise<{
  online: boolean;
  models: string[];
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { online: false, models: [] };
    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => String(m.name || ''))
      : [];
    return { online: true, models };
  } catch {
    return { online: false, models: [] };
  }
}

/**
 * Unified Dual AI Engine (Offline Local Ollama + Offline Deterministic TF-IDF + Server Cloud Gemini).
 */
async function generateWithUnifiedAiEngine(
  prompt: string,
  systemInstruction: string,
  settings: AiEngineSettings
): Promise<{ text: string; providerUsed: string }> {
  if (settings.mode === 'ollama-local') {
    try {
      const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ollamaModel || 'llama3.2',
          prompt: `${systemInstruction}\n\n${prompt}`,
          stream: false,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.response) {
          return {
            text: String(data.response),
            providerUsed: `Local Ollama (${settings.ollamaModel || 'llama3.2'})`,
          };
        }
      }
    } catch {
      // Automatically fall back to Offline Deterministic Engine if Ollama isn't running
    }
  }

  if (settings.mode === 'cloud-gemini') {
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, systemInstruction }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.text) {
          return { text: String(data.text), providerUsed: 'Cloud AI (Gemini)' };
        }
      }
    } catch {
      // Automatically fall back to Offline Deterministic Engine when offline
    }
  }

  return { text: '', providerUsed: 'Offline Deterministic TF-IDF Engine' };
}

/**
 * Tool 31: AI Summarizer
 * Extracts document text and generates Executive Summaries, Key Bullet Points, and Action Items.
 * Works 100% offline via TF-IDF sentence ranking or via Local Ollama / Cloud Gemini.
 */
export async function executeAiSummarizer(
  file: UploadedFileItem,
  params: Record<string, any>,
  aiSettings: AiEngineSettings,
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  onProgress?.('Extracting PDF text layer for intelligence analysis...');
  const { fullText, pageTexts } = await extractPositionedTextFromPdf(file.bytes);

  const lengthMap: Record<string, number> = { short: 3, medium: 5, long: 8 };
  const targetSentences = lengthMap[params.summaryLength || 'medium'] || 5;

  // Always compute the deterministic TF-IDF baseline
  const tfIdf = tfIdfSummarize(fullText, targetSentences);

  let markdownReport = '';
  let providerUsed = 'Offline Deterministic TF-IDF Engine';

  if (aiSettings.mode !== 'offline-extractive' && fullText.trim().length > 0) {
    onProgress?.(`Querying ${aiSettings.mode === 'ollama-local' ? 'Local Ollama' : 'Cloud AI'}...`);
    const aiRes = await generateWithUnifiedAiEngine(
      `Summarize the following PDF document (${params.summaryLength || 'medium'} length, ${params.analysisDepth || 'deep'} depth). Provide:\n# Executive Summary\n## Key Bullet Points\n## Action Items\n\nDocument Content:\n${fullText.slice(0, 18000)}`,
      'You are MONO PDF Intelligence Engine. Output clean structured Markdown.',
      aiSettings
    );
    if (aiRes.text) {
      markdownReport = aiRes.text;
      providerUsed = aiRes.providerUsed;
    }
  }

  if (!markdownReport) {
    markdownReport = [
      `# Executive Summary: ${file.name}`,
      ``,
      tfIdf.executiveSummary,
      ``,
      `## Key Bullet Points`,
      ...tfIdf.bulletPoints.map((b) => `- ${b}`),
      ``,
      `## Action Items & Obligations`,
      ...tfIdf.actionItems.map((a) => `- ${a}`),
      ``,
      `## Document Telemetry & Top Entities`,
      `- Pages Analyzed: ${pageTexts.length}`,
      `- Word Count: ${tfIdf.wordCount} words (${tfIdf.sentenceCount} sentences)`,
      `- Top Domain Terms: ${tfIdf.topKeywords.join(', ') || 'N/A'}`,
      `- Engine Used: ${providerUsed}`,
    ].join('\n');
  }

  const compiledPdf = await renderStructuredMarkupToPdf(
    markdownReport,
    'markdown',
    `${file.name.replace(/\.pdf$/i, '')}_executive_summary.pdf`,
    file.bytes.byteLength,
    { pageSize: 'A4', fontSize: 10.5 }
  );

  return {
    ...compiledPdf,
    textOutput: markdownReport,
    report: {
      Engine: providerUsed,
      'Pages Analyzed': pageTexts.length,
      'Word Count': tfIdf.wordCount,
      'Key Entities': tfIdf.topKeywords.slice(0, 5).join(', '),
    },
    summaryMessage: `Generated Executive Summary, Bullet Points & Action Items via ${providerUsed}.`,
  };
}

/**
 * Tool 32: Translate PDF
 * Translates PDF content across languages while generating a new downloadable PDF
 * that preserves paragraph structure and page breaks.
 */
export async function executeTranslatePdf(
  file: UploadedFileItem,
  params: Record<string, any>,
  aiSettings: AiEngineSettings,
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  const targetLang = String(params.targetLanguage || 'Spanish');
  onProgress?.(`Extracting text across pages for ${targetLang} translation...`);
  const { pageTexts } = await extractPositionedTextFromPdf(file.bytes);

  const translatedPages: string[] = [];
  let providerUsed = 'Offline Deterministic Lexicon Engine';

  for (let i = 0; i < pageTexts.length; i++) {
    const rawPage = pageTexts[i] || '';
    if (!rawPage.trim()) {
      translatedPages.push(`## Page ${i + 1}\n(Blank Page)`);
      continue;
    }

    onProgress?.(`Translating Page ${i + 1} of ${pageTexts.length} into ${targetLang}...`);
    let pageTranslated = '';

    if (aiSettings.mode !== 'offline-extractive') {
      const aiRes = await generateWithUnifiedAiEngine(
        `Translate the following page text accurately into ${targetLang}. Preserve headings and bullet points:\n\n${rawPage.slice(0, 6000)}`,
        `You are a professional document translator. Translate into ${targetLang} using clean Markdown.`,
        aiSettings
      );
      if (aiRes.text) {
        pageTranslated = aiRes.text;
        providerUsed = aiRes.providerUsed;
      }
    }

    if (!pageTranslated) {
      pageTranslated = offlineTranslateText(rawPage, targetLang);
    }

    if (params.bilingualSideBySide) {
      translatedPages.push(
        `## Page ${i + 1} (Source + ${targetLang})\n### Source Text\n${rawPage}\n\n### ${targetLang} Translation\n${pageTranslated}`
      );
    } else {
      translatedPages.push(`## Page ${i + 1}\n${pageTranslated}`);
    }
  }

  const combinedMd = `# ${file.name.replace(/\.pdf$/i, '')} (${targetLang})\n\n` + translatedPages.join('\n\n');
  const compiled = await renderStructuredMarkupToPdf(
    combinedMd,
    'markdown',
    `${file.name.replace(/\.pdf$/i, '')}_${targetLang.toLowerCase()}.pdf`,
    file.bytes.byteLength,
    { pageSize: 'A4', fontSize: 10.5 }
  );

  return {
    ...compiled,
    textOutput: combinedMd,
    report: {
      'Target Language': targetLang,
      'Translation Engine': providerUsed,
      'Pages Translated': pageTexts.length,
    },
    summaryMessage: `Translated ${pageTexts.length} page(s) into ${targetLang} (${providerUsed}).`,
  };
}

/**
 * Tool 33: PDF to Markdown (.md)
 * Extracts text items, font heights, and X/Y positions via pdfjs-dist and converts into
 * structured Markdown (# H1, ## H2, ### H3, lists, tables) with downloadable .md output.
 */
export async function executePdfToMarkdown(
  file: UploadedFileItem,
  params: Record<string, any>
): Promise<EngineOutput> {
  const { items, pageDimensions } = await extractPositionedTextFromPdf(file.bytes);

  const pagesInput = pageDimensions.map((_, idx) => ({
    pageNumber: idx + 1,
    items: items
      .filter((it) => it.pageIndex === idx)
      .map((it) => ({
        str: it.str,
        x: it.x,
        y: it.y,
        fontSize: it.fontSize,
        width: it.width,
      })),
  }));

  const mdText = itemsToStructuredMarkdown(pagesInput, {
    includePageMarkers: params.includePageMarkers !== false,
    detectTables: params.detectTables !== false,
  });

  const mdBytes = new TextEncoder().encode(mdText);

  return {
    bytes: mdBytes,
    filename: `${file.name.replace(/\.pdf$/i, '')}.md`,
    mimeType: 'text/markdown',
    beforeSize: file.bytes.byteLength,
    afterSize: mdBytes.byteLength,
    pageCount: pageDimensions.length,
    canChainAsPdf: false,
    textOutput: mdText,
    summaryMessage: `Converted ${pageDimensions.length} page(s) into structured Markdown (.md).`,
  };
}

/**
 * Tool 34: Custom Automated Workflows (Pipeline Builder)
 * Executes an ordered sequence of PDF tools on an uploaded PDF file in a single click,
 * chaining the output Uint8Array from step N into step N+1 automatically.
 */
export async function executeWorkflowPipeline(
  initialFile: UploadedFileItem,
  steps: WorkflowStep[],
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  if (steps.length === 0) {
    throw new Error('Add at least one step to the workflow pipeline before running.');
  }

  let currentFile: UploadedFileItem = { ...initialFile };
  const stepLogs: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onProgress?.(`Workflow Step ${i + 1}/${steps.length}: Running ${step.toolId}...`);

    let stepOut: EngineOutput;
    switch (step.toolId) {
      case 'rotate-pdf':
        stepOut = await executeRotatePdf(currentFile, [], step.params);
        break;
      case 'page-numbers':
        stepOut = await executeAddPageNumbers(currentFile, step.params);
        break;
      case 'watermark-pdf':
        stepOut = await executeWatermarkPdf(currentFile, step.params);
        break;
      case 'crop-pdf':
        stepOut = await executeCropPdf(currentFile, step.params);
        break;
      case 'compress-pdf':
        stepOut = await executeCompressPdf(currentFile, step.params, onProgress);
        break;
      case 'repair-pdf':
        stepOut = await executeRepairPdf(currentFile, step.params, onProgress);
        break;
      case 'remove-pages':
        stepOut = await executeRemovePages(currentFile, [], {
          ...step.params,
          useVisualSelection: false,
        });
        break;
      case 'protect-pdf':
        stepOut = await executeProtectPdf(currentFile, {
          ...step.params,
          encryptionMode: 'protected-pdf',
        });
        break;
      case 'unlock-pdf':
        stepOut = await executeUnlockPdf(currentFile, step.params, onProgress);
        break;
      default:
        // Fallback pass-through for non-PDF-returning steps
        stepOut = await executeRepairPdf(currentFile, step.params);
        break;
    }

    stepLogs.push(`${i + 1}. ${step.toolId}: ${stepOut.summaryMessage}`);
    currentFile = {
      ...currentFile,
      name: stepOut.filename,
      size: stepOut.bytes.byteLength,
      bytes: stepOut.bytes,
      pageCount: stepOut.pageCount || currentFile.pageCount,
    };
  }

  return {
    bytes: currentFile.bytes,
    filename: `${initialFile.name.replace(/\.pdf$/i, '')}_workflow_${steps.length}steps.pdf`,
    mimeType: 'application/pdf',
    beforeSize: initialFile.bytes.byteLength,
    afterSize: currentFile.bytes.byteLength,
    pageCount: currentFile.pageCount,
    canChainAsPdf: true,
    textOutput: stepLogs.join('\n'),
    report: {
      'Steps Executed': steps.length,
      Pipeline: steps.map((s) => s.toolId).join(' → '),
    },
    summaryMessage: `Completed ${steps.length}-step Automated Workflow Pipeline.`,
  };
}
