import React, { useMemo, useState, useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';
import { GiDrinkMe } from 'react-icons/gi';

// Confirmation dialog for using a consumable. If both HP & Mana regeneration are available, user chooses.
// mode selection passed to parent on confirm.
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

const LEVEL_THRESHOLDS = [1,4,7,10];
const resolveLevelKey = (userLevel) => {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (userLevel >= LEVEL_THRESHOLDS[i]) return String(LEVEL_THRESHOLDS[i]);
  }
  return '1';
};

const ConfirmUseConsumableModal = ({ item, userData, onCancel, onConfirm }) => {
  const [mode, setMode] = useState(null); // 'hp' | 'mana'
  // Removed unused state (rolling/pendingMeta/finalTotal) to satisfy ESLint no-unused-vars.

  // Extract regen dice counts based on Parametri.Special fields for current level logic is handled upstream (we receive full item doc).
  // We must derive potential dice counts by taking non-empty numeric values for the user level already resolved by parent logic when rolling.
  // levelKeys moved to inside useMemo callback so it does not recreate a new array dependency each render
  const regenInfo = useMemo(() => {
    const levelKeys = ['10','7','4','1'];
    const special = item?.Parametri?.Special || {};
    const hpObj = special['Rigenera Dado Anima HP'];
    const manaObj = special['Rigenera Dado Anima Mana'];
    const pickValue = (o) => {
      if (!o || typeof o !== 'object') return 0;
      for (const k of levelKeys) { // prefer highest level first for preview; real value computed inside useConsumable
        const v = o[k];
        if (v != null && String(v).trim() !== '' && !Number.isNaN(Number(v))) {
          return Number(v);
        }
      }
      return 0;
    };
    return {
      hpDice: pickValue(hpObj),
      manaDice: pickValue(manaObj)
    };
  }, [item]);

  const both = regenInfo.hpDice > 0 && regenInfo.manaDice > 0;
  const noRegen = regenInfo.hpDice === 0 && regenInfo.manaDice === 0;
  const singleMode = !both ? (regenInfo.hpDice > 0 ? 'hp' : (regenInfo.manaDice > 0 ? 'mana' : null)) : null;

  // When only one regeneration type exists, preselect automatically.
  useEffect(() => { if (singleMode) setMode(singleMode); }, [singleMode]);

  // Fetch anima die faces once (same logic as useConsumable) for preview.
  const [animaFaces, setAnimaFaces] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'utils', 'varie'));
        if (snap.exists()) {
          const arr = snap.data()?.dadiAnimaByLevel || [];
          const level = Number(userData?.stats?.level || 1);
            const diceTypeStr = arr[level] || arr[arr.length - 1];
            if (diceTypeStr && /^d\d+$/i.test(diceTypeStr)) {
              const parsed = parseInt(diceTypeStr.replace(/^d/i, ''), 10);
              if (!Number.isNaN(parsed) && mounted) setAnimaFaces(parsed);
            } else if (mounted) {
              setAnimaFaces(10);
            }
        } else if (mounted) {
          setAnimaFaces(10);
        }
      } catch {
        if (mounted) setAnimaFaces(10);
      }
    })();
    return () => { mounted = false; };
  }, [userData?.stats?.level]);

  // Compute dice count for selected mode based on actual player level.
  const levelKey = resolveLevelKey(Number(userData?.stats?.level || 1));
  const diceCountForMode = (() => {
    if (!mode) return 0;
    const fld = mode === 'hp' ? 'Rigenera Dado Anima HP' : 'Rigenera Dado Anima Mana';
    const obj = item?.Parametri?.Special?.[fld];
    if (!obj) return 0;
    const raw = obj[levelKey];
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  })();

  // Bonus Creazione multiplier preview.
  const bonusCreazione = (() => {
    const raw = item?.Specific?.['Bonus Creazione'];
    if (raw == null) return 0;
    const cleaned = String(raw).trim().replace(/^\+/,'');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  })();
  const bonusAdd = bonusCreazione * diceCountForMode;

  const formulaText = mode && diceCountForMode && animaFaces
    ? `${diceCountForMode}d${animaFaces}${bonusAdd ? `+${bonusAdd}` : ''}`
    : null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-emerald-600/40 bg-slate-900/95 shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-emerald-200 tracking-wide">Usa Consumabile</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-200" aria-label="chiudi"><FaTimes /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-[13px] text-slate-300 leading-relaxed">
              Stai per usare <span className="font-medium text-emerald-200">{item?.General?.Nome || item?.name || item?.id}</span>.
              {noRegen ? ' Questo utilizzo non rigenera HP o Mana: verrà semplicemente consumato e rimosso dall\'inventario.' : (both ? ' Seleziona cosa rigenerare:' : ' Conferma per procedere.')}          
            </p>
          </div>
          {both && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMode('hp')}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${mode==='hp' ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200' : 'border-slate-600/60 bg-slate-800/60 text-slate-300 hover:border-slate-400/60'}`}
              >HP ({regenInfo.hpDice} dadi)</button>
              <button
                onClick={() => setMode('mana')}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${mode==='mana' ? 'border-indigo-400/70 bg-indigo-500/20 text-indigo-200' : 'border-slate-600/60 bg-slate-800/60 text-slate-300 hover:border-slate-400/60'}`}
              >Mana ({regenInfo.manaDice} dadi)</button>
            </div>
          )}
          {/* Removed obsolete regen summary text per request */}
          {/* Formula preview matching DiceRoller description */}
          {(!noRegen && mode) && (
            <div className="mt-2 text-xs">
              {formulaText ? (
                <div className="inline-flex items-center gap-2 rounded-lg border border-slate-600/60 bg-slate-800/70 px-3 py-2 font-mono text-slate-200">
                  <span>{formulaText}</span>
                  <span className="text-[10px] text-slate-400">{bonusAdd ? `Bonus ${bonusCreazione}x${diceCountForMode}=${bonusAdd}` : 'Nessun bonus'}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-2 text-slate-400">
                  {animaFaces == null ? 'Caricamento formula…' : 'Nessun dado disponibile'}
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 text-sm"
              // Disabled only if no selection; rolling state removed
            >Annulla</button>
            <button
              onClick={() => { onConfirm(noRegen ? null : mode); }}
              disabled={!mode && !noRegen}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-medium shadow ${(!mode && !noRegen) ? 'bg-slate-700/60 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-600 to-green-600 text-white hover:opacity-95'}`}
            ><GiDrinkMe className="w-3 h-3" /> Conferma</button>
          </div>
        </div>
        {/* Rolling overlay removed; dice rolling handled externally */}
      </div>
      {/* DiceRoller is not used directly here; actual rolling handled by parent logic for consistency */}
    </div>
  );
};

export default ConfirmUseConsumableModal;
