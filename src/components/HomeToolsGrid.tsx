import React, { useMemo, useState } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { CATEGORY_TABS, TOOLS_REGISTRY } from '../registry/toolsRegistry';
import { ToolCategory, ToolId } from '../types/pdf';
import { ToolIcon } from './ToolIcon';

interface HomeToolsGridProps {
  activeCategory: ToolCategory;
  onSelectCategory: (cat: ToolCategory) => void;
  onSelectTool: (id: ToolId) => void;
}

export const HomeToolsGrid: React.FC<HomeToolsGridProps> = ({
  activeCategory,
  onSelectCategory,
  onSelectTool,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return TOOLS_REGISTRY.filter((tool) => {
      const matchesCat =
        activeCategory === 'all' ? true : tool.category === activeCategory;
      const matchesQuery =
        !q ||
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.categoryLabel.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [activeCategory, searchQuery]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#f8f9fa] dark:bg-[#0d1117] pb-20">
      {/* iLovePDF + Kaggle Style Hero Section */}
      <section className="bg-white dark:bg-[#161b22] border-b border-[#dadce0] dark:border-zinc-800 pt-10 pb-8 px-6">
        <div className="max-w-6xl mx-auto text-center space-y-4">
          <h1
            className="text-3xl md:text-4xl font-bold tracking-tight text-[#202124] dark:text-zinc-50"
            style={{ textWrap: 'balance' }}
          >
            Every tool you need to work with PDFs in one place
          </h1>
          <p className="text-sm md:text-base text-[#5f6368] dark:text-zinc-400 max-w-2xl mx-auto">
            100% offline, client-side PDF toolkit. Merge, split, compress, convert, rotate, unlock, watermark, and redact PDFs directly in your browser.
          </p>

          {/* Kaggle-Style Search Input + Category Filter Pills */}
          <div className="pt-3 max-w-xl mx-auto">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-[#5f6368] dark:text-zinc-400 absolute left-4 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter tools by name or task (e.g., Merge, OCR, Word, Redact, PDF/A)..."
                aria-label="Filter PDF tools"
                className="w-full pl-11 pr-4 py-2.5 text-sm rounded-full bg-[#f1f3f4] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-700 text-[#202124] dark:text-zinc-100 placeholder-[#5f6368] dark:placeholder-zinc-500 focus:outline-none focus:bg-white dark:focus:bg-zinc-950 focus:border-[#202124] dark:focus:border-zinc-400 transition-colors"
              />
            </div>
          </div>

          {/* Horizontal Category Filter Pills */}
          <div
            className="flex flex-wrap items-center justify-center gap-2 pt-3"
            role="tablist"
            aria-label="PDF Tool Categories"
          >
            {CATEGORY_TABS.map((cat) => {
              const isSelected = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => onSelectCategory(cat.id as ToolCategory)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-[#202124] text-white border-[#202124] dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100 shadow-xs'
                      : 'bg-white dark:bg-zinc-900 text-[#5f6368] dark:text-zinc-300 border-[#dadce0] dark:border-zinc-800 hover:border-[#202124] dark:hover:border-zinc-500 hover:text-[#202124] dark:hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main iLovePDF Tool Card Grid with Kaggle Monochrome Aesthetics */}
      <section className="max-w-7xl mx-auto px-6 pt-8">
        {filteredTools.length === 0 ? (
          <div className="bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 p-12 text-center space-y-3">
            <p className="text-base font-semibold text-[#202124] dark:text-zinc-100">
              No tools matched "{searchQuery}"
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                onSelectCategory('all');
              }}
              className="px-4 py-2 text-xs font-semibold rounded-full bg-[#202124] text-white dark:bg-zinc-100 dark:text-zinc-950"
            >
              Show All 33 Tools
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredTools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool(tool.id)}
                className="group text-left bg-white dark:bg-[#161b22] rounded-2xl border border-[#dadce0] dark:border-zinc-800 p-5 flex flex-col justify-between gap-4 hover:border-[#202124] dark:hover:border-zinc-400 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="space-y-3.5">
                  {/* Top Row: Feature Icon Box + Tool Index */}
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-xl bg-[#f1f3f4] dark:bg-zinc-800 text-[#202124] dark:text-zinc-100 flex items-center justify-center group-hover:bg-[#202124] group-hover:text-white dark:group-hover:bg-zinc-100 dark:group-hover:text-zinc-950 transition-colors">
                      <ToolIcon toolId={tool.id} className="w-5 h-5" />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-mono text-[#5f6368] dark:text-zinc-500 tabular-nums">
                      <span>
                        {tool.number > 0
                          ? `#${String(tool.number).padStart(2, '0')}`
                          : 'READER'}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#202124] dark:text-zinc-200" />
                    </div>
                  </div>

                  {/* Tool Title & Description */}
                  <div className="space-y-1.5">
                    <h2 className="text-base font-bold text-[#202124] dark:text-zinc-50 group-hover:underline underline-offset-4">
                      {tool.name}
                    </h2>
                    <p className="text-xs text-[#5f6368] dark:text-zinc-400 leading-relaxed line-clamp-3">
                      {tool.description}
                    </p>
                  </div>
                </div>

                {/* Quiet Unboxed Metadata Footer */}
                <div className="pt-2 border-t border-[#f1f3f4] dark:border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-[#5f6368] dark:text-zinc-500">
                  <span>{tool.categoryLabel}</span>
                  <span>
                    {tool.acceptedFormats.includes('.pdf')
                      ? 'PDF'
                      : tool.acceptedFormats.split(',')[0].toUpperCase()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
