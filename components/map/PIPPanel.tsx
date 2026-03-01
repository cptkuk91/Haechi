'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Maximize2, Minimize2 } from 'lucide-react';

interface PIPItem {
  id: string;
  title: string;
  subtitle?: string;
  content: React.ReactNode;
}

interface PIPPanelProps {
  items: PIPItem[];
  onClose: (id: string) => void;
}

export default function PIPPanel({ items, onClose }: PIPPanelProps) {
  return (
    <div className="absolute bottom-24 right-4 z-50 flex flex-col gap-3 pointer-events-auto">
      <AnimatePresence>
        {items.slice(0, 3).map((item, index) => (
          <PIPWindow key={item.id} item={item} index={index} onClose={() => onClose(item.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function PIPWindow({
  item,
  index,
  onClose,
}: {
  item: PIPItem;
  index: number;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`bg-[#0a0f14]/95 backdrop-blur-md border border-cyan-900/40 rounded-xl overflow-hidden shadow-2xl shadow-cyan-950/30 ${
        expanded ? 'w-[480px] h-[320px]' : 'w-[320px] h-[200px]'
      } transition-all duration-300`}
    >
      {/* 타이틀바 */}
      <div className="flex items-center justify-between px-3 py-2 bg-cyan-950/30 border-b border-cyan-900/30">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(0,240,255,0.8)]" />
          <span className="text-[10px] font-mono text-cyan-400 tracking-wider">
            {item.title}
          </span>
          {item.subtitle && (
            <span className="text-[9px] font-mono text-cyan-700 tracking-wider">
              {item.subtitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-cyan-800/30 rounded transition-colors"
          >
            {expanded ? (
              <Minimize2 className="w-3 h-3 text-cyan-700" />
            ) : (
              <Maximize2 className="w-3 h-3 text-cyan-700" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-red-900/30 rounded transition-colors"
          >
            <X className="w-3 h-3 text-cyan-700 hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="w-full h-[calc(100%-36px)] flex items-center justify-center text-cyan-800 text-[10px] font-mono">
        {item.content || (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border border-cyan-800/40 rounded animate-pulse" />
            <span className="tracking-widest">NO SIGNAL</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
