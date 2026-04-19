import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FiCheck, FiChevronDown, FiEdit2, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { FOE_LIBRARY_DRAG_TYPE, TRAY_DRAG_MIME } from './constants';

const buildTokenDragPayload = (token) => JSON.stringify({
  type: 'grigliata-token',
  tokenId: token?.tokenId || token?.id || '',
  ownerUid: token?.ownerUid || '',
  uid: token?.ownerUid || '',
});

const buildFoeLibraryDragPayload = (foe, ownerUid) => JSON.stringify({
  type: FOE_LIBRARY_DRAG_TYPE,
  foeId: foe?.id || '',
  ownerUid,
  uid: ownerUid,
});

const getTraySummaryText = (hasActiveMap) => (
  hasActiveMap
    ? 'Drag and drop tokens onto the active map to place or reposition them.'
    : 'Select an active map to place or reposition tokens.'
);

const getTokenStatusLabel = (token, activeMapName, hasActiveMap) => {
  if (!hasActiveMap) return 'Select a map to place this token';
  if (token?.isHiddenByManager) {
    return activeMapName ? `Hidden on ${activeMapName} by the DM` : 'Hidden on the active map by the DM';
  }
  if (token?.placed) {
    return activeMapName ? `Placed in ${activeMapName}` : 'Placed on the active map';
  }
  return 'Not placed';
};

const getTokenHelpText = (token, hasActiveMap) => {
  if (token?.isHiddenByManager) {
    return 'The DM is currently hiding or controlling this token on the active map. It will be draggable again once it is shown.';
  }
  if (!hasActiveMap) {
    return 'Select a map first. Token positions are saved independently for each map.';
  }
  if (!token?.imageUrl) {
    return token?.tokenType === 'character'
      ? 'Upload a profile image from the navbar first. Without it, your main character token stays disabled.'
      : 'Upload an image for this custom token before dragging it onto the map.';
  }
  return '';
};

const n = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const PARAM_GROUPS = ['Base', 'Combattimento', 'Special'];
const FOE_LIBRARY_COLLAPSE_EASE = [0.22, 1, 0.36, 1];
const FOE_LIBRARY_CONTENT_ID = 'grigliata-foe-library-content';

const getFoeLibraryCollapsedStorageKey = (currentUserId = '') => `grigliata.foeLibraryCollapsed.${currentUserId || 'anonymous'}`;

const readStoredFoeLibraryCollapsed = (currentUserId = '') => {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(getFoeLibraryCollapsedStorageKey(currentUserId)) === 'true';
  } catch (_) {
    return false;
  }
};

const writeStoredFoeLibraryCollapsed = (currentUserId = '', isCollapsed) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getFoeLibraryCollapsedStorageKey(currentUserId), String(isCollapsed));
  } catch (_) {}
};

const buildFoeParamSections = (parametri = {}) => PARAM_GROUPS.map((groupKey) => {
  const entries = Object.entries(parametri?.[groupKey] || {}).sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? { groupKey, entries } : null;
}).filter(Boolean);

const buildCollapsedFoeParamGroups = (sections = []) => sections.reduce((nextState, { groupKey }) => {
  nextState[groupKey] = true;
  return nextState;
}, {});

const getFoeParamSectionContentId = (groupKey) => `selected-foe-parametri-${groupKey.toLowerCase()}-content`;

const getSelectedTokenPanelTitle = (tokenType) => {
  if (tokenType === 'foe') return 'Selected Foe';
  if (tokenType === 'custom') return 'Selected Custom Token';
  return 'Selected Character';
};

const getSelectedTokenBadgeLabel = (tokenType) => {
  if (tokenType === 'foe') return 'Instance';
  if (tokenType === 'custom') return 'Custom';
  return 'Character';
};
const EMPTY_SELECTED_TOKEN_DRAFT = {
  hpCurrent: 0,
  manaCurrent: 0,
  shieldCurrent: 0,
  notes: '',
};
const EMPTY_SELECTED_TOKEN_DIRTY_STATE = {
  hpCurrent: false,
  manaCurrent: false,
  shieldCurrent: false,
  notes: false,
};
const buildSelectedTokenDraft = (token) => ({
  hpCurrent: n(token?.hpCurrent, 0),
  manaCurrent: n(token?.manaCurrent, 0),
  shieldCurrent: n(token?.shieldCurrent, 0),
  notes: token?.notes || '',
});
const areSelectedTokenDraftsEqual = (left, right) => (
  left.hpCurrent === right.hpCurrent
  && left.manaCurrent === right.manaCurrent
  && left.shieldCurrent === right.shieldCurrent
  && left.notes === right.notes
);
const areSelectedTokenDirtyStatesEqual = (left, right) => (
  left.hpCurrent === right.hpCurrent
  && left.manaCurrent === right.manaCurrent
  && left.shieldCurrent === right.shieldCurrent
  && left.notes === right.notes
);
const mergeSelectedTokenDraft = ({ currentDraft, persistedDraft, dirtyFields }) => ({
  hpCurrent: dirtyFields.hpCurrent ? currentDraft.hpCurrent : persistedDraft.hpCurrent,
  manaCurrent: dirtyFields.manaCurrent ? currentDraft.manaCurrent : persistedDraft.manaCurrent,
  shieldCurrent: dirtyFields.shieldCurrent ? currentDraft.shieldCurrent : persistedDraft.shieldCurrent,
  notes: dirtyFields.notes ? currentDraft.notes : persistedDraft.notes,
});
const syncSelectedTokenDirtyFields = ({ dirtyFields, draft, persistedDraft }) => ({
  hpCurrent: dirtyFields.hpCurrent && draft.hpCurrent !== persistedDraft.hpCurrent,
  manaCurrent: dirtyFields.manaCurrent && draft.manaCurrent !== persistedDraft.manaCurrent,
  shieldCurrent: dirtyFields.shieldCurrent && draft.shieldCurrent !== persistedDraft.shieldCurrent,
  notes: dirtyFields.notes && draft.notes !== persistedDraft.notes,
});
const getSelectedTokenLoadingMessage = (token) => (
  token?.loadingMessage
  || (token?.tokenType === 'custom'
    ? 'Loading the current token values...'
    : 'Loading the current character sheet values...')
);
const getSelectedTokenTotalText = (label, totalValue, isMissing) => (
  isMissing
    ? `${label}: will use current value on save`
    : `${label}: ${n(totalValue, 0)}`
);

function FoeLibrarySection({ currentUserId, foeLibrary = [], hasActiveMap, onDragStart, onDragEnd }) {
  const [query, setQuery] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(() => readStoredFoeLibraryCollapsed(currentUserId));
  const skipPersistCollapsedStateRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const filteredFoes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foeLibrary;
    return foeLibrary.filter((foe) => (
      (foe?.name || '').toLowerCase().includes(q)
      || (foe?.category || '').toLowerCase().includes(q)
      || (foe?.rank || '').toLowerCase().includes(q)
    ));
  }, [foeLibrary, query]);

  useEffect(() => {
    skipPersistCollapsedStateRef.current = true;
    setIsCollapsed(readStoredFoeLibraryCollapsed(currentUserId));
  }, [currentUserId]);

  useEffect(() => {
    if (skipPersistCollapsedStateRef.current) {
      skipPersistCollapsedStateRef.current = false;
      return;
    }

    writeStoredFoeLibraryCollapsed(currentUserId, isCollapsed);
  }, [currentUserId, isCollapsed]);

  const handleDragStart = (event, foe) => {
    if (!hasActiveMap || !currentUserId || !foe?.id) {
      event.preventDefault();
      return;
    }
    const payload = buildFoeLibraryDragPayload(foe, currentUserId);
    event.dataTransfer.setData(TRAY_DRAG_MIME, payload);
    event.dataTransfer.setData('text/plain', payload);
    event.dataTransfer.effectAllowed = 'copy';
    onDragStart?.({
      type: FOE_LIBRARY_DRAG_TYPE,
      foeId: foe.id,
      ownerUid: currentUserId,
    });
  };

  const toggleLabel = isCollapsed ? 'Expand Foes Hub' : 'Collapse Foes Hub';
  const contentTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.28, ease: FOE_LIBRARY_COLLAPSE_EASE };

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-violet-950/10 p-4">
      <div className="relative">
        <button
          type="button"
          data-testid="foe-library-toggle"
          aria-expanded={!isCollapsed}
          aria-controls={FOE_LIBRARY_CONTENT_ID}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setIsCollapsed((value) => !value)}
          className="absolute right-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-violet-300/25 bg-slate-950/80 text-violet-100 shadow-sm transition-colors hover:border-violet-200/50 hover:bg-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        >
          <FiChevronDown className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? 'rotate-0' : 'rotate-180'}`} />
        </button>

        <div className="flex items-start justify-between gap-3 pr-12">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-violet-100">Foes Hub</h3>
            <p className="mt-1 text-xs text-slate-300">
              {hasActiveMap ? 'Drag a foe onto the map to spawn a fresh instance.' : 'Select an active map before spawning foes.'}
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="foe-library-content"
            id={FOE_LIBRARY_CONTENT_ID}
            data-testid="foe-library-content"
            className="overflow-hidden"
            initial={prefersReducedMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={contentTransition}
          >
            <div className="space-y-4 pt-4">
              <div>
                <label htmlFor="grigliata-foe-search" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Search Foes
                </label>
                <input
                  id="grigliata-foe-search"
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, category, or rank"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-300"
                />
              </div>

              <div className="space-y-3">
                {!filteredFoes.length && (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 px-4 py-5 text-center text-sm text-slate-400">
                    {foeLibrary.length ? 'No foes match that search.' : 'Create foes in the Foes Hub to use them here.'}
                  </div>
                )}
                {filteredFoes.map((foe) => {
                  const canDrag = !!(hasActiveMap && currentUserId && foe?.id);
                  const hpTotal = n(foe?.stats?.hpTotal, 0);
                  const manaTotal = n(foe?.stats?.manaTotal, 0);

                  return (
                    <div
                      key={foe.id}
                      data-testid={`foe-library-card-${foe.id}`}
                      draggable={canDrag}
                      onDragStart={(event) => handleDragStart(event, foe)}
                      onDragEnd={() => onDragEnd?.(foe)}
                      className={`rounded-2xl border p-4 ${canDrag ? 'cursor-grab border-violet-300/35 bg-slate-900/80 hover:border-violet-200/60 active:cursor-grabbing' : 'cursor-not-allowed border-slate-700 bg-slate-900/60 opacity-75'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-lg font-semibold text-slate-100">
                          {foe?.imageUrl ? <img src={foe.imageUrl} alt={foe?.name || 'Foe'} className="h-full w-full object-cover" /> : <span>{(foe?.name || '?').charAt(0).toUpperCase()}</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-base font-semibold text-slate-100">{foe?.name || 'Unnamed Foe'}</p>
                            <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-100">Foe</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-400">Lv {n(foe?.stats?.level, 1)} | {foe?.category || 'Unknown'} | {foe?.rank || 'Unranked'}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1">HP {n(foe?.stats?.hpCurrent, hpTotal)}/{hpTotal}</span>
                            <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-1">Mana {n(foe?.stats?.manaCurrent, manaTotal)}/{manaTotal}</span>
                            {foe?.dadoAnima && <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-1">Anima {foe.dadoAnima}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SelectedResourceTokenDetailsPanel({
  token,
  onSaveSelectedTokenDetails,
  savingSelectedTokenDetailsId,
}) {
  const [draft, setDraft] = useState(EMPTY_SELECTED_TOKEN_DRAFT);
  const [dirtyFields, setDirtyFields] = useState(EMPTY_SELECTED_TOKEN_DIRTY_STATE);
  const previousTokenIdRef = useRef('');
  const persistedDraft = useMemo(() => buildSelectedTokenDraft(token), [
    token?.tokenId,
    token?.hpCurrent,
    token?.manaCurrent,
    token?.shieldCurrent,
    token?.notes,
  ]);

  useEffect(() => {
    const nextTokenId = token?.tokenId || '';

    if (!nextTokenId) {
      previousTokenIdRef.current = '';
      setDraft((currentDraft) => (
        areSelectedTokenDraftsEqual(currentDraft, EMPTY_SELECTED_TOKEN_DRAFT)
          ? currentDraft
          : EMPTY_SELECTED_TOKEN_DRAFT
      ));
      setDirtyFields((currentDirtyFields) => (
        areSelectedTokenDirtyStatesEqual(currentDirtyFields, EMPTY_SELECTED_TOKEN_DIRTY_STATE)
          ? currentDirtyFields
          : EMPTY_SELECTED_TOKEN_DIRTY_STATE
      ));
      return;
    }

    if (previousTokenIdRef.current !== nextTokenId) {
      previousTokenIdRef.current = nextTokenId;
      setDraft((currentDraft) => (
        areSelectedTokenDraftsEqual(currentDraft, persistedDraft)
          ? currentDraft
          : persistedDraft
      ));
      setDirtyFields((currentDirtyFields) => (
        areSelectedTokenDirtyStatesEqual(currentDirtyFields, EMPTY_SELECTED_TOKEN_DIRTY_STATE)
          ? currentDirtyFields
          : EMPTY_SELECTED_TOKEN_DIRTY_STATE
      ));
      return;
    }

    setDraft((currentDraft) => {
      const nextDraft = mergeSelectedTokenDraft({
        currentDraft,
        persistedDraft,
        dirtyFields,
      });

      return areSelectedTokenDraftsEqual(currentDraft, nextDraft)
        ? currentDraft
        : nextDraft;
    });
  }, [dirtyFields, persistedDraft, token?.tokenId]);

  useEffect(() => {
    if (!token?.tokenId) {
      return;
    }

    setDirtyFields((currentDirtyFields) => {
      const nextDirtyFields = syncSelectedTokenDirtyFields({
        dirtyFields: currentDirtyFields,
        draft,
        persistedDraft,
      });

      return areSelectedTokenDirtyStatesEqual(currentDirtyFields, nextDirtyFields)
        ? currentDirtyFields
        : nextDirtyFields;
    });
  }, [draft, persistedDraft, token?.tokenId]);

  if (!token) return null;

  const isSaving = savingSelectedTokenDetailsId === token.tokenId;
  const isReady = token.isReady !== false;
  const isBusy = isSaving || !isReady;
  const panelTitle = getSelectedTokenPanelTitle(token.tokenType);
  const badgeLabel = getSelectedTokenBadgeLabel(token.tokenType);
  const missingResourceTotals = token.missingResourceTotals || {};
  const isLegacyCustomToken = token.tokenType === 'custom'
    && (missingResourceTotals.hpTotal || missingResourceTotals.manaTotal || missingResourceTotals.shieldTotal);

  const updateDraftField = (field, value) => {
    setDraft((currentDraft) => (
      currentDraft[field] === value
        ? currentDraft
        : { ...currentDraft, [field]: value }
    ));
    setDirtyFields((currentDirtyFields) => (
      currentDirtyFields[field]
        ? currentDirtyFields
        : { ...currentDirtyFields, [field]: true }
    ));
  };

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-lg font-semibold text-slate-100">
          {token?.imageUrl ? <img src={token.imageUrl} alt={token?.label || 'Token'} className="h-full w-full object-cover" /> : <span>{(token?.label || '?').charAt(0).toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-100">{panelTitle}</h3>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100">{badgeLabel}</span>
          </div>
          <p className="mt-1 truncate text-lg font-semibold text-slate-100">{token?.label || 'Token'}</p>
          <p className="mt-1 truncate text-xs text-slate-400">
            {token.tokenType === 'custom' ? 'Update the live token values used on the board.' : 'Linked to the character sheet values for this player.'}
          </p>
        </div>
      </div>

      <div className={`mt-4 grid grid-cols-1 gap-3 ${token.hasShield ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        <div>
          <label htmlFor={`selected-token-hp-${token.tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current HP</label>
          <input
            id={`selected-token-hp-${token.tokenId}`}
            type="number"
            value={draft.hpCurrent}
            onChange={(event) => updateDraftField('hpCurrent', n(event.target.value, 0))}
            disabled={isBusy}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300"
          />
          <p className="mt-1 text-[11px] text-slate-500">{getSelectedTokenTotalText('Total HP', token.hpTotal, missingResourceTotals.hpTotal)}</p>
        </div>
        <div>
          <label htmlFor={`selected-token-mana-${token.tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Mana</label>
          <input
            id={`selected-token-mana-${token.tokenId}`}
            type="number"
            value={draft.manaCurrent}
            onChange={(event) => updateDraftField('manaCurrent', n(event.target.value, 0))}
            disabled={isBusy}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300"
          />
          <p className="mt-1 text-[11px] text-slate-500">{getSelectedTokenTotalText('Total Mana', token.manaTotal, missingResourceTotals.manaTotal)}</p>
        </div>
        {token.hasShield && (
          <div>
            <label htmlFor={`selected-token-shield-${token.tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Shield</label>
            <input
              id={`selected-token-shield-${token.tokenId}`}
              type="number"
              value={draft.shieldCurrent}
              onChange={(event) => updateDraftField('shieldCurrent', n(event.target.value, 0))}
              disabled={isBusy}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300"
            />
            <p className="mt-1 text-[11px] text-slate-500">{getSelectedTokenTotalText('Total Shield', token.shieldTotal, missingResourceTotals.shieldTotal)}</p>
          </div>
        )}
      </div>

      {!isReady && (
        <div className="mt-4 rounded-2xl border border-dashed border-emerald-300/35 bg-slate-950/60 px-3 py-3 text-sm text-emerald-100">
          {getSelectedTokenLoadingMessage(token)}
        </div>
      )}

      {isReady && isLegacyCustomToken && (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
          This legacy custom token is missing one or more saved totals. Saving will seed each missing total from the current value.
        </div>
      )}

      <div className="mt-4">
        <label htmlFor={`selected-token-notes-${token.tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</label>
        <textarea
          id={`selected-token-notes-${token.tokenId}`}
          rows={4}
          value={draft.notes}
          onChange={(event) => updateDraftField('notes', event.target.value)}
          placeholder="Add token notes"
          disabled={isBusy}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-300"
        />
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => onSaveSelectedTokenDetails?.({
            tokenId: token.tokenId,
            tokenType: token.tokenType,
            ownerUid: token.ownerUid,
            characterId: token.characterId || '',
            label: token.label || '',
            imageUrl: token.imageUrl || '',
            imagePath: token.imagePath || '',
            hpCurrent: draft.hpCurrent,
            hpTotal: n(token.hpTotal, 0),
            manaCurrent: draft.manaCurrent,
            manaTotal: n(token.manaTotal, 0),
            shieldCurrent: draft.shieldCurrent,
            shieldTotal: n(token.shieldTotal, 0),
            notes: draft.notes,
          })}
          disabled={isBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/45 bg-emerald-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <FiCheck className="h-4 w-4" />
          {isSaving ? 'Saving' : (isReady ? 'Save Details' : 'Loading')}
        </button>
      </div>
    </div>
  );
}

function SelectedFoeDetailsPanel({ token, onUpdateFoeToken, savingFoeTokenId }) {
  const [label, setLabel] = useState('');
  const [dadoAnima, setDadoAnima] = useState('');
  const [stats, setStats] = useState({});
  const [parametri, setParametri] = useState({});
  const [notes, setNotes] = useState('');
  const [collapsedParamGroups, setCollapsedParamGroups] = useState({});
  const previousTokenIdRef = useRef('');
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!token) return;
    setLabel(token.label || '');
    setDadoAnima(token.dadoAnima || '');
    setStats(token.stats || {});
    setParametri(token.Parametri || {});
    setNotes(token.notes || '');
  }, [token]);

  const sections = useMemo(() => buildFoeParamSections(parametri), [parametri]);

  useEffect(() => {
    const nextTokenId = token?.tokenId || '';

    if (!nextTokenId) {
      previousTokenIdRef.current = '';
      setCollapsedParamGroups({});
      return;
    }

    if (previousTokenIdRef.current !== nextTokenId) {
      previousTokenIdRef.current = nextTokenId;
      setCollapsedParamGroups(buildCollapsedFoeParamGroups(sections));
      return;
    }

    setCollapsedParamGroups((current) => {
      const nextState = {};
      sections.forEach(({ groupKey }) => {
        nextState[groupKey] = Object.prototype.hasOwnProperty.call(current, groupKey)
          ? current[groupKey]
          : true;
      });

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextState);
      if (
        currentKeys.length === nextKeys.length
        && nextKeys.every((groupKey) => current[groupKey] === nextState[groupKey])
      ) {
        return current;
      }

      return nextState;
    });
  }, [sections, token?.tokenId]);

  if (!token) return null;

  const hpTotal = n(stats?.hpTotal, 0);
  const manaTotal = n(stats?.manaTotal, 0);
  const isSaving = savingFoeTokenId === token.tokenId;
  const contentTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.28, ease: FOE_LIBRARY_COLLAPSE_EASE };

  return (
    <div className="rounded-2xl border border-cyan-500/25 bg-cyan-950/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-lg font-semibold text-slate-100">
          {token?.imageUrl ? <img src={token.imageUrl} alt={token?.label || 'Foe'} className="h-full w-full object-cover" /> : <span>{(token?.label || '?').charAt(0).toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-100">Selected Foe</h3>
            <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Instance</span>
          </div>
          <p className="mt-1 truncate text-lg font-semibold text-slate-100">{token?.label || 'Foe Token'}</p>
          <p className="mt-1 truncate text-xs text-slate-400">Lv {n(stats?.level, 1)} | {token?.category || 'Unknown'} | {token?.rank || 'Unranked'}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="selected-foe-label" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Foe Name</label>
          <input id="selected-foe-label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300" />
        </div>
        <div>
          <label htmlFor="selected-foe-anima" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Dado Anima</label>
          <input id="selected-foe-anima" type="text" value={dadoAnima} onChange={(event) => setDadoAnima(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300" />
        </div>
        <div>
          <label htmlFor="selected-foe-hp-current" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current HP</label>
          <input id="selected-foe-hp-current" type="number" value={n(stats?.hpCurrent, hpTotal)} onChange={(event) => setStats((current) => ({ ...current, hpCurrent: n(event.target.value, 0) }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300" />
          <p className="mt-1 text-[11px] text-slate-500">Total HP: {hpTotal}</p>
        </div>
        <div>
          <label htmlFor="selected-foe-mana-current" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Mana</label>
          <input id="selected-foe-mana-current" type="number" value={n(stats?.manaCurrent, manaTotal)} onChange={(event) => setStats((current) => ({ ...current, manaCurrent: n(event.target.value, 0) }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300" />
          <p className="mt-1 text-[11px] text-slate-500">Total Mana: {manaTotal}</p>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor={`selected-foe-notes-${token.tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</label>
        <textarea
          id={`selected-foe-notes-${token.tokenId}`}
          rows={4}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional foe notes"
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300"
        />
      </div>

      {sections.length > 0 && (
        <div className="mt-4 space-y-3">
          {sections.map(({ groupKey, entries }) => {
            const isCollapsed = collapsedParamGroups[groupKey] !== false;
            const contentId = getFoeParamSectionContentId(groupKey);
            const toggleLabel = `${isCollapsed ? 'Expand' : 'Collapse'} ${groupKey} parameters`;

            return (
              <div key={groupKey} className="rounded-2xl border border-slate-800 bg-slate-950/65 p-3">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  aria-controls={contentId}
                  aria-label={toggleLabel}
                  title={toggleLabel}
                  onClick={() => setCollapsedParamGroups((current) => ({
                    ...current,
                    [groupKey]: current[groupKey] === false,
                  }))}
                  className="flex w-full items-center justify-between gap-3 rounded-xl text-left transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{groupKey}</h4>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-300">
                    <FiChevronDown className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? 'rotate-0' : 'rotate-180'}`} />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      key={contentId}
                      id={contentId}
                      data-testid={contentId}
                      className="overflow-hidden"
                      initial={prefersReducedMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={contentTransition}
                    >
                      <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">
                        {entries.map(([paramKey, paramValue]) => (
                          <div key={`${groupKey}-${paramKey}`}>
                            <label htmlFor={`selected-foe-${groupKey}-${paramKey}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{paramKey}</label>
                            <input
                              id={`selected-foe-${groupKey}-${paramKey}`}
                              type="number"
                              value={n(paramValue?.Tot, 0)}
                              onChange={(event) => setParametri((current) => ({
                                ...current,
                                [groupKey]: {
                                  ...(current?.[groupKey] || {}),
                                  [paramKey]: { ...((current?.[groupKey] || {})[paramKey] || {}), Tot: n(event.target.value, 0) },
                                },
                              }))}
                              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                            />
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {['tecniche', 'spells'].map((sectionKey) => {
        const entries = Array.isArray(token?.[sectionKey]) ? token[sectionKey] : [];
        if (!entries.length) return null;
        const title = sectionKey === 'tecniche' ? 'Tecniche' : 'Spells';
        const sectionClassName = sectionKey === 'tecniche'
          ? 'mt-4 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3'
          : 'mt-4 rounded-2xl border border-sky-500/20 bg-sky-950/10 p-3';
        const headingClassName = sectionKey === 'tecniche'
          ? 'text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-100'
          : 'text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100';
        const effectsClassName = sectionKey === 'tecniche'
          ? 'mt-1 text-xs text-fuchsia-200'
          : 'mt-1 text-xs text-sky-200';
        return (
          <div key={sectionKey} className={sectionClassName}>
            <h4 className={headingClassName}>{title}</h4>
            <div className="mt-3 space-y-3">
              {entries.map((entry, index) => (
                <div key={`${sectionKey}-${entry?.name || index}`} className="rounded-2xl border border-slate-800 bg-slate-950/65 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-800 text-xs text-slate-400">
                      {entry?.imageUrl ? <img src={entry.imageUrl} alt={entry?.name || title} className="h-full w-full object-cover" /> : 'No Img'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-100">{entry?.name || `${title} ${index + 1}`}</p>
                      {entry?.danni && <p className="mt-1 text-xs text-rose-200">Danni: {entry.danni}</p>}
                      {entry?.effetti && <p className={effectsClassName}>Effetti: {entry.effetti}</p>}
                      {entry?.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{entry.description}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => onUpdateFoeToken?.({ tokenId: token.tokenId, label, dadoAnima, stats, Parametri: parametri, notes })}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/45 bg-cyan-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <FiCheck className="h-4 w-4" />
          {isSaving ? 'Saving' : 'Save Foe'}
        </button>
      </div>
    </div>
  );
}

export default function MyTokenTray({
  currentUserId = '',
  isManager = false,
  currentUserToken,
  customTokens = [],
  foeLibrary = [],
  selectedTokenDetails = null,
  activeMapName,
  hasActiveMap = false,
  onDragStart,
  onDragEnd,
  onCreateCustomToken,
  isCreatingCustomToken = false,
  onUpdateCustomToken,
  updatingCustomTokenId = '',
  onDeleteCustomToken,
  deletingCustomTokenId = '',
  onSaveSelectedTokenDetails,
  savingSelectedTokenDetailsId = '',
  onUpdateFoeToken,
  savingFoeTokenId = '',
}) {
  const [createLabel, setCreateLabel] = useState('');
  const [createImageFile, setCreateImageFile] = useState(null);
  const [createHpCurrent, setCreateHpCurrent] = useState(0);
  const [createManaCurrent, setCreateManaCurrent] = useState(0);
  const [createShieldCurrent, setCreateShieldCurrent] = useState(0);
  const [createNotes, setCreateNotes] = useState('');
  const [createImageInputKey, setCreateImageInputKey] = useState(0);
  const [editingTokenId, setEditingTokenId] = useState('');
  const [editingLabel, setEditingLabel] = useState('');
  const [editingImageFile, setEditingImageFile] = useState(null);
  const [editImageInputKey, setEditImageInputKey] = useState(0);

  const trayTokens = useMemo(() => [currentUserToken, ...customTokens].filter(Boolean), [currentUserToken, customTokens]);

  const resetCreateForm = () => {
    setCreateLabel('');
    setCreateImageFile(null);
    setCreateHpCurrent(0);
    setCreateManaCurrent(0);
    setCreateShieldCurrent(0);
    setCreateNotes('');
    setCreateImageInputKey((key) => key + 1);
  };

  const resetEditForm = () => {
    setEditingTokenId('');
    setEditingLabel('');
    setEditingImageFile(null);
    setEditImageInputKey((key) => key + 1);
  };

  const handleTokenDragStart = (event, token) => {
    const tokenId = token?.tokenId || token?.id || '';
    const ownerUid = token?.ownerUid || '';
    const canDrag = !!(hasActiveMap && token?.imageUrl && tokenId && ownerUid && !token?.isHiddenByManager && editingTokenId !== tokenId);
    if (!canDrag) {
      event.preventDefault();
      return;
    }
    const payload = buildTokenDragPayload(token);
    event.dataTransfer.setData(TRAY_DRAG_MIME, payload);
    event.dataTransfer.setData('text/plain', payload);
    event.dataTransfer.effectAllowed = 'copyMove';
    onDragStart?.({
      type: 'grigliata-token',
      tokenId,
      ownerUid,
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/75 shadow-2xl backdrop-blur-sm">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">My Tokens</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{getTraySummaryText(hasActiveMap)}</p>
      </div>

      <div className="space-y-3 p-4">
        {selectedTokenDetails?.tokenType === 'foe' && isManager && (
          <SelectedFoeDetailsPanel
            token={selectedTokenDetails}
            onUpdateFoeToken={onUpdateFoeToken}
            savingFoeTokenId={savingFoeTokenId}
          />
        )}

        {selectedTokenDetails && selectedTokenDetails.tokenType !== 'foe' && (
          <SelectedResourceTokenDetailsPanel
            token={selectedTokenDetails}
            onSaveSelectedTokenDetails={onSaveSelectedTokenDetails}
            savingSelectedTokenDetailsId={savingSelectedTokenDetailsId}
          />
        )}

        {trayTokens.map((token) => {
          const tokenId = token?.tokenId || token?.id || '';
          const isEditing = editingTokenId === tokenId;
          const isCustomToken = token?.tokenType === 'custom';
          const isUpdating = updatingCustomTokenId === tokenId;
          const isDeleting = deletingCustomTokenId === tokenId;
          const canDrag = !!(hasActiveMap && token?.imageUrl && tokenId && token?.ownerUid && !token?.isHiddenByManager && !isEditing && !isUpdating && !isDeleting);

          return (
            <div
              key={tokenId || token?.label || 'tray-token'}
              draggable={canDrag}
              onDragStart={(event) => handleTokenDragStart(event, token)}
              onDragEnd={() => onDragEnd?.(token)}
              className={`rounded-2xl border px-4 py-4 ${token?.isHiddenByManager ? 'cursor-not-allowed border-rose-500/45 bg-rose-950/20' : canDrag ? 'cursor-grab border-amber-400/50 bg-slate-900/85 hover:border-amber-300 active:cursor-grabbing' : 'cursor-not-allowed border-slate-700 bg-slate-900/60 opacity-75'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-slate-300/70 bg-slate-800">
                    {token?.imageUrl ? <img src={token.imageUrl} alt={token?.label || 'Token'} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">No Img</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold text-slate-100">{token?.label || (isCustomToken ? 'Custom Token' : 'Player')}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${isCustomToken ? 'border-sky-400/35 bg-sky-500/10 text-sky-100' : 'border-amber-400/35 bg-amber-500/10 text-amber-100'}`}>{isCustomToken ? 'Custom' : 'Character'}</span>
                    </div>
                    <p className={`truncate text-xs ${token?.isHiddenByManager ? 'text-rose-200' : 'text-slate-400'}`}>{getTokenStatusLabel(token, activeMapName, hasActiveMap)}</p>
                  </div>
                </div>

                {isCustomToken && !isEditing && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => { setEditingTokenId(tokenId); setEditingLabel(token?.label || ''); setEditingImageFile(null); }} disabled={isUpdating || isDeleting} className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 p-2 text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55" aria-label={`Edit ${token.label || 'custom token'}`} title="Edit custom token"><FiEdit2 className="h-4 w-4" /></button>
                    <button type="button" onClick={() => onDeleteCustomToken?.(token)} disabled={isUpdating || isDeleting} className="inline-flex items-center justify-center rounded-xl border border-rose-400/35 bg-rose-500/10 p-2 text-rose-100 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-55" aria-label={`Delete ${token.label || 'custom token'}`} title="Delete custom token"><FiTrash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>

              {getTokenHelpText(token, hasActiveMap) && <p className="mt-3 text-xs text-slate-300">{getTokenHelpText(token, hasActiveMap)}</p>}
              {isCustomToken && !isEditing && (isUpdating || isDeleting) && <p className="mt-3 text-xs font-medium text-slate-300">{isDeleting ? 'Deleting custom token...' : 'Saving custom token...'}</p>}

              {isCustomToken && isEditing && (
                <div className="mt-4 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/75 p-3">
                  <div>
                    <label htmlFor={`edit-token-label-${tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Name</label>
                    <input id={`edit-token-label-${tokenId}`} type="text" value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} placeholder="Custom token name" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-300" />
                  </div>
                  <div>
                    <label htmlFor={`edit-token-image-${tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Replace Image</label>
                    <input key={`edit-token-image-${tokenId}-${editImageInputKey}`} id={`edit-token-image-${tokenId}`} type="file" accept="image/*" onChange={(event) => setEditingImageFile(event.target.files?.[0] || null)} className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-amber-300" />
                    <p className="mt-1 text-[11px] text-slate-500">{editingImageFile?.name || 'Keep the current image if you leave this empty.'}</p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={resetEditForm} disabled={isUpdating} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"><FiX className="h-4 w-4" />Cancel</button>
                    <button type="button" onClick={async () => { const didUpdate = await onUpdateCustomToken?.({ tokenId, label: editingLabel, imageFile: editingImageFile }); if (didUpdate) resetEditForm(); }} disabled={isUpdating} className="inline-flex items-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-55"><FiCheck className="h-4 w-4" />{isUpdating ? 'Saving' : 'Save'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {isManager && <FoeLibrarySection currentUserId={currentUserId} foeLibrary={foeLibrary} hasActiveMap={hasActiveMap} onDragStart={onDragStart} onDragEnd={onDragEnd} />}

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-500/10 text-amber-200"><FiPlus className="h-4 w-4" /></span>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-100">Add Custom Token</h3>
              <p className="mt-1 text-xs text-slate-400">Create extra tokens for summons, companions, disguises, or alternate forms.</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="create-custom-token-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Name</label>
              <input id="create-custom-token-name" type="text" value={createLabel} onChange={(event) => setCreateLabel(event.target.value)} placeholder="Summoned Wolf" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-300" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label htmlFor="create-custom-token-hp" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">HP</label>
                <input id="create-custom-token-hp" type="number" value={createHpCurrent} onChange={(event) => setCreateHpCurrent(n(event.target.value, 0))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300" />
              </div>
              <div>
                <label htmlFor="create-custom-token-mana" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mana</label>
                <input id="create-custom-token-mana" type="number" value={createManaCurrent} onChange={(event) => setCreateManaCurrent(n(event.target.value, 0))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300" />
              </div>
              <div>
                <label htmlFor="create-custom-token-shield" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Shield</label>
                <input id="create-custom-token-shield" type="number" value={createShieldCurrent} onChange={(event) => setCreateShieldCurrent(n(event.target.value, 0))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300" />
              </div>
            </div>
            <div>
              <label htmlFor="create-custom-token-notes" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</label>
              <textarea id="create-custom-token-notes" rows={4} value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} placeholder="Optional notes" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-300" />
            </div>
            <div>
              <label htmlFor="create-custom-token-image" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Image</label>
              <input key={`create-custom-token-image-${createImageInputKey}`} id="create-custom-token-image" type="file" accept="image/*" onChange={(event) => setCreateImageFile(event.target.files?.[0] || null)} className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-amber-300" />
              <p className="mt-1 text-[11px] text-slate-500">{createImageFile?.name || 'Upload an image to use as the token portrait.'}</p>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={async () => { const didCreate = await onCreateCustomToken?.({ label: createLabel, imageFile: createImageFile, hpCurrent: createHpCurrent, manaCurrent: createManaCurrent, shieldCurrent: createShieldCurrent, notes: createNotes }); if (didCreate) resetCreateForm(); }} disabled={isCreatingCustomToken} className="inline-flex items-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-55"><FiPlus className="h-4 w-4" />{isCreatingCustomToken ? 'Creating' : 'Create Token'}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
