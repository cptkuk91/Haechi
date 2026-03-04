'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
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
  className?: string;
}

export default function PIPPanel({ items, onClose, className }: PIPPanelProps) {
  return (
    <div className={className ?? 'absolute top-20 left-4 z-[75] flex flex-col gap-3 pointer-events-auto'}>
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
  const [size, setSize] = useState({ width: 320, height: 200 });
  const dragControls = useDragControls();
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const isResizingRef = useRef(false);

  const isExpanded = size.width >= 420 || size.height >= 280;

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || event.pointerId !== resizeState.pointerId) return;

      const minWidth = 300;
      const minHeight = 190;
      const maxWidth = Math.max(minWidth, window.innerWidth - 24);
      const maxHeight = Math.max(minHeight, window.innerHeight - 24);
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, resizeState.startWidth + (event.clientX - resizeState.startX))
      );
      const nextHeight = Math.min(
        maxHeight,
        Math.max(minHeight, resizeState.startHeight + (event.clientY - resizeState.startY))
      );

      setSize({ width: nextWidth, height: nextHeight });
    };

    const stopResize = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || event.pointerId !== resizeState.pointerId) return;
      resizeStateRef.current = null;
      isResizingRef.current = false;
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.userSelect = '';
    };
  }, []);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: size.width,
      startHeight: size.height,
    };
    isResizingRef.current = true;
    document.body.style.userSelect = 'none';
  };

  const handleSizeToggle = () => {
    setSize(isExpanded ? { width: 320, height: 200 } : { width: 480, height: 320 });
  };

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onDragStart={() => {
        if (isResizingRef.current) {
          dragControls.stop();
        }
      }}
      initial={{ opacity: 0, x: -100, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -100, scale: 0.9 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="relative bg-[#0a0f14]/95 backdrop-blur-md border border-cyan-900/40 rounded-xl overflow-hidden shadow-2xl shadow-cyan-950/30 transition-[width,height] duration-200"
      style={{ width: size.width, height: size.height }}
    >
      {/* 타이틀바 */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-cyan-950/30 border-b border-cyan-900/30 cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => dragControls.start(event)}
      >
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
            onClick={handleSizeToggle}
            className="p-1 hover:bg-cyan-800/30 rounded transition-colors"
          >
            {isExpanded ? (
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
      <button
        type="button"
        aria-label="Resize panel"
        onPointerDown={handleResizeStart}
        className="absolute bottom-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded border border-cyan-800/60 bg-cyan-950/60 text-[8px] leading-none text-cyan-400 hover:bg-cyan-900/50 cursor-se-resize"
      >
        ◢
      </button>
    </motion.div>
  );
}
