import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, X } from 'lucide-react';
import { ToolDefinition, ToolId } from '../types/pdf';
import { TOOLS_REGISTRY } from '../registry/toolsRegistry';
import { ToolIcon } from './ToolIcon';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTool: (toolId: ToolId) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  onSelectTool,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const filteredTools = useMemo<ToolDefinition[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOOLS_REGISTRY;
    return TOOLS_REGISTRY.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.categoryLabel.toLowerCase().includes(q) ||
        String(t.number) === q
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredTools.length]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(filteredTools.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev - 1 < 0 ? Math.max(filteredTools.length - 1, 0) : prev - 1
      );
    } else if (e.key === 'Enter' && filteredTools[selectedIndex]) {
      e.preventDefault();
      onSelectTool(filteredTools[selectedIndex].id);
      onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-[2px] px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-[#161b22] border border-[#dadce0] dark:border-[#30363d] rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#dadce0] dark:border-[#30363d]">
          <Search className="w-4 h-4 text-[#5f6368] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to any of the 33 PDF tools, workflows, or reader (type name or #1-33)..."
            aria-label="Search 33 PDF tools"
            className="w-full bg-transparent text-sm text-[#202124] dark:text-[#f0f6fc] placeholder-[#5f6368] dark:placeholder-[#8b949e] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Command Palette"
            className="p-1 text-[#5f6368] hover:text-[#202124] dark:hover:text-[#f0f6fc] rounded-full"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto divide-y divide-[#f1f3f4] dark:divide-[#21262d]">
          {filteredTools.length === 0 ? (
            <div className="py-10 text-center text-xs font-mono text-[#5f6368]">
              No matching tool found for "{query}"
            </div>
          ) : (
            filteredTools.map((tool, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    onSelectTool(tool.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between gap-3.5 px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? 'bg-[#202124] text-white dark:bg-[#f0f6fc] dark:text-[#0d1117]'
                      : 'text-[#202124] dark:text-[#f0f6fc] hover:bg-[#f8f9fa] dark:hover:bg-[#21262d]'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                      isSelected
                        ? 'bg-white/10 border-white/20 text-white dark:bg-black/10 dark:border-black/20 dark:text-[#0d1117]'
                        : 'bg-[#f8f9fa] dark:bg-[#0d1117] border-[#dadce0] dark:border-[#30363d] text-[#202124] dark:text-[#f0f6fc]'
                    }`}
                  >
                    <ToolIcon toolId={tool.id} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{tool.name}</span>
                      <span
                        className={`text-[11px] font-mono ${
                          isSelected
                            ? 'text-zinc-300 dark:text-zinc-600'
                            : 'text-[#5f6368] dark:text-[#8b949e]'
                        }`}
                      >
                        · {tool.categoryLabel}
                      </span>
                    </div>
                    <p
                      className={`text-xs mt-0.5 truncate ${
                        isSelected
                          ? 'text-zinc-300 dark:text-zinc-700'
                          : 'text-[#5f6368] dark:text-[#8b949e]'
                      }`}
                    >
                      {tool.description}
                    </p>
                  </div>
                  <CornerDownLeft
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isSelected ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 text-[11px] font-mono text-zinc-500">
          <span>↑↓ Navigate · Enter Select · Esc Dismiss</span>
          <span>33 OFFLINE ENGINES READY</span>
        </div>
      </div>
    </div>
  );
};
