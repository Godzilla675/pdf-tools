import React from 'react';
import { Search, Sun, Moon, LayoutGrid } from 'lucide-react';
import { ToolId } from '../types/pdf';

interface TopNavbarProps {
  isHomeView: boolean;
  activeToolId: ToolId;
  onGoHome: () => void;
  onSelectTool: (id: ToolId) => void;
  onOpenCommandPalette: () => void;
  themeMode: 'dark' | 'light' | 'system';
  onChangeTheme: (mode: 'dark' | 'light' | 'system') => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  isHomeView,
  activeToolId,
  onGoHome,
  onSelectTool,
  onOpenCommandPalette,
  themeMode,
  onChangeTheme,
}) => {
  const navLinks: { label: string; id: ToolId }[] = [
    { label: 'Merge PDF', id: 'merge-pdf' },
    { label: 'Split PDF', id: 'split-pdf' },
    { label: 'Compress PDF', id: 'compress-pdf' },
    { label: 'Edit PDF', id: 'edit-pdf' },
    { label: 'Workflows', id: 'custom-workflows' },
  ];

  return (
    <header className="h-16 px-6 bg-white dark:bg-[#161b22] border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between gap-8 sticky top-0 z-30">
      {/* Zone 1: Brand Wordmark */}
      <button
        type="button"
        onClick={onGoHome}
        className="text-lg font-bold tracking-tight text-[#202124] dark:text-zinc-50 whitespace-nowrap shrink-0 cursor-pointer"
      >
        pdf tools
      </button>

      {/* Zone 2: Concise Single-Line Navigation Links (iLovePDF style) */}
      <nav
        aria-label="Primary Navigation"
        className="hidden md:flex items-center gap-6 text-sm font-medium text-[#5f6368] dark:text-zinc-400"
      >
        <button
          type="button"
          onClick={onGoHome}
          className={`flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap shrink-0 ${
            isHomeView
              ? 'text-[#202124] dark:text-white font-semibold underline underline-offset-8 decoration-2'
              : 'hover:text-[#202124] dark:hover:text-white'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>All PDF Tools</span>
        </button>
        {navLinks.map((item) => {
          const isActive = !isHomeView && activeToolId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTool(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'text-[#202124] dark:text-white font-semibold underline underline-offset-8 decoration-2'
                  : 'hover:text-[#202124] dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Search & Theme Toggle */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open Command Palette (Cmd+K)"
          className="flex items-center gap-2.5 px-3.5 py-1.5 text-xs font-medium rounded-full bg-[#f1f3f4] dark:bg-zinc-800/90 text-[#5f6368] dark:text-zinc-300 border border-transparent hover:border-[#dadce0] dark:hover:border-zinc-700 transition-all whitespace-nowrap shrink-0"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search 33 tools...</span>
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900 text-[#202124] dark:text-zinc-300 border border-[#dadce0] dark:border-zinc-700">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => onChangeTheme(themeMode === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle Light or Dark Theme"
          className="p-2 rounded-full bg-[#f1f3f4] dark:bg-zinc-800 text-[#202124] dark:text-zinc-200 hover:bg-[#e8eaed] dark:hover:bg-zinc-700 transition-colors"
        >
          {themeMode === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
      </div>
    </header>
  );
};
