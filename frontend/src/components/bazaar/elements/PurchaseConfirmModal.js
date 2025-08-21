// file: ./frontend/src/components/bazaar/elements/PurchaseConfirmModal.js
import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Purchase confirmation modal.
 * Props:
 *  - item: item object (expects General.Nome, General.prezzo, General.image_url)
 *  - userGold: number
 *  - onConfirm(): called when confirmed
 *  - onClose(): close without action
 *  - isProcessing: boolean shows loading state
 */
export default function PurchaseConfirmModal({ item, userGold, onConfirm, onClose, isProcessing }) {
  const name = item?.General?.Nome || 'Oggetto';
  const price = typeof item?.General?.prezzo === 'number' ? item.General.prezzo : parseInt(item?.General?.prezzo, 10) || 0;
  const affordable = userGold >= price;
  const imageUrl = item?.General?.image_url;

  const handleKey = useCallback((e) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => { document.addEventListener('keydown', handleKey); return () => document.removeEventListener('keydown', handleKey); }, [handleKey]);

  return (
    <AnimatePresence>
      {item && (
        <motion.div className="fixed inset-0 z-[12000] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="relative w-full max-w-md mx-4 rounded-2xl overflow-hidden shadow-2xl border border-slate-600/60 bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95"
            initial={{ scale: 0.85, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 210, damping: 20 }}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-400" />
            <div className="p-5 flex gap-4">
              <div className="flex-shrink-0">
                <div className="relative w-20 h-20 rounded-xl border border-slate-600/60 bg-slate-700/40 overflow-hidden flex items-center justify-center text-slate-400 text-xs">
                  {imageUrl ? <img src={imageUrl} alt={name} className="w-full h-full object-cover" /> : <span>{name.charAt(0)}</span>}
                  <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-white/5" />
                </div>
              </div>
              <div className="flex-grow flex flex-col">
                <h3 className="text-lg font-semibold tracking-wide text-slate-100 mb-1 line-clamp-2">{name}</h3>
                <p className="text-sm text-slate-400 mb-4">Confermi l'acquisto di questo oggetto?</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-800/60 border border-slate-600/50 p-2 flex flex-col">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">Prezzo</span>
                    <span className="text-amber-300 font-medium text-sm">{price}</span>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 border border-slate-600/50 p-2 flex flex-col">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">Oro Disponibile</span>
                    <span className={`font-medium text-sm ${affordable ? 'text-emerald-300' : 'text-rose-400'}`}>{userGold}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 flex items-center justify-end gap-3">
              <button onClick={onClose} disabled={isProcessing} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-700/60 hover:bg-slate-600/70 text-slate-200 border border-slate-600/60 transition disabled:opacity-50">Annulla</button>
              <button onClick={() => affordable && !isProcessing && onConfirm()} disabled={!affordable || isProcessing} className={`px-5 py-2 rounded-lg text-sm font-semibold border transition shadow ${!affordable ? 'bg-slate-600/50 text-slate-400 border-slate-600 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-400 text-white hover:brightness-110 border-indigo-400/40'} ${isProcessing ? 'opacity-70 cursor-wait' : ''}`}>{isProcessing ? 'Acquisto...' : 'Conferma'}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
