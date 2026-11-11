import React from 'react';
import {
  Files,
  Scissors,
  FileMinus,
  FileOutput,
  LayoutGrid,
  Camera,
  Minimize2,
  Wrench,
  ScanText,
  Image,
  FileText,
  Presentation,
  Sheet,
  Code2,
  Images,
  FileType2,
  MonitorPlay,
  Table,
  ShieldCheck,
  RotateCw,
  Hash,
  Stamp,
  Crop,
  PenTool,
  FormInput,
  Unlock,
  Lock,
  FileSignature,
  EyeOff,
  GitCompare,
  Sparkles,
  Languages,
  FileCode,
  Workflow,
  BookOpen,
} from 'lucide-react';
import { ToolId } from '../types/pdf';

interface ToolIconProps {
  toolId: ToolId;
  className?: string;
}

export const ToolIcon: React.FC<ToolIconProps> = ({ toolId, className = 'w-5 h-5' }) => {
  switch (toolId) {
    // Category A: Organize PDF
    case 'merge-pdf':
      return <Files className={className} />;
    case 'split-pdf':
      return <Scissors className={className} />;
    case 'remove-pages':
      return <FileMinus className={className} />;
    case 'extract-pages':
      return <FileOutput className={className} />;
    case 'organize-pdf':
      return <LayoutGrid className={className} />;
    case 'scan-to-pdf':
      return <Camera className={className} />;

    // Category B: Optimize PDF
    case 'compress-pdf':
      return <Minimize2 className={className} />;
    case 'repair-pdf':
      return <Wrench className={className} />;
    case 'ocr-pdf':
      return <ScanText className={className} />;

    // Category C: Convert to PDF
    case 'images-to-pdf':
      return <Image className={className} />;
    case 'word-to-pdf':
      return <FileText className={className} />;
    case 'powerpoint-to-pdf':
      return <Presentation className={className} />;
    case 'excel-to-pdf':
      return <Sheet className={className} />;
    case 'html-to-pdf':
      return <Code2 className={className} />;

    // Category D: Convert from PDF
    case 'pdf-to-images':
      return <Images className={className} />;
    case 'pdf-to-word':
      return <FileType2 className={className} />;
    case 'pdf-to-powerpoint':
      return <MonitorPlay className={className} />;
    case 'pdf-to-excel':
      return <Table className={className} />;
    case 'pdf-to-pdfa':
      return <ShieldCheck className={className} />;

    // Category E: Edit PDF
    case 'rotate-pdf':
      return <RotateCw className={className} />;
    case 'page-numbers':
      return <Hash className={className} />;
    case 'watermark-pdf':
      return <Stamp className={className} />;
    case 'crop-pdf':
      return <Crop className={className} />;
    case 'edit-pdf':
      return <PenTool className={className} />;
    case 'pdf-forms':
      return <FormInput className={className} />;

    // Category F: PDF Security
    case 'unlock-pdf':
      return <Unlock className={className} />;
    case 'protect-pdf':
      return <Lock className={className} />;
    case 'sign-pdf':
      return <FileSignature className={className} />;
    case 'redact-pdf':
      return <EyeOff className={className} />;
    case 'compare-pdf':
      return <GitCompare className={className} />;

    // Category G: Intelligence & Workflows
    case 'ai-summarizer':
      return <Sparkles className={className} />;
    case 'translate-pdf':
      return <Languages className={className} />;
    case 'pdf-to-markdown':
      return <FileCode className={className} />;
    case 'custom-workflows':
      return <Workflow className={className} />;
    case 'pdf-reader':
      return <BookOpen className={className} />;
    default:
      return <FileText className={className} />;
  }
};
