import {
  AiEngineSettings,
  EngineOutput,
  UploadedFileItem,
  WorkflowStep,
} from '../types/pdf';
import {
  itemsToStructuredMarkdown,
  tfIdfSummarize,
} from '../utils/pdfHelpers';
import { extractPositionedTextFromPdf } from '../utils/pdfjsClient';
import { renderHtmlOrMarkdownToPdf } from '../utils/htmlPdfRenderer';
import {
  executeAddPageNumbers,
  executeCropPdf,
  executeRotatePdf,
  executeWatermarkPdf,
} from './editEngine';
import { executeCompressPdf, executeRepairPdf } from './optimizeEngine';
import { executeRemovePages } from './organizeEngine';
import { executeProtectPdf, executeUnlockPdf } from './securityEngine';

export interface CloudAiStatus {
  configured: boolean;
  model: string;
}

function isDesktopFileProtocol(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'file:';
}

/**
 * Queries the local Express backend to check if GEMINI_API_KEY is configured in Settings > Secrets.
 * Skips the request in packaged Electron (file://) where no local Express server is attached.
 */
export async function fetchCloudAiStatus(): Promise<CloudAiStatus> {
  if (isDesktopFileProtocol()) {
    return { configured: false, model: 'gemini-4-hydrogen' };
  }
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) return { configured: false, model: 'gemini-4-hydrogen' };
    const data = await res.json();
    return {
      configured: Boolean(data?.configured),
      model: String(data?.model || 'gemini-4-hydrogen'),
    };
  } catch {
    return { configured: false, model: 'gemini-4-hydrogen' };
  }
}

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
 * Unified AI Engine — explicitly propagates errors when Cloud AI (Gemini) or Local Ollama is selected
 * instead of silently failing or faking outputs.
 */
async function generateWithUnifiedAiEngine(
  prompt: string,
  systemInstruction: string,
  settings: AiEngineSettings
): Promise<{ text: string; providerUsed: string }> {
  if (settings.mode === 'ollama-local') {
    const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
    const modelName = settings.ollamaModel || 'llama3.2';
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt: `${systemInstruction}\n\n${prompt}`,
          stream: false,
        }),
      });
    } catch {
      throw new Error(
        `Could not connect to Local Ollama at ${baseUrl}. Start Ollama (with OLLAMA_ORIGINS="*" if needed) or switch AI Engine Mode.`
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `Local Ollama returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 160)}` : ''}. Verify model "${modelName}" is pulled.`
      );
    }

    const data = await res.json();
    if (!data?.response) {
      throw new Error('Local Ollama returned an empty response.');
    }
    return {
      text: String(data.response),
      providerUsed: `Local Ollama (${modelName})`,
    };
  }

  if (settings.mode === 'cloud-gemini') {
    if (isDesktopFileProtocol()) {
      throw new Error(
        'Cloud AI requires the web server backend. In the Desktop Offline Edition, switch AI Engine Mode to Local Ollama or Offline Extractive.'
      );
    }
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, systemInstruction }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data?.error ||
          `Cloud AI request failed (HTTP ${res.status}). Check GEMINI_API_KEY in Settings > Secrets.`
      );
    }
    if (!data?.text) {
      throw new Error('Cloud AI returned an empty response.');
    }
    return {
      text: String(data.text),
      providerUsed: `Cloud AI (${data.model || 'gemini-4-hydrogen'})`,
    };
  }

  return { text: '', providerUsed: 'Offline Deterministic TF-IDF Engine' };
}

/**
 * Tool 31: AI Summarizer
 * Extracts document text and generates Executive Summaries, Key Bullet Points, and Action Items.
 * Runs via Cloud AI (Gemini), Local Ollama, or 100% Offline Extractive TF-IDF.
 */
export async function executeAiSummarizer(
  file: UploadedFileItem,
  params: Record<string, any>,
  aiSettings: AiEngineSettings,
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  onProgress?.('Extracting PDF text layer for analysis...');
  const { fullText, pageTexts } = await extractPositionedTextFromPdf(file.bytes);

  if (!fullText.trim()) {
    throw new Error(
      'No extractable text found in this PDF (it may be a scanned image). Run OCR PDF first, then chain into AI Summarizer.'
    );
  }

  const lengthMap: Record<string, number> = { short: 3, medium: 5, long: 8 };
  const targetSentences = lengthMap[params.summaryLength || 'medium'] || 5;
  const tfIdf = tfIdfSummarize(fullText, targetSentences);

  let markdownReport = '';
  let providerUsed = 'Offline Extractive TF-IDF Engine';

  if (aiSettings.mode !== 'offline-extractive') {
    onProgress?.(
      `Generating summary via ${
        aiSettings.mode === 'ollama-local' ? 'Local Ollama' : 'Cloud AI (Gemini)'
      }...`
    );
    const aiRes = await generateWithUnifiedAiEngine(
      `Summarize the following PDF document (${params.summaryLength || 'medium'} length, ${
        params.analysisDepth || 'deep'
      } depth). Output clean Markdown with:\n# Executive Summary\n## Key Bullet Points\n## Action Items\n\nDocument Content:\n${fullText.slice(
        0,
        24000
      )}`,
      'You are a concise executive document analyst. Output clean structured Markdown without preamble.',
      aiSettings
    );
    markdownReport = aiRes.text;
    providerUsed = aiRes.providerUsed;
  } else {
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
      `## Document Metrics`,
      `- **Pages Analyzed:** ${pageTexts.length}`,
      `- **Word Count:** ${tfIdf.wordCount} words (${tfIdf.sentenceCount} sentences)`,
      `- **Top Terms:** ${tfIdf.topKeywords.join(', ') || 'N/A'}`,
      `- **Engine:** ${providerUsed}`,
    ].join('\n');
  }

  onProgress?.('Rendering formatted summary PDF...');
  const compiledPdf = await renderHtmlOrMarkdownToPdf(
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
      'Key Terms': tfIdf.topKeywords.slice(0, 5).join(', '),
    },
    summaryMessage: `Generated Executive Summary, Bullet Points & Action Items via ${providerUsed}.`,
  };
}

/**
 * Tool 32: Translate PDF
 * Translates PDF content via Cloud AI (Gemini) or Local Ollama and renders a full Unicode PDF.
 */
export async function executeTranslatePdf(
  file: UploadedFileItem,
  params: Record<string, any>,
  aiSettings: AiEngineSettings,
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  if (aiSettings.mode === 'offline-extractive') {
    throw new Error(
      'Accurate document translation requires an LLM engine. Switch AI Engine Mode to "Cloud AI (Gemini)" (configure GEMINI_API_KEY in Settings > Secrets) or "Local Ollama" running on your machine.'
    );
  }

  const targetLang = String(params.targetLanguage || 'Spanish');
  onProgress?.(`Extracting text across pages for ${targetLang} translation...`);
  const { pageTexts, fullText } = await extractPositionedTextFromPdf(file.bytes);

  if (!fullText.trim()) {
    throw new Error(
      'No extractable text found in this PDF. Run OCR PDF first to extract text from scanned pages.'
    );
  }

  const translatedPages: string[] = [];
  let providerUsed = '';

  for (let i = 0; i < pageTexts.length; i++) {
    const rawPage = pageTexts[i] || '';
    if (!rawPage.trim()) {
      translatedPages.push(`## Page ${i + 1}\n*(Blank Page)*`);
      continue;
    }

    onProgress?.(`Translating Page ${i + 1} of ${pageTexts.length} into ${targetLang}...`);
    const aiRes = await generateWithUnifiedAiEngine(
      `Translate the following PDF page accurately and naturally into ${targetLang}. Preserve headings, paragraphs, numbers, and bullet points. Do not add extra commentary:\n\n${rawPage.slice(
        0,
        8000
      )}`,
      `You are a professional document translator. Translate faithfully into ${targetLang} using clean Markdown.`,
      aiSettings
    );
    providerUsed = aiRes.providerUsed;

    if (params.bilingualSideBySide) {
      translatedPages.push(
        `## Page ${i + 1}\n### Source\n${rawPage}\n\n### ${targetLang}\n${aiRes.text}`
      );
    } else {
      translatedPages.push(`## Page ${i + 1}\n${aiRes.text}`);
    }
  }

  const combinedMd =
    `# ${file.name.replace(/\.pdf$/i, '')} (${targetLang})\n\n` + translatedPages.join('\n\n---\n\n');

  onProgress?.('Compiling translated PDF with full Unicode support...');
  const compiled = await renderHtmlOrMarkdownToPdf(
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
    summaryMessage: `Translated ${pageTexts.length} page(s) into ${targetLang} via ${providerUsed}.`,
  };
}

/**
 * Tool 33: PDF to Markdown (.md)
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
          password: step.params.password || 'protected',
          ...step.params,
          encryptionMode: 'protected-pdf',
        });
        break;
      case 'unlock-pdf':
        stepOut = await executeUnlockPdf(currentFile, step.params, onProgress);
        break;
      default:
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
