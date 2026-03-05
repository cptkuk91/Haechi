'use client';

import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert } from 'lucide-react';

interface IntroScreenProps {
  visible: boolean;
}

export default function IntroScreen({ visible }: IntroScreenProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="intro"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#050505]"
        >
          <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />
          <div className="absolute w-[400px] h-[400px] pointer-events-none flex items-center justify-center opacity-20">
            <div className="absolute w-full h-full border border-cyan-500 rounded-full border-dashed animate-[spin_10s_linear_infinite]" />
            <div className="absolute w-[75%] h-[75%] border-2 border-cyan-500 rounded-full border-t-transparent animate-[spin_7s_linear_infinite_reverse] opacity-50" />
          </div>
          <div className="flex flex-col items-center gap-6 z-10">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'backOut' }}
            >
              <ShieldAlert size={48} className="text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)]" />
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20, letterSpacing: '0.2em' }}
              animate={{ opacity: 1, y: 0, letterSpacing: '0.08em' }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="text-5xl md:text-6xl font-bold text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)] tracking-[0.08em] font-mono"
            >
              SYSTEM INITIALIZING
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              className="text-sm tracking-[0.4em] text-cyan-500/60 uppercase font-mono"
            >
              TENMO 3D MAP KOREA
            </motion.p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="w-64 h-1 bg-cyan-950/50 rounded-full overflow-hidden mt-4"
            >
              <motion.div
                className="h-full bg-cyan-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
