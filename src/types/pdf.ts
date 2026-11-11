export type ToolCategory =
  | 'all'
  | 'organize'
  | 'optimize'
  | 'convert-to-pdf'
  | 'convert-from-pdf'
  | 'edit'
  | 'security'
  | 'ai'
  | 'workflows'
  | 'reader';

export type ToolId =
  // Category A: Organize PDF (1-6)
  | 'merge-pdf'
  | 'split-pdf'
  | 'remove-pages'
  | 'extract-pages'
  | 'organize-pdf'
  | 'scan-to-pdf'
  // Category B: Optimize PDF (7-9)
  | 'compress-pdf'
  | 'repair-pdf'
  | 'ocr-pdf'
  // Category C: Convert To PDF (10-14)
  | 'images-to-pdf'
  | 'word-to-pdf'
  | 'powerpoint-to-pdf'
  | 'excel-to-pdf'
  | 'html-to-pdf'
  // Category D: Convert From PDF (15-19)
  | 'pdf-to-images'
  | 'pdf-to-word'
  | 'pdf-to-powerpoint'
  | 'pdf-to-excel'
  | 'pdf-to-pdfa'
  // Category E: Edit PDF (20-25)
  | 'rotate-pdf'
  | 'page-numbers'
  | 'watermark-pdf'
  | 'crop-pdf'
  | 'edit-pdf'
  | 'pdf-forms'
  // Category F: PDF Security (26-30)
  | 'unlock-pdf'
  | 'protect-pdf'
  | 'sign-pdf'
  | 'redact-pdf'
  | 'compare-pdf'
  // Category G: PDF Intelligence & Automation (31-34)
  | 'ai-summarizer'
  | 'translate-pdf'
  | 'pdf-to-markdown'
  | 'custom-workflows'
  // Built-in Reader
  | 'pdf-reader';

export interface ToolDefinition {
  id: ToolId;
  number: number; // 1 to 34 (0 for reader)
  name: string;
  shortName: string;
  category: Exclude<ToolCategory, 'all'>;
  categoryLabel: string;
  description: string;
  acceptedFormats: string;
  multipleFiles: boolean;
  supportsChainInput: boolean;
  defaultParams: Record<string, any>;
}

export interface UploadedFileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  bytes: Uint8Array;
  pageCount: number;
  lastModified: number;
}

export interface RenderedPageThumbnail {
  pageIndex: number; // 0-based index in current active representation
  originalPageIndex: number; // 0-based index in source file
  sourceFileId: string;
  pageNumber: number; // 1-based display number
  width: number; // in PDF points
  height: number; // in PDF points
  rotation: number; // additional rotation in degrees (0, 90, 180, 270)
  dataUrl: string;
  isBlank?: boolean;
  selected?: boolean;
}

export type CanvasAnnotationType =
  | 'text'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'line'
  | 'image'
  | 'comment'
  | 'redaction'
  | 'signature'
  | 'form-text'
  | 'form-checkbox'
  | 'form-dropdown';

export interface CanvasAnnotation {
  id: string;
  pageIndex: number; // 0-based
  type: CanvasAnnotationType;
  // Normalized coordinates (0..1 relative to page width/height from top-left)
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string; // Hex grayscale e.g. #09090b, #52525b
  points?: { x: number; y: number }[]; // Normalized 0..1 points for freehand pen/highlighter
  imageDataUrl?: string;
  fieldName?: string;
  fieldOptions?: string[]; // For dropdowns
  checked?: boolean;
}

export interface DetectedAcroField {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'unknown';
  value: string | boolean;
  options?: string[];
}

export interface CropMargins {
  top: number; // in PDF points
  bottom: number;
  left: number;
  right: number;
}

export interface EngineSecondaryFile {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface EngineOutput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  beforeSize: number;
  afterSize: number;
  pageCount?: number;
  canChainAsPdf: boolean;
  summaryMessage: string;
  secondaryFiles?: EngineSecondaryFile[];
  textOutput?: string;
  report?: Record<string, any>;
  diffResult?: {
    addedCount: number;
    removedCount: number;
    parts: { value: string; added?: boolean; removed?: boolean }[];
    visualOverlayDataUrls?: string[];
  };
}

export type AiProviderMode = 'offline-extractive' | 'ollama-local' | 'cloud-gemini';

export interface AiEngineSettings {
  mode: AiProviderMode;
  ollamaUrl: string;
  ollamaModel: string;
}

export interface WorkflowStep {
  id: string;
  toolId: ToolId;
  params: Record<string, any>;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
}
