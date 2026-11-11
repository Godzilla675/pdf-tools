import { ToolDefinition, ToolId } from '../types/pdf';

export const TOOLS_REGISTRY: ToolDefinition[] = [
  // ==================== CATEGORY A: ORGANIZE PDF (6 Tools) ====================
  {
    id: 'merge-pdf',
    number: 1,
    name: 'Merge PDF',
    shortName: 'Merge',
    category: 'organize',
    categoryLabel: 'Organize PDF',
    description: 'Combine multiple PDF files into a single document with custom ordering and A-Z sorting.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: true,
    supportsChainInput: true,
    defaultParams: {
      sortOrder: 'custom', // 'custom' | 'az' | 'za'
      selectionMode: 'all', // 'all' | 'selected'
      normalizePageSize: false,
    },
  },
  {
    id: 'split-pdf',
    number: 2,
    name: 'Split PDF',
    shortName: 'Split',
    category: 'organize',
    categoryLabel: 'Organize PDF',
    description: 'Split by custom page ranges, fixed intervals, burst all pages into ZIP, or smart content markers.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      splitMode: 'ranges', // 'ranges' | 'interval' | 'burst' | 'smart'
      rangeString: '1-2, 3-4',
      intervalPages: 2,
      smartMarker: 'Chapter|Invoice #|Page 1 of',
      mergeRangesIntoSinglePdf: false,
    },
  },
  {
    id: 'remove-pages',
    number: 3,
    name: 'Remove Pages',
    shortName: 'Remove Pages',
    category: 'organize',
    categoryLabel: 'Organize PDF',
    description: 'Click page thumbnails visually or enter ranges (even, odd, 2, 4-6) to delete unwanted pages.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      removeRanges: '2',
      useVisualSelection: true,
    },
  },
  {
    id: 'extract-pages',
    number: 4,
    name: 'Extract Pages',
    shortName: 'Extract Pages',
    category: 'organize',
    categoryLabel: 'Organize PDF',
    description: 'Select specific pages visually or by range and export as one combined PDF or individual ZIP files.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      extractRanges: '1, 3',
      useVisualSelection: true,
      exportAsZip: false,
    },
  },
  {
    id: 'organize-pdf',
    number: 5,
    name: 'Organize PDF',
    shortName: 'Organize',
    category: 'organize',
    categoryLabel: 'Organize PDF',
    description: 'All-in-one visual page manager: reorder, rotate individual pages, insert blank pages, or duplicate.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: true,
    supportsChainInput: true,
    defaultParams: {
      interleaveSecondPdf: false,
    },
  },
  {
    id: 'scan-to-pdf',
    number: 6,
    name: 'Scan to PDF',
    shortName: 'Scan to PDF',
    category: 'organize',
    categoryLabel: 'Organize PDF',
    description: 'Capture from Mac webcam or local photos with live adaptive monochrome document scanner filter.',
    acceptedFormats: 'image/*,.jpg,.jpeg,.png,.webp',
    multipleFiles: true,
    supportsChainInput: false,
    defaultParams: {
      threshold: 145,
      contrast: 1.45,
      filterMode: 'adaptive-mono', // 'adaptive-mono' | 'high-contrast-gray' | 'original'
      pageSize: 'A4', // 'A4' | 'Letter' | 'Fit'
    },
  },

  // ==================== CATEGORY B: OPTIMIZE PDF (3 Tools) ====================
  {
    id: 'compress-pdf',
    number: 7,
    name: 'Compress PDF',
    shortName: 'Compress',
    category: 'optimize',
    categoryLabel: 'Optimize PDF',
    description: 'Reduce PDF byte size with Extreme, Recommended, or Less presets and object stream optimization.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      preset: 'recommended', // 'extreme' | 'recommended' | 'less'
      grayscale: false,
    },
  },
  {
    id: 'repair-pdf',
    number: 8,
    name: 'Repair PDF',
    shortName: 'Repair',
    category: 'optimize',
    categoryLabel: 'Optimize PDF',
    description: 'Parse damaged PDF streams with fault-tolerant recovery and rebuild clean cross-reference tables.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      deepStreamRebuild: true,
      sanitizeMetadata: true,
    },
  },
  {
    id: 'ocr-pdf',
    number: 9,
    name: 'OCR PDF',
    shortName: 'OCR PDF',
    category: 'optimize',
    categoryLabel: 'Optimize PDF',
    description: '100% offline Optical Character Recognition producing a searchable PDF and .txt transcript.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      language: 'eng',
      renderScale: 1.5,
      embedSearchableLayer: true,
    },
  },

  // ==================== CATEGORY C: CONVERT TO PDF (5 Tools) ====================
  {
    id: 'images-to-pdf',
    number: 10,
    name: 'JPG / Images to PDF',
    shortName: 'Images to PDF',
    category: 'convert-to-pdf',
    categoryLabel: 'Convert to PDF',
    description: 'Convert JPG, PNG, WEBP, GIF, BMP, and SVG images into PDF with custom page sizes and margins.',
    acceptedFormats: 'image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg',
    multipleFiles: true,
    supportsChainInput: false,
    defaultParams: {
      pageSize: 'A4', // 'Fit' | 'A4' | 'Letter'
      orientation: 'auto', // 'portrait' | 'landscape' | 'auto'
      margin: 'small', // 'none' | 'small' | 'large'
      centerImage: true,
    },
  },
  {
    id: 'word-to-pdf',
    number: 11,
    name: 'WORD to PDF',
    shortName: 'Word to PDF',
    category: 'convert-to-pdf',
    categoryLabel: 'Convert to PDF',
    description: 'Parse .docx files offline using Mammoth and paginate structured text, headings, and lists into PDF.',
    acceptedFormats: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    multipleFiles: false,
    supportsChainInput: false,
    defaultParams: {
      pageSize: 'A4',
      fontSize: 11,
      lineSpacing: 1.45,
    },
  },
  {
    id: 'powerpoint-to-pdf',
    number: 12,
    name: 'POWERPOINT to PDF',
    shortName: 'PPTX to PDF',
    category: 'convert-to-pdf',
    categoryLabel: 'Convert to PDF',
    description: 'Unzip .pptx archives in memory, extract slide XML content & media, and render 16:9 landscape slides.',
    acceptedFormats: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
    multipleFiles: false,
    supportsChainInput: false,
    defaultParams: {
      theme: 'light', // 'light' | 'dark'
      includeSlideNumbers: true,
    },
  },
  {
    id: 'excel-to-pdf',
    number: 13,
    name: 'EXCEL to PDF',
    shortName: 'Excel to PDF',
    category: 'convert-to-pdf',
    categoryLabel: 'Convert to PDF',
    description: 'Parse .xlsx, .xls, and .csv spreadsheets via SheetJS into formatted monochrome data tables.',
    acceptedFormats: '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
    multipleFiles: false,
    supportsChainInput: false,
    defaultParams: {
      orientation: 'landscape', // 'portrait' | 'landscape'
      showGridlines: true,
      repeatHeaderRow: true,
    },
  },
  {
    id: 'html-to-pdf',
    number: 14,
    name: 'HTML / Markdown to PDF',
    shortName: 'HTML/MD to PDF',
    category: 'convert-to-pdf',
    categoryLabel: 'Convert to PDF',
    description: 'Live split-pane HTML & Markdown editor and file compiler that renders paginated vector PDFs.',
    acceptedFormats: '.html,.htm,.md,.markdown,.txt,text/html,text/markdown',
    multipleFiles: false,
    supportsChainInput: false,
    defaultParams: {
      sourceFormat: 'markdown', // 'markdown' | 'html'
      rawContent: `# pdf tools Architectural Specification\n\n## 01. Executive Summary\npdf tools executes **100% client-side byte manipulation** across 33 specialized tools without external servers.\n\n- Zero cloud latency or privacy leakage\n- Native Uint8Array pipeline chaining\n- ISO PDF/A-1b and PDF/A-2b archival compliance\n\n## 02. Benchmark Telemetry\n| Operation | Input Size | Output Size | Execution Time |\n| :--- | :--- | :--- | :--- |\n| Compress (Recommended) | 4.20 MB | 1.18 MB | 310 ms |\n| Destructive Redaction | 1.85 MB | 1.42 MB | 190 ms |\n| Smart Content Split | 6.10 MB | 6 Files | 145 ms |\n`,
      pageSize: 'A4',
    },
  },

  // ==================== CATEGORY D: CONVERT FROM PDF (5 Tools) ====================
  {
    id: 'pdf-to-images',
    number: 15,
    name: 'PDF to JPG / PNG',
    shortName: 'PDF to Images',
    category: 'convert-from-pdf',
    categoryLabel: 'Convert from PDF',
    description: 'Render pages to JPG or PNG at 72/150/300 DPI inside a .zip or extract embedded image streams.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      mode: 'render', // 'render' | 'extract-embedded'
      format: 'png', // 'png' | 'jpeg'
      dpiScale: 2, // 1 (72 DPI) | 2 (150 DPI) | 3 (300 DPI)
    },
  },
  {
    id: 'pdf-to-word',
    number: 16,
    name: 'PDF to WORD (.docx)',
    shortName: 'PDF to Word',
    category: 'convert-from-pdf',
    categoryLabel: 'Convert from PDF',
    description: 'Extract text blocks, font sizes, and Y-coordinates to build a genuine .docx document.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      preservePageBreaks: true,
      detectHeadings: true,
    },
  },
  {
    id: 'pdf-to-powerpoint',
    number: 17,
    name: 'PDF to POWERPOINT (.pptx)',
    shortName: 'PDF to PPTX',
    category: 'convert-from-pdf',
    categoryLabel: 'Convert from PDF',
    description: 'Convert PDF pages and text layers into a downloadable 16:9 .pptx presentation deck.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      mode: 'hybrid', // 'hybrid' | 'visual-slides' | 'editable-text'
      dpiScale: 1.5,
    },
  },
  {
    id: 'pdf-to-excel',
    number: 18,
    name: 'PDF to EXCEL (.xlsx)',
    shortName: 'PDF to Excel',
    category: 'convert-from-pdf',
    categoryLabel: 'Convert from PDF',
    description: 'Group PDF text items by X/Y coordinates into structured rows and columns inside a multi-sheet .xlsx.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      yTolerance: 4,
      sheetPerPage: true,
    },
  },
  {
    id: 'pdf-to-pdfa',
    number: 19,
    name: 'PDF to PDF/A',
    shortName: 'PDF to PDF/A',
    category: 'convert-from-pdf',
    categoryLabel: 'Convert from PDF',
    description: 'Embed ISO PDF/A-1b or PDF/A-2b XMP conformance metadata streams with a Compliance Inspector report.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      conformanceLevel: 'PDF/A-2b', // 'PDF/A-1b' | 'PDF/A-2b'
      documentTitle: 'pdf tools Archival Record',
      documentAuthor: 'pdf tools Compliance Engine',
    },
  },

  // ==================== CATEGORY E: EDIT PDF (6 Tools) ====================
  {
    id: 'rotate-pdf',
    number: 20,
    name: 'Rotate PDF',
    shortName: 'Rotate',
    category: 'edit',
    categoryLabel: 'Edit PDF',
    description: 'Rotate All, Portrait-only, Landscape-only, Even, Odd, or specific pages by 90° CW, 90° CCW, or 180°.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      angle: 90, // 90 | 180 | 270
      targetFilter: 'all', // 'all' | 'portrait' | 'landscape' | 'even' | 'odd'
    },
  },
  {
    id: 'page-numbers',
    number: 21,
    name: 'Add Page Numbers',
    shortName: 'Page Numbers',
    category: 'edit',
    categoryLabel: 'Edit PDF',
    description: '9-point header/footer grid, facing-page mirror mode, custom start offset, and numbering templates.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      position: 'bottom-right', // 'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'
      mirrorFacingPages: false,
      startFromPage: 1,
      firstNumber: 1,
      fontSize: 10,
      marginOffset: 28,
      template: 'Page {n} of {total}', // '{n}' | 'Page {n}' | 'Page {n} of {total}' | '- {n} -'
    },
  },
  {
    id: 'watermark-pdf',
    number: 22,
    name: 'Add Watermark',
    shortName: 'Watermark',
    category: 'edit',
    categoryLabel: 'Edit PDF',
    description: 'Stamp text or image watermarks with opacity, rotation, Over/Under layer order, or Mosaic Tiled Grid.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      watermarkType: 'text', // 'text' | 'image'
      text: 'CONFIDENTIAL',
      opacity: 0.22,
      rotation: -35,
      fontSize: 44,
      grayShade: 0.35, // 0 (black) to 0.9 (light gray)
      layerOrder: 'over', // 'over' | 'under'
      placement: 'single', // 'single' | 'mosaic'
    },
  },
  {
    id: 'crop-pdf',
    number: 23,
    name: 'Crop PDF',
    shortName: 'Crop',
    category: 'edit',
    categoryLabel: 'Edit PDF',
    description: 'Interactive draggable crop overlay and point margin controls applied via MediaBox & CropBox.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      top: 36,
      bottom: 36,
      left: 36,
      right: 36,
      applyTo: 'all', // 'all' | 'current' | 'odd' | 'even'
    },
  },
  {
    id: 'edit-pdf',
    number: 24,
    name: 'Edit PDF (Canvas Studio)',
    shortName: 'Edit Studio',
    category: 'edit',
    categoryLabel: 'Edit PDF',
    description: 'Full interactive overlay editor for Text Boxes, Freehand Pen, Highlighter, Shapes, Images, and Notes.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      activeDrawTool: 'text', // 'text' | 'pen' | 'highlighter' | 'rect' | 'line' | 'comment'
      strokeWidth: 2,
      fontSize: 14,
    },
  },
  {
    id: 'pdf-forms',
    number: 25,
    name: 'PDF Forms (Filler & Builder)',
    shortName: 'PDF Forms',
    category: 'edit',
    categoryLabel: 'Edit PDF',
    description: 'Fill & flatten existing AcroForms, or auto-detect ___ and [ ] fields to build interactive PDF forms.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      formMode: 'builder', // 'filler' | 'builder'
      flattenOnExport: false,
    },
  },

  // ==================== CATEGORY F: PDF SECURITY (5 Tools) ====================
  {
    id: 'unlock-pdf',
    number: 26,
    name: 'Unlock PDF',
    shortName: 'Unlock',
    category: 'security',
    categoryLabel: 'PDF Security',
    description: 'Decrypt password-protected PDF streams and reconstruct an unlocked, restriction-free PDF.',
    acceptedFormats: '.pdf,application/pdf,.monopdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      password: '',
    },
  },
  {
    id: 'protect-pdf',
    number: 27,
    name: 'Protect PDF',
    shortName: 'Protect',
    category: 'security',
    categoryLabel: 'PDF Security',
    description: 'Apply password security metadata, watermark lock, or AES-256-GCM encrypted .monopdf vault output.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      password: '',
      confirmPassword: '',
      encryptionMode: 'protected-pdf', // 'protected-pdf' | 'aes256-vault'
      allowPrinting: false,
      allowCopying: false,
    },
  },
  {
    id: 'sign-pdf',
    number: 28,
    name: 'Sign PDF',
    shortName: 'Sign PDF',
    category: 'security',
    categoryLabel: 'PDF Security',
    description: 'Draw, type, or upload a signature, position stamps on any page, and append a SHA-256 Audit Trail page.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      signerName: 'A. Mercer (Authorized Signatory)',
      signerTitle: 'Principal Systems Architect',
      includeDateStamp: true,
      appendAuditTrailPage: true,
      signatureStyle: 'drawn', // 'drawn' | 'typed'
      typedText: 'A. Mercer',
    },
  },
  {
    id: 'redact-pdf',
    number: 29,
    name: 'Redact PDF (Destructive)',
    shortName: 'Redact',
    category: 'security',
    categoryLabel: 'PDF Security',
    description: 'Drag redaction boxes or auto-scan Emails/Phones/SSNs/Cards and permanently rasterize redacted pages.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      scanEmails: true,
      scanPhones: true,
      scanSsn: true,
      scanCreditCards: true,
      customSearchPattern: '',
      dpiScale: 2,
    },
  },
  {
    id: 'compare-pdf',
    number: 30,
    name: 'Compare PDF',
    shortName: 'Compare',
    category: 'security',
    categoryLabel: 'PDF Security',
    description: 'Side-by-side Semantic Text Diff and Visual Pixel Difference Overlay between Document A and Document B.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: true,
    supportsChainInput: true,
    defaultParams: {
      compareMode: 'semantic', // 'semantic' | 'visual'
      diffGranularity: 'words', // 'words' | 'lines'
    },
  },

  // ==================== CATEGORY G: PDF INTELLIGENCE & AUTOMATION (31-34) ====================
  {
    id: 'ai-summarizer',
    number: 31,
    name: 'AI Summarizer',
    shortName: 'Summarizer',
    category: 'ai',
    categoryLabel: 'AI & Workflows',
    description: 'Generate Executive Summaries, Key Bullet Points, and Action Items via Local Ollama, Offline TF-IDF, or Cloud AI.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      summaryLength: 'medium', // 'short' | 'medium' | 'long'
      analysisDepth: 'deep', // 'standard' | 'deep'
      exportSummaryPdf: true,
    },
  },
  {
    id: 'translate-pdf',
    number: 32,
    name: 'Translate PDF',
    shortName: 'Translate',
    category: 'ai',
    categoryLabel: 'AI & Workflows',
    description: 'Translate PDF documents across languages while generating a paginated PDF preserving structure.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      targetLanguage: 'Spanish', // 'Spanish' | 'French' | 'German' | 'Japanese' | 'Portuguese' | 'Italian'
      bilingualSideBySide: false,
    },
  },
  {
    id: 'pdf-to-markdown',
    number: 33,
    name: 'PDF to Markdown (.md)',
    shortName: 'PDF to MD',
    category: 'ai',
    categoryLabel: 'AI & Workflows',
    description: 'Font-size distribution heuristics converting PDFs into structured Markdown (# H1, lists, tables, code).',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {
      includePageMarkers: true,
      detectTables: true,
    },
  },
  {
    id: 'custom-workflows',
    number: 34,
    name: 'Automated Workflows',
    shortName: 'Workflows',
    category: 'workflows',
    categoryLabel: 'AI & Workflows',
    description: 'Build multi-step macro pipelines (e.g., Rotate → Watermark → Page Numbers → Compress) in one click.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {},
  },
  {
    id: 'pdf-reader',
    number: 0,
    name: 'Built-in PDF Reader',
    shortName: 'PDF Reader',
    category: 'reader',
    categoryLabel: 'Built-in Reader',
    description: 'High-contrast macOS monochrome document reader with text search, zoom, and page inspection.',
    acceptedFormats: '.pdf,application/pdf',
    multipleFiles: false,
    supportsChainInput: true,
    defaultParams: {},
  },
];

export function getToolById(id: ToolId): ToolDefinition {
  return TOOLS_REGISTRY.find((t) => t.id === id) || TOOLS_REGISTRY[0];
}

export const CATEGORY_TABS: { id: string; label: string; count: number }[] = [
  { id: 'all', label: 'All 33 Tools', count: 33 },
  { id: 'organize', label: 'Organize', count: 6 },
  { id: 'optimize', label: 'Optimize', count: 3 },
  { id: 'convert-to-pdf', label: 'Convert To PDF', count: 5 },
  { id: 'convert-from-pdf', label: 'Convert From PDF', count: 5 },
  { id: 'edit', label: 'Edit PDF', count: 6 },
  { id: 'security', label: 'Security', count: 5 },
  { id: 'ai', label: 'AI & Markdown', count: 3 },
  { id: 'workflows', label: 'Workflows', count: 1 },
  { id: 'reader', label: 'PDF Reader', count: 1 },
];
