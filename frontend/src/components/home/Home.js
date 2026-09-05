// file: ./frontend/src/components/home/Home.js
import React, { useState, useEffect, useMemo } from "react";
import { useAuth, useAuthSession } from "../../AuthContext";
import StatsBars from "./elements/StatsBars";
import EquippedInventory from "./elements/EquippedInventory";
import Inventory from "./elements/Inventory";
import { MergedStatsTable } from "./elements/paramTables";
import { FaDiceD20 } from "react-icons/fa";
import DiceRoller from "../common/DiceRoller";
import Extra from './elements/Extra';
import { updateProgression } from '../../data/userData/userDataCommands';
import { useProfileContent, useProgression } from '../../data/userData/userDataHooks';
import PerformanceProfiler from '../../performance/PerformanceProfiler';
import HomeReadPlane from './HomeReadPlane';
import { useHomeReadSelector } from './homeReadStore';

const selectDadiAnimaByLevel = (state) => state.config.dadiAnimaByLevel;
const selectHomeConfigStatus = (state) => ({
  error: state.config.error,
  retry: state.config.retry,
  status: state.config.status,
});
const equalHomeConfigStatus = (left, right) => (
  left.error === right.error
  && left.retry === right.retry
  && left.status === right.status
);

const getAnimaField = (userData, key) => {
  const val = userData?.AltriParametri?.[key];
  return (typeof val === 'string' && /[A-Za-z]+/.test(val)) ? val : '';
};

const getAnimaColorClass = (value) => {
  if (value === 'Spirito') return 'text-blue-300';
  if (value === 'Astuzia') return 'text-green-300';
  if (value === 'Potenza') return 'text-red-300';
  return 'text-gray-300';
};

const HomeAnimaSection = ({ onOpenPicker, userData }) => {
  const dadiAnimaByLevel = useHomeReadSelector(selectDadiAnimaByLevel);
  const configStatus = useHomeReadSelector(selectHomeConfigStatus, equalHomeConfigStatus);
  const [rolling, setRolling] = useState(false);
  const [rollingFaces, setRollingFaces] = useState(0);
  const [rollingDescription, setRollingDescription] = useState("");
  const level = userData?.stats?.level;

  const handleRollDice = () => {
    if (!level) return;
    const diceTypeStr = dadiAnimaByLevel[level];
    if (!diceTypeStr) return;
    const faces = parseInt(diceTypeStr.replace(/^d/, ''), 10);
    if (isNaN(faces) || faces <= 0) return;
    setRollingFaces(faces);
    setRollingDescription(`Dado Anima (${diceTypeStr})`);
    setRolling(true);
  };

  return (
    <>
      {configStatus.status === 'loading' && (
        <div role="status" className="text-sm text-slate-400">
          Caricamento configurazione Home…
        </div>
      )}
      {configStatus.status === 'error' && (
        <div role="alert" className="flex items-center gap-3 text-sm text-red-300">
          <span>Impossibile caricare la configurazione Home.</span>
          <button
            type="button"
            onClick={() => configStatus.retry?.()}
            className="rounded-lg border border-red-500/60 px-3 py-1 text-xs hover:bg-red-950/40"
          >
            Riprova
          </button>
        </div>
      )}
      {configStatus.status === 'fresh' && dadiAnimaByLevel.length > 1 && level && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="group relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 flex items-center justify-between shadow-lg">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Dado Anima</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-indigo-300 drop-shadow">{dadiAnimaByLevel[level]}</span>
                <button
                  onClick={handleRollDice}
                  className="relative inline-flex items-center justify-center h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-900/40 hover:scale-105 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  title="Roll Dado Anima"
                >
                  <FaDiceD20 className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl group-hover:opacity-70 opacity-40 transition-opacity" />
          </div>
          <div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg flex flex-col gap-3 xl:col-span-2">
            <p className="text-slate-400 text-xs uppercase tracking-wider">Anima Livelli</p>
            <div className="flex flex-wrap gap-6">
              {['1','4','7'].map(liv => {
                const val = getAnimaField(userData, `Anima_${liv}`);
                const needsPick = (liv === '4' || liv === '7') && !val;
                const currentLevel = level || 1;
                const isExactLevel = Number(liv) === currentLevel;
                return (
                  <div key={liv} className="flex flex-col">
                    <span className="text-xs text-slate-400">Livello {liv}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-semibold tracking-wide ${getAnimaColorClass(val)}`}>{val || '—'}</span>
                      {needsPick && (
                        <button
                          className={`text-[11px] px-2 py-0.5 rounded-md border text-slate-200 transition ${
                            isExactLevel
                              ? 'border-slate-600/60 hover:bg-slate-800/60'
                              : 'border-slate-800/60 opacity-60 cursor-not-allowed'
                          }`}
                          disabled={!isExactLevel}
                          title={isExactLevel ? undefined : `Selezionabile solo al livello ${liv}`}
                          onClick={() => {
                            if (isExactLevel) onOpenPicker(Number(liv));
                          }}
                        >
                          Scegli Anima
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-fuchsia-500/10 rounded-full blur-3xl" />
          </div>
        </div>
      )}
      {rolling && (
        <DiceRoller
          faces={rollingFaces}
          count={1}
          modifier={0}
          description={rollingDescription}
          onComplete={(total) => {
            console.log(`${rollingDescription}: ${total}`);
            setRolling(false);
          }}
        />
      )}
    </>
  );
};

function HomeContent() {
  const { user } = useAuth();
  const {
    data: progression,
    status: progressionStatus,
  } = useProgression(user?.uid);
  const { data: profileContent } = useProfileContent(user?.uid);
  const userData = useMemo(() => ({
    ...(progression || {}),
    ...(profileContent || {}),
    stats: { ...(progression?.stats || {}) },
  }), [profileContent, progression]);
  const progressionCommandsReady = progressionStatus === 'fresh'
    && progression !== null;
  // Anima selection overlay
  const [animaPickerOpen, setAnimaPickerOpen] = useState(false);
  const [animaPickerLevel, setAnimaPickerLevel] = useState(null); // 4 or 7

  // Prompt to select Anima shard when reaching level 4 or 7 and field is empty
  useEffect(() => {
    const lvl = userData?.stats?.level || 1;
    const a4 = getAnimaField(userData, 'Anima_4');
    const a7 = getAnimaField(userData, 'Anima_7');
    if (lvl >= 7 && !a7) {
      setAnimaPickerLevel(7);
      setAnimaPickerOpen(true);
    } else if (lvl >= 4 && !a4) {
      setAnimaPickerLevel(4);
      setAnimaPickerOpen(true);
    } else {
      setAnimaPickerOpen(false);
      setAnimaPickerLevel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.stats?.level, userData?.AltriParametri?.Anima_4, userData?.AltriParametri?.Anima_7]);

  if (!user) {
    return <p>Loading...</p>;
  }

  return (
  <div className="relative w-full min-h-screen overflow-x-hidden">
      {/* Background is provided by Layout's GlobalAuroraBackground */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_60%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.04),transparent_65%)] mix-blend-overlay" />

      <div className="relative z-10 flex flex-col">
        <main className="flex flex-col p-6 w-full gap-6">
          <HomeAnimaSection
            userData={userData}
            onOpenPicker={(level) => {
              setAnimaPickerLevel(level);
              setAnimaPickerOpen(true);
            }}
          />

          {/* Core Content Grid */}
          <div className="grid gap-6 xl:grid-cols-12 items-stretch">
            <div className="xl:col-span-8 space-y-6">
              {/* Tables & Bars */}
              <div className="grid gap-6 lg:grid-cols-2 items-stretch">
                <div className="relative h-full">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-transparent to-fuchsia-500/10 pointer-events-none" />
                  <PerformanceProfiler id="ParamTables" committedProbeOwner="child">
                    <MergedStatsTable />
                  </PerformanceProfiler>
                </div>
                <div className="relative flex flex-col gap-6 h-full">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/10 pointer-events-none" />
                  <PerformanceProfiler id="StatsBars" committedProbeOwner="child">
                    <StatsBars />
                  </PerformanceProfiler>
                  <div className="flex-1 min-h-0">
                    <PerformanceProfiler id="EquippedInventory" committedProbeOwner="child">
                      <EquippedInventory />
                    </PerformanceProfiler>
                  </div>
                </div>
              </div>
            </div>
            <div className="xl:col-span-4 h-full min-h-0">
              <PerformanceProfiler id="Inventory" committedProbeOwner="child">
                <Inventory />
              </PerformanceProfiler>
            </div>
          </div>

          {/* Bottom horizontal extra (Lingue, Conoscenze, Professioni) */}
          <div className="mt-2">
            <PerformanceProfiler id="Extra" committedProbeOwner="child">
              <Extra
                variant="columns"
                lingue={userData?.lingue}
                conoscenze={userData?.conoscenze}
                professioni={userData?.professioni}
              />
            </PerformanceProfiler>
          </div>
        </main>
      </div>
      {animaPickerOpen && animaPickerLevel && progressionCommandsReady && (
        <AnimaPickerOverlay
          level={animaPickerLevel}
          onClose={() => setAnimaPickerOpen(false)}
          onSelect={async (choice) => {
            try {
              if (!user || !progressionCommandsReady) return;
              const key = animaPickerLevel === 7 ? 'Anima_7' : 'Anima_4';
              const patch = { AltriParametri: { [key]: choice } };
              await updateProgression({ patch });
            } catch (e) {
              console.error('Failed to save anima choice', e);
            } finally {
              setAnimaPickerOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}

function Home() {
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  if (!user) return <p>Loading...</p>;
  return (
    <HomeReadPlane
      uid={user.uid}
      repositoryAccessGeneration={repositoryAccessGeneration}
    >
      <HomeContent />
    </HomeReadPlane>
  );
}

export default Home;

// Minimal overlay to choose Anima shard at level 4/7
function AnimaPickerOverlay({ level, onClose, onSelect }) {
  const options = ['Potenza', 'Astuzia', 'Spirito'];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 max-w-md w-[92vw] rounded-2xl border border-slate-700/60 bg-slate-900/90 p-5 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-100">Seleziona un nuovo Frammento d'Anima</h3>
        <p className="mt-1 text-slate-300 text-sm">Hai raggiunto il livello {level}. Scegli il tuo Anima per questo traguardo.</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => onSelect && onSelect(opt)}
              className={`px-3 py-2 rounded-md text-sm font-medium border border-slate-600/60 hover:border-slate-500 transition ${
                opt === 'Spirito' ? 'text-blue-300' : opt === 'Astuzia' ? 'text-green-300' : 'text-red-300'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="text-xs text-slate-300 border border-slate-600/60 rounded px-3 py-1.5 hover:bg-slate-800/60">Annulla</button>
        </div>
      </div>
    </div>
  );
}

