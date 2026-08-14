// DM Foes Hub: create, list, expand, edit, delete foes in Firestore "foes" collection
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { auth, db } from '../firebaseConfig';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '../../performance/firestore';
import { FiPlus, FiChevronDown, FiChevronRight, FiEdit2, FiTrash2, FiX, FiCopy } from 'react-icons/fi';
import { computeParamTotals, deepClone, Pill, SectionTitle } from './elements/utils';
import RadarChart from './elements/RadarChart';
import { FoeFormModal } from './elements/lazyFoeEditors';
import {
  deleteLegacyStoragePath,
  uploadLegacyImage,
} from '../common/legacyMediaStorage';
import { getSchema } from '../../data/configRepository';
import { getCallable } from '../../data/functions/callableRegistry';
import {
  TASK06_LOCAL_CANDIDATE,
} from '../../data/functions/backendOperationClient';
import {
  runWithDurableOperationIntent,
} from '../../data/functions/backendOperationIntentStore';
import { isTask07MediaV1WriteEnabled } from '../../data/media/mediaFeatureFlags';
import useTask07MediaOperationOwner from '../../data/media/useTask07MediaOperationOwner';
import {
  buildTask07NestedMediaTarget,
  task07EmbeddedMediaBinding,
  withoutTask07EmbeddedMediaProjection,
  withTask07EmbeddedMedia,
} from '../../data/media/embeddedMediaProjection';
import {
  runTask07EmbeddedOperationSequence,
  task07EmbeddedFileFingerprint,
} from '../../data/media/embeddedMediaRetry';
import MediaImage, { hasMediaAsset } from '../common/MediaImage';
import {
  buildCanonicalFoeClientPayload,
  classifyFoeImageSave,
  collectClientDeletableFoeStoragePaths,
  deleteFoeDocumentThenCleanupStorage,
  isClientDeletableFoeStoragePath,
  isDefinitiveFoeDuplicationError,
  shouldUseDurableFoeDuplication,
} from './foeMediaLifecycle';
import {
  assertFoeRecoveryFence,
  persistFoeRecoveryWithMarker,
  runFencedFoeRecoveryWrite,
} from './foeRecoveryLifecycle';

const duplicateFoeWithAssetsLegacy = getCallable('duplicateFoeWithAssets');
const duplicateFoeWithAssetsV2 = getCallable('duplicateFoeWithAssetsV2');

// Allow only persisted HTTP(S) image URLs when reading/saving.
// This prevents storing temporary blob:/data: URLs in Firestore.
const isSafeImageUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const normalizeImageUrl = (u) => (isSafeImageUrl(u) ? u : '');
const persistedImagePath = (item = {}) => {
  const explicitPath = typeof item?.imagePath === 'string' ? item.imagePath.trim() : '';
  if (explicitPath) return explicitPath;
  const encodedPath = typeof item?.imageUrl === 'string'
    ? item.imageUrl.split('/o/')[1]?.split('?')[0] || ''
    : '';
  if (!encodedPath) return '';
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return '';
  }
};


const FoeRow = ({ foe, onEdit, onDelete, onDuplicate }) => {
  const [open, setOpen] = useState(false);
  const params = useMemo(() => computeParamTotals(foe?.Parametri || {}), [foe?.Parametri]);
  const hpTxt = `${Number(foe?.stats?.hpCurrent ?? foe?.stats?.hpTotal ?? 0)}/${Number(foe?.stats?.hpTotal ?? 0)}`;
  const manaTxt = `${Number(foe?.stats?.manaCurrent ?? foe?.stats?.manaTotal ?? 0)}/${Number(foe?.stats?.manaTotal ?? 0)}`;
  const renderedTechniques = useMemo(
    () => (Array.isArray(foe?.tecniche) ? foe.tecniche : [])
      .map((entry) => withTask07EmbeddedMedia(
        foe,
        entry,
        'foe-technique'
      )),
    [foe]
  );
  const renderedSpells = useMemo(
    () => (Array.isArray(foe?.spells) ? foe.spells : [])
      .map((entry) => withTask07EmbeddedMedia(foe, entry, 'foe-spell')),
    [foe]
  );
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        role="button"
        aria-expanded={open}
        tabIndex={0}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="text-slate-300 hover:text-white"
            aria-label={open ? 'collapse' : 'expand'}
          >
            {open ? <FiChevronDown /> : <FiChevronRight />}
          </button>
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-800/60 flex items-center justify-center shrink-0">
            {hasMediaAsset(foe, { variant: 'thumbnail' }) ? (
              <MediaImage
                media={foe}
                src={foe?.imageUrl || ''}
                variant="thumbnail"
                alt={foe?.name || 'foe'}
                width={40}
                height={40}
                sizes="40px"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-slate-400 text-sm">
                {(foe?.name || '?').toString().charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold truncate">{foe?.name || '(no name)'}</div>
            <div className="text-[12px] text-slate-400 truncate">Lv {Number(foe?.stats?.level || 1)} • {foe?.category || '—'} • {foe?.rank || '—'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="emerald">HP {hpTxt}</Pill>
          <Pill color="sky">Mana {manaTxt}</Pill>
          <button onClick={(e) => { e.stopPropagation(); onEdit(foe); }} className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/10 px-2 py-1 text-[12px]">
            <FiEdit2 /> Edit
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(foe); }} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 text-amber-200 hover:bg-amber-500/10 px-2 py-1 text-[12px]">
            <FiCopy /> Duplicate
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(foe); }} className="inline-flex items-center gap-1 rounded-lg border border-red-400/40 text-red-200 hover:bg-red-500/10 px-2 py-1 text-[12px]">
            <FiTrash2 /> Delete
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pt-3 pb-4">
          {/* General extra info */}
          {foe?.dadoAnima && (
            <div className="mb-3 text-[12px] text-indigo-200"><span className="text-indigo-300/80">Dado Anima:</span> {foe.dadoAnima}</div>
          )}
          {/* Radar charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RadarChart
                title="Parametri Base"
                labels={Object.keys(params?.Base || {}).sort()}
                values={Object.keys(params?.Base || {}).sort().map((k) => Number(params?.Base?.[k]?.Tot || 0))}
                color="sky"
                size={300}
              />
              <RadarChart
                title="Parametri Combattimento"
                labels={Object.keys(params?.Combattimento || {}).sort()}
                values={Object.keys(params?.Combattimento || {}).sort().map((k) => Number(params?.Combattimento?.[k]?.Tot || 0))}
                color="fuchsia"
                size={300}
              />
            </div>
          
          {/* Notes */}
          {foe?.notes && (
            <div className="mt-3 text-[12px] text-slate-300">{foe.notes}</div>
          )}
          {/* Tecniche */}
          {renderedTechniques.length > 0 && (
            <div className="mt-4 rounded-xl border border-fuchsia-700/40 bg-fuchsia-900/10 p-3">
              <SectionTitle>Tecniche</SectionTitle>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderedTechniques.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                    <div className="w-14 h-14 rounded-md overflow-hidden border border-slate-700/60 bg-slate-800/60 shrink-0 flex items-center justify-center">
                      {hasMediaAsset(t, { variant: 'thumbnail' }) ? (
                        <MediaImage
                          media={t}
                          src={t?.imageUrl || ''}
                          variant="thumbnail"
                          alt={t?.name || `tecnica-${i}`}
                          width={56}
                          height={56}
                          sizes="56px"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-slate-400 text-xs">No Img</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{t?.name || '—'}</div>
                      {t?.danni && (
                        <div className="text-[12px] text-rose-300 whitespace-pre-wrap break-words"><span className="text-rose-200/80">Danni:</span> {t.danni}</div>
                      )}
                      {t?.effetti && (
                        <div className="text-[12px] text-fuchsia-200 whitespace-pre-wrap break-words"><span className="text-fuchsia-300/80">Effetti:</span> {t.effetti}</div>
                      )}
                      {t?.description && (
                        <div className="text-[12px] text-slate-300 whitespace-pre-wrap break-words">{t.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Spells */}
          {renderedSpells.length > 0 && (
            <div className="mt-4 rounded-xl border border-sky-700/40 bg-sky-900/10 p-3">
              <SectionTitle>Spells</SectionTitle>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderedSpells.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                    <div className="w-14 h-14 rounded-md overflow-hidden border border-slate-700/60 bg-slate-800/60 shrink-0 flex items-center justify-center">
                      {hasMediaAsset(s, { variant: 'thumbnail' }) ? (
                        <MediaImage
                          media={s}
                          src={s?.imageUrl || ''}
                          variant="thumbnail"
                          alt={s?.name || `spell-${i}`}
                          width={56}
                          height={56}
                          sizes="56px"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-slate-400 text-xs">No Img</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{s?.name || '—'}</div>
                      {s?.danni && (
                        <div className="text-[12px] text-rose-300 whitespace-pre-wrap break-words"><span className="text-rose-200/80">Danni:</span> {s.danni}</div>
                      )}
                      {s?.effetti && (
                        <div className="text-[12px] text-sky-200 whitespace-pre-wrap break-words"><span className="text-sky-300/80">Effetti:</span> {s.effetti}</div>
                      )}
                      {s?.description && (
                        <div className="text-[12px] text-slate-300 whitespace-pre-wrap break-words">{s.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FoesHub = () => {
  const task07MediaOperationOwner = useTask07MediaOperationOwner();
  const [foes, setFoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // foe doc or null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  // Duplicate modal state
  const [dupOpen, setDupOpen] = useState(false);
  const [dupTarget, setDupTarget] = useState(null);
  const [dupName, setDupName] = useState('');
  const [dupBusy, setDupBusy] = useState(false);
  const [dupError, setDupError] = useState('');
  const pendingFoeRetirementRef = useRef(null);
  const pendingFoeCreateRef = useRef(null);
  const completedNestedOperationsRef = useRef(new Set());
  const completedRootUploadRef = useRef(null);

  // Subscribe foes
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'foes'), (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      // sort by updated_at/created_at desc if present
      rows.sort((a, b) => (b.updated_at?.seconds || b.created_at?.seconds || 0) - (a.updated_at?.seconds || a.created_at?.seconds || 0));
      setFoes(rows);
      setLoading(false);
    }, (err) => {
      console.error('foes snapshot error', err);
      setLoading(false);
      setError('Impossibile caricare i foes.');
    });
    return () => unsub();
  }, []);

  // Load base schema to bootstrap a foe
  useEffect(() => {
    (async () => {
      try {
        const schemaData = await getSchema('schema_pg');
        if (schemaData) setSchema(schemaData);
        else setSchema({});
      } catch (e) {
        console.warn('Unable to load schema_pg', e);
        setSchema({});
      }
    })();
  }, []);

  const newFoeFromSchema = useCallback(() => {
    const p = deepClone(schema?.Parametri || {});
    const st = deepClone(schema?.stats || {});
    // Minimal defaults
    return {
      name: '',
      category: '',
      rank: '',
      imageUrl: '',
      notes: '',
  dadoAnima: '',
      Parametri: p,
      stats: { level: 1, hpTotal: 0, hpCurrent: 0, manaTotal: 0, manaCurrent: 0, initiative: 0, ...st },
      tecniche: deepClone(schema?.tecniche || {}),
      spells: deepClone(schema?.spells || {}),
      inventory: [],
    };
  }, [schema]);

  const handleCreate = () => {
    pendingFoeCreateRef.current = null;
    completedNestedOperationsRef.current.clear();
    completedRootUploadRef.current = null;
    setEditing(null);
    setModalError('');
    setModalOpen(true);
  };

  const handleEdit = (foe) => {
    pendingFoeCreateRef.current = null;
    completedNestedOperationsRef.current.clear();
    completedRootUploadRef.current = null;
    setEditing(foe);
    setModalError('');
    setModalOpen(true);
  };

  const handleDuplicateOpen = (foe) => {
    setDupTarget(foe);
    const base = foe?.name?.toString()?.trim() || 'Foe';
    setDupName(`${base} (copy)`);
    setDupError('');
    setDupOpen(true);
  };

  const closeDuplicateModal = () => {
    if (dupBusy) return;
    setDupOpen(false);
    setDupTarget(null);
    setDupName('');
    setDupError('');
  };

  const handleDelete = async (foe) => {
    if (!foe?.id) return;
    const ok = window.confirm(`Eliminare definitivamente "${foe.name || foe.id}"?`);
    if (!ok) return;
    try {
      setBusy(true);

      const clientDeletablePaths = collectClientDeletableFoeStoragePaths(foe);
      // Canonical main media is retired by the Firestore deletion trigger.
      // Delete Firestore first so a failed document deletion can never leave a
      // live foe pointing at objects that this client already removed.
      await deleteFoeDocumentThenCleanupStorage({
        deleteFoeDocument: () => deleteDoc(doc(db, 'foes', foe.id)),
        deleteStoragePath: deleteLegacyStoragePath,
        paths: clientDeletablePaths,
      });
    } catch (e) {
      console.error('delete foe failed', e);
      setError('Eliminazione fallita.');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (foeData, options = {}) => {
    const uploadedLegacyPaths = new Set();
    let mediaMetadataCommitted = false;
    try {
      setBusy(true);
      setError('');
      setModalError('');
      const {
        imageFile: requestedImageFile,
        removeImage,
        originalImageUrl,
        originalImagePath,
      } = options;
      const pendingFoeAtAttemptStart = !editing?.id
        ? pendingFoeCreateRef.current
        : null;
      const foeRef = editing?.id
        ? doc(db, 'foes', editing.id)
        : pendingFoeAtAttemptStart?.ref || doc(collection(db, 'foes'));
      const parentExistedAtAttemptStart = Boolean(
        editing?.id || pendingFoeAtAttemptStart?.ref
      );
      let parentSnapshotAtAttemptStart = null;
      let currentFoe = null;
      if (parentExistedAtAttemptStart) {
        const current = await getDoc(foeRef);
        if (!current.exists()) {
          if (pendingFoeAtAttemptStart?.ref) {
            pendingFoeCreateRef.current = null;
            completedNestedOperationsRef.current.clear();
            completedRootUploadRef.current = null;
          }
          throw new Error('The foe no longer exists. Reopen the form.');
        }
        parentSnapshotAtAttemptStart = current.data();
        currentFoe = {id: current.id, ...parentSnapshotAtAttemptStart};
        if (pendingFoeAtAttemptStart?.ref) {
          pendingFoeCreateRef.current = {ref: foeRef, data: currentFoe};
        }
      }
      const rootUploadKey = requestedImageFile
        ? task07EmbeddedFileFingerprint(requestedImageFile)
        : null;
      const rootMediaAlreadyCommitted = Boolean(
        rootUploadKey
        && completedRootUploadRef.current === rootUploadKey
        && hasMediaAsset(currentFoe)
      );
      const imageFile = rootMediaAlreadyCommitted ? null : requestedImageFile;
      const nestedEntries = [
        ...(Array.isArray(foeData?.tecniche) ? foeData.tecniche : []),
        ...(Array.isArray(foeData?.spells) ? foeData.spells : []),
      ];
      const hasNestedImageUpload = nestedEntries.some((entry) => entry?.imageFile);
      const task07NestedWriteEnabled = hasNestedImageUpload && (
        await isTask07MediaV1WriteEnabled({
          purpose: 'foe',
          role: 'dm',
          uid: auth.currentUser?.uid || '',
        })
      );
      const task07WriteEnabled = Boolean(imageFile && !removeImage) && (
        await isTask07MediaV1WriteEnabled({
          purpose: 'foe',
          role: 'dm',
          uid: auth.currentUser?.uid || '',
        })
      );
      const imageSave = classifyFoeImageSave({
        currentFoe: currentFoe || editing,
        hasImageFile: Boolean(imageFile),
        initialFoe: editing,
        removeImage: Boolean(removeImage),
        task07WriteEnabled,
      });
      if (imageSave.mode === 'blocked') {
        const blockedError = new Error(imageSave.message);
        blockedError.code = imageSave.code;
        throw blockedError;
      }

      // Keep File references for nested items; we'll replace arrays after upload
      const canonicalEdit = parentExistedAtAttemptStart && (
        imageSave.binding.status !== 'none'
        || imageSave.mode === 'canonical-upload'
        || imageSave.mode === 'canonical-remove'
      );
      const basePayload = canonicalEdit
        ? buildCanonicalFoeClientPayload(foeData, {
          omitMainImageFields: imageSave.mode !== 'canonical-upload',
        })
        : { ...foeData };
      // Ensure current hp/mana mirror totals at save time
      const hpTotal = Number(basePayload?.stats?.hpTotal || 0);
      const manaTotal = Number(basePayload?.stats?.manaTotal || 0);
      basePayload.stats = {
        ...(basePayload.stats || {}),
        hpCurrent: hpTotal,
        manaCurrent: manaTotal,
      };
      const embeddedRegistry = currentFoe?.task07EmbeddedMedia
        || editing?.task07EmbeddedMedia;
      if (embeddedRegistry && typeof embeddedRegistry === 'object') {
        basePayload.task07EmbeddedMedia = embeddedRegistry;
      }

      const nestedMediaOperations = [];

      const uploadEntryImage = async (folder, entry, entryIndex) => {
        const persistentEntry = withoutTask07EmbeddedMediaProjection(entry);
        let eUrl = persistentEntry.imageUrl || '';
        let ePath = persistentEntry.imagePath || '';
        const targetKind = folder === 'tecniche'
          ? 'foe-technique'
          : 'foe-spell';
        const target = buildTask07NestedMediaTarget({
          parent: currentFoe || editing || {},
          entry: persistentEntry,
          entityId: foeRef.id,
          targetKind,
          entryIndex,
        });
        const binding = task07EmbeddedMediaBinding(
          currentFoe || editing || {},
          {...persistentEntry, task07MediaEntryId: target.entryId},
          targetKind
        );
        if (persistentEntry.imageFile && task07NestedWriteEnabled) {
          nestedMediaOperations.push({
            action: 'upload',
            entry: {...persistentEntry, task07MediaEntryId: target.entryId},
            entryIndex,
            file: persistentEntry.imageFile,
            targetKind,
          });
          eUrl = normalizeImageUrl(eUrl);
        } else if (persistentEntry.imageFile) {
          const safe = (persistentEntry.name || folder).toString().trim().replace(/\s+/g, '_').slice(0, 40) || folder;
          const fname = `${safe}_${Date.now()}`;
          const path = `foes/${folder}/${fname}`;
          ({ downloadUrl: eUrl } = await uploadLegacyImage(
            path,
            persistentEntry.imageFile
          ));
          uploadedLegacyPaths.add(path);
          ePath = path;
        } else if (persistentEntry.removeImage) {
          if (binding?.media?.assetId) {
            nestedMediaOperations.push({
              action: 'retire',
              assetId: binding.media.assetId,
            });
          }
          eUrl = '';
          ePath = '';
        } else {
          // Preserve only safe persisted URLs
          eUrl = normalizeImageUrl(eUrl);
        }
        // Persist only relevant fields
        return {
          name: persistentEntry.name || '',
          description: persistentEntry.description || '',
          danni: persistentEntry.danni || '',
          effetti: persistentEntry.effetti || '',
          imageUrl: eUrl,
          imagePath: ePath,
          ...(persistentEntry.task07MediaEntryId || task07NestedWriteEnabled || binding
            ? {task07MediaEntryId: target.entryId}
            : {}),
        };
      };

      const commitNestedMediaOperations = async () => {
        if (nestedMediaOperations.length === 0) return;
        const actorUid = auth.currentUser?.uid || '';
        const {
          runTask07NestedMediaWriter,
        } = await import(
          /* webpackChunkName: "feature-task07-media" */
          '../../data/media/embeddedMedia'
        );
        const {
          getTask07MediaStatus,
          retireTask07MediaAsset,
        } = await import(
          /* webpackChunkName: "feature-task07-media" */
          '../../data/media/mediaPipeline'
        );
        const retiredAssets = new Set();
        await runTask07EmbeddedOperationSequence({
          completedKeys: completedNestedOperationsRef.current,
          operations: nestedMediaOperations,
          parentId: foeRef.id,
          execute: async (operation) => {
          if (operation.action === 'retire') {
            if (retiredAssets.has(operation.assetId)) return;
            retiredAssets.add(operation.assetId);
            try {
              await retireTask07MediaAsset(operation.assetId);
            } catch (retirementError) {
              const status = await getTask07MediaStatus(operation.assetId)
                .catch(() => null);
              if (!status || status.attached === true
                || !['superseded', 'deleted'].includes(status.state)) {
                throw retirementError;
              }
            }
            return;
          }
          const lease = task07MediaOperationOwner.start(
            'Nested foe media upload was replaced.'
          );
          try {
            return await runTask07NestedMediaWriter({
              actorUid,
              role: 'dm',
              ownerUid: actorUid,
              entityId: foeRef.id,
              parent: currentFoe || editing || {},
              entry: operation.entry,
              targetKind: operation.targetKind,
              entryIndex: operation.entryIndex,
              kind: 'foe',
              file: operation.file,
              signal: lease.signal,
            });
          } finally {
            lease.release();
          }
          },
        });
      };

      const queueRemovedNestedBindings = (withTec, withSp) => {
        const retainedByKind = new Map([
          ['foe-technique', new Set(withTec
            .map((entry) => entry?.task07MediaEntryId)
            .filter(Boolean))],
          ['foe-spell', new Set(withSp
            .map((entry) => entry?.task07MediaEntryId)
            .filter(Boolean))],
        ]);
        [
          ['foe-technique', currentFoe?.tecniche],
          ['foe-spell', currentFoe?.spells],
        ].forEach(([targetKind, entries]) => (
          Array.isArray(entries) ? entries : []
        ).forEach((entry) => {
          if (retainedByKind.get(targetKind)
            ?.has(entry?.task07MediaEntryId)) return;
          const binding = task07EmbeddedMediaBinding(
            currentFoe || {},
            entry,
            targetKind
          );
          if (binding?.media?.assetId) {
            nestedMediaOperations.push({
              action: 'retire',
              assetId: binding.media.assetId,
            });
          }
        }));
      };

      const cleanupReplacedEntryImages = async (withTec, withSp) => {
        try {
          const cleanupList = [];
          const collectReplacedPaths = (previousItems, nextItems) => {
            previousItems.forEach((previous, index) => {
              const previousPath = persistedImagePath(previous);
              const nextPath = persistedImagePath(nextItems[index]);
              if (
                previousPath
                && previousPath !== nextPath
                && (previous?.imageFile || previous?.removeImage)
                && isClientDeletableFoeStoragePath(previousPath)
              ) {
                cleanupList.push(previousPath);
              }
            });
          };
          collectReplacedPaths(
            Array.isArray(foeData?.tecniche) ? foeData.tecniche : [],
            withTec
          );
          collectReplacedPaths(
            Array.isArray(foeData?.spells) ? foeData.spells : [],
            withSp
          );
          await Promise.allSettled(
            [...new Set(cleanupList)].map((path) => deleteLegacyStoragePath(path))
          );
        } catch (cleanupError) {
          console.warn('cleanup old foe entry image failed', cleanupError);
        }
      };

      if (imageSave.mode === 'canonical-upload') {
        const actorUid = auth.currentUser?.uid || '';
        const withTec = Array.isArray(basePayload.tecniche)
          ? await Promise.all(basePayload.tecniche.map((entry, index) => uploadEntryImage('tecniche', entry, index)))
          : [];
        const withSp = Array.isArray(basePayload.spells)
          ? await Promise.all(basePayload.spells.map((entry, index) => uploadEntryImage('spells', entry, index)))
          : [];
        basePayload.tecniche = withTec;
        basePayload.spells = withSp;
        queueRemovedNestedBindings(withTec, withSp);

        const {
          describeTask07ConsumerOutcome,
          runTask07ConsumerUpload,
          runWithTask07MediaOperationReceipt,
          task07ConsumerNeedsAttention,
        } = await import(
          /* webpackChunkName: "feature-task07-media" */
          '../../data/media/mediaConsumerAdapter'
        );
        const payload = {
          ...basePayload,
          // Keep the last legacy reference while the authoritative attachment
          // is written. Immediate Task 07 rollback must not depend on the new
          // manifest, and the server will preserve these fields transactionally.
          imageUrl: currentFoe
            ? currentFoe.imageUrl || ''
            : editing?.imageUrl || '',
          imagePath: currentFoe
            ? currentFoe.imagePath || ''
            : editing?.imagePath || '',
          updated_at: serverTimestamp(),
        };
        const expectedRevision = imageSave.binding.revision;
        const previousAssetId = imageSave.binding.assetId;
        const operationLease = task07MediaOperationOwner.start(
          'Foe media upload was replaced.'
        );
        let outcome;
        try {
          outcome = await runWithTask07MediaOperationReceipt({
            actorUid,
            ownerUid: actorUid,
            entityId: foeRef.id,
            kind: 'foe',
            file: imageFile,
            expectedRevision,
            previousAssetId,
            signal: operationLease.signal,
            invoke: ({
              operationId,
              expectedRevision: receiptExpectedRevision,
              previousAssetId: receiptPreviousAssetId,
              signal,
            }) => runTask07ConsumerUpload({
              file: imageFile,
              ownerUid: actorUid,
              entityId: foeRef.id,
              operationId,
              kind: 'foe',
              previousAssetId: receiptPreviousAssetId,
              expectedRevision: receiptExpectedRevision,
              prepareEntity: async () => {
                if (parentExistedAtAttemptStart) {
                  await updateDoc(foeRef, payload);
                  if (pendingFoeAtAttemptStart?.ref) {
                    pendingFoeCreateRef.current = {
                      ref: foeRef,
                      data: {...currentFoe, ...payload, id: foeRef.id},
                    };
                  }
                } else {
                  await setDoc(foeRef, {
                    ...payload,
                    created_at: serverTimestamp(),
                  });
                  pendingFoeCreateRef.current = {ref: foeRef, data: payload};
                }
                mediaMetadataCommitted = true;
              },
              ...(editing?.id ? {} : {
                rollbackPreparedEntity: async () => {
                  if (parentExistedAtAttemptStart) {
                    await setDoc(foeRef, parentSnapshotAtAttemptStart);
                    pendingFoeCreateRef.current = {
                      ref: foeRef,
                      data: {id: foeRef.id, ...parentSnapshotAtAttemptStart},
                    };
                  } else {
                    await deleteDoc(foeRef);
                    pendingFoeCreateRef.current = null;
                    completedNestedOperationsRef.current.clear();
                    completedRootUploadRef.current = null;
                  }
                  mediaMetadataCommitted = false;
                },
              }),
              signal,
            }),
          });
        } finally {
          operationLease.release();
        }
        if (!task07ConsumerNeedsAttention(outcome)) {
          completedRootUploadRef.current = rootUploadKey;
        }

        await cleanupReplacedEntryImages(withTec, withSp);
        await commitNestedMediaOperations();

        pendingFoeCreateRef.current = null;
        completedNestedOperationsRef.current.clear();
        completedRootUploadRef.current = null;
        setModalOpen(false);
        setEditing(null);
        if (task07ConsumerNeedsAttention(outcome)) {
          setError(describeTask07ConsumerOutcome(outcome, 'Foe image'));
        }
        return;
      }

      if (imageSave.mode === 'canonical-remove') {
        const actorUid = auth.currentUser?.uid || '';
        const {
          buildFoeMediaRetirementReconciliationMarker,
          buildFoeMediaRetirementIntent,
          isDefinitiveFoeRetirementError,
          planFoeMediaRetirementRecovery,
          runFoeMediaRetirement,
          shouldSaveCurrentFoeAfterRetirementRecovery,
        } = await import(
          /* webpackChunkName: "feature-task07-media" */
          '../../data/media/foeMediaRetirement'
        );
        let retirement = await buildFoeMediaRetirementIntent({
          payload: basePayload,
          assetId: imageSave.binding.assetId,
          expectedRevision: imageSave.binding.revision,
          expectedUpdatedAt: currentFoe?.updated_at ?? editing?.updated_at ?? null,
        });
        const pendingRetirement = pendingFoeRetirementRef.current;
        let saveCurrentAfterRecovery = false;
        let recoveryMarker = null;
        let preflightRecoveryFence = false;
        if (pendingRetirement) {
          const liveAssetId = currentFoe?.media?.assetId
            || currentFoe?.General?.media?.assetId
            || null;
          const recovery = planFoeMediaRetirementRecovery({
            currentRetirement: retirement,
            foeId: editing.id,
            liveAssetId,
            pendingRetirement,
          });
          if (recovery.action === 'run-pending') {
            retirement = recovery.retirement;
          } else if (recovery.action === 'save-current') {
            recoveryMarker = recovery.marker;
            saveCurrentAfterRecovery = true;
          } else if (recovery.action !== 'run-current') {
            const { abandonDurableFoeMediaRetirement } = await import(
              /* webpackChunkName: "feature-task07-media" */
              '../../data/media/foeMediaRetirement'
            );
            const settlement = await abandonDurableFoeMediaRetirement(
              pendingRetirement
            );
            saveCurrentAfterRecovery =
              shouldSaveCurrentFoeAfterRetirementRecovery({
                action: recovery.action,
                settlement,
              });
            if (saveCurrentAfterRecovery) {
              recoveryMarker = buildFoeMediaRetirementReconciliationMarker({
                currentUpdatedAt: currentFoe?.updated_at ?? editing?.updated_at,
                foeId: editing.id,
                pendingRetirement,
                settlement,
              });
              pendingFoeRetirementRef.current = recoveryMarker;
              preflightRecoveryFence = true;
            } else {
              pendingFoeRetirementRef.current = null;
            }
          }
        }
        if (!saveCurrentAfterRecovery) {
          try {
            await runFoeMediaRetirement({
              actorUid,
              ...retirement,
              onOperation: (operation) => {
                pendingFoeRetirementRef.current = {
                  actorUid,
                  immutableIntent: operation.immutableIntent,
                  filesByKey: retirement.filesByKey,
                };
              },
            });
          } catch (retirementError) {
            if (retirementError?.committed === true) {
              console.warn(
                'foe retirement committed but local receipt cleanup failed',
                retirementError
              );
            } else {
              if (isDefinitiveFoeRetirementError(retirementError)) {
                pendingFoeRetirementRef.current = null;
              }
              throw retirementError;
            }
          }
          pendingFoeRetirementRef.current = null;
          setModalOpen(false);
          setEditing(null);
          return;
        }
        // The old operation removed the canonical binding. Persist the newer
        // form through the existing non-canonical path below so its edits and
        // nested image selections are not replaced by the completed intent.
        if (preflightRecoveryFence) {
          const fresh = await getDoc(doc(db, 'foes', editing.id));
          assertFoeRecoveryFence({
            current: fresh.exists() ? fresh.data() : null,
            exists: fresh.exists(),
            expectedUpdatedAt:
              recoveryMarker.reconciliation.expectedUpdatedAt,
          });
        }
      }

      const recoveryMarker = pendingFoeRetirementRef.current?.reconciliation
        ?.status === 'save-current'
        ? pendingFoeRetirementRef.current
        : null;
      const storedRecoveryPayload = recoveryMarker?.reconciliation?.payload;
      let imageUrl = storedRecoveryPayload?.imageUrl
        ?? basePayload.imageUrl
        ?? null;
      let imagePath = storedRecoveryPayload?.imagePath
        ?? basePayload.imagePath
        ?? null;

      // If a new file selected, upload to foes/ and get URL
      if (imageFile && !storedRecoveryPayload) {
        const safeName = (basePayload?.name || 'foe').toString().trim().replace(/\s+/g, '_').slice(0, 40) || 'foe';
        const fileName = `${safeName}_${Date.now()}`;
        const path = `foes/${fileName}`;
        ({ downloadUrl: imageUrl } = await uploadLegacyImage(path, imageFile));
        uploadedLegacyPaths.add(path);
        imagePath = path;
      }

      // Remove image explicit request
      if (removeImage && !storedRecoveryPayload) {
        imageUrl = null;
        imagePath = null;
      }

      const withTec = storedRecoveryPayload
        ? storedRecoveryPayload.tecniche || []
        : Array.isArray(basePayload.tecniche)
          ? await Promise.all(basePayload.tecniche.map((t, index) => uploadEntryImage('tecniche', t, index)))
          : [];
      const withSp = storedRecoveryPayload
        ? storedRecoveryPayload.spells || []
        : Array.isArray(basePayload.spells)
          ? await Promise.all(basePayload.spells.map((s, index) => uploadEntryImage('spells', s, index)))
          : [];
      basePayload.tecniche = withTec;
      basePayload.spells = withSp;
      queueRemovedNestedBindings(withTec, withSp);

      const payload = storedRecoveryPayload || {
        ...basePayload,
        imageUrl: normalizeImageUrl(imageUrl) || '',
        imagePath: imagePath || '',
        updated_at: serverTimestamp(),
      };
      if (recoveryMarker && !storedRecoveryPayload) {
        recoveryMarker.reconciliation.payload = payload;
      }

      let docId = editing?.id || pendingFoeCreateRef.current?.ref?.id;
      if (docId) {
        if (recoveryMarker) {
          await persistFoeRecoveryWithMarker({
            marker: recoveryMarker,
            markerRef: pendingFoeRetirementRef,
            persist: () => runFencedFoeRecoveryWrite({
              db,
              expectedUpdatedAt:
                recoveryMarker.reconciliation.expectedUpdatedAt,
              foeRef,
              payload,
              runTransaction,
            }),
          });
        } else {
          await updateDoc(foeRef, payload);
        }
        mediaMetadataCommitted = true;
        if (!editing?.id && pendingFoeCreateRef.current) {
          pendingFoeCreateRef.current.data = {
            ...currentFoe,
            ...payload,
            id: foeRef.id,
          };
        }
      } else {
        await setDoc(foeRef, {...payload, created_at: serverTimestamp()});
        docId = foeRef.id;
        mediaMetadataCommitted = true;
        pendingFoeCreateRef.current = {ref: foeRef, data: payload};
      }

      // If we uploaded/replaced or removed, delete the original image from storage
      try {
        const oldPath = persistedImagePath({
          imagePath: originalImagePath,
          imageUrl: originalImageUrl,
        });
        const newPath = imagePath;
        if (
          (imageFile || removeImage)
          && oldPath
          && oldPath !== newPath
          && isClientDeletableFoeStoragePath(oldPath)
        ) {
          await deleteLegacyStoragePath(oldPath);
        }
        await cleanupReplacedEntryImages(withTec, withSp);
      } catch (e) {
        console.warn('cleanup old foe image failed', e);
      }
      await commitNestedMediaOperations();

      pendingFoeCreateRef.current = null;
      completedNestedOperationsRef.current.clear();
      completedRootUploadRef.current = null;
      setModalOpen(false);
      setEditing(null);
    } catch (e) {
      console.error('save foe failed', e);
      const canRollbackLegacyUploads = !mediaMetadataCommitted
        && e?.committed !== true
        && e?.commitAttempted !== true;
      if (canRollbackLegacyUploads && uploadedLegacyPaths.size) {
        const rollbackPaths = [...uploadedLegacyPaths];
        const rollbackResults = await Promise.allSettled(
          rollbackPaths.map((path) => deleteLegacyStoragePath(path))
        );
        rollbackResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.warn(
              `Foe upload rollback failed for ${rollbackPaths[index]}:`,
              result.reason
            );
          }
        });
      }
      setModalError(e?.message || 'Salvataggio fallito.');
    } finally {
      setBusy(false);
    }
  };

  // Duplicate logic (copies firestore doc and re-uploads images to new paths)
  const handleDuplicateConfirm = async () => {
    if (!dupTarget || !dupName.trim()) return;
    try {
      setDupBusy(true);
      setDupError('');
      const duplicateRequest = {
        sourceFoeId: dupTarget.id,
        newFoeName: dupName.trim(),
      };
      const useDurableDuplication = shouldUseDurableFoeDuplication(
        dupTarget,
        { force: TASK06_LOCAL_CANDIDATE }
      );
      if (useDurableDuplication) {
        await runWithDurableOperationIntent({
          actorUid: auth.currentUser?.uid,
          kind: 'duplicate-foe',
          intent: duplicateRequest,
          isDefinitiveError: isDefinitiveFoeDuplicationError,
          invoke: (operationId) => duplicateFoeWithAssetsV2({
            ...duplicateRequest,
            operationId,
          }),
        });
      } else {
        await duplicateFoeWithAssetsLegacy(duplicateRequest);
      }
      // Optional: we could resolve URLs for previews here using getDownloadURL on returned paths
      // but no need to mutate state; the Firestore onSnapshot will include the new doc
      setDupOpen(false);
      setDupTarget(null);
      setDupName('');
    } catch (e) {
      console.error('duplicate foe failed', e);
      setDupError(
        typeof e?.message === 'string' && e.message.trim()
          ? e.message.trim() : 'Duplicazione fallita.'
      );
    } finally {
      setDupBusy(false);
    }
  };

  // The parent registry is authoritative for embedded media. Project it into
  // editor entries so canonical-only images remain previewable and removable
  // without copying descriptors into the persisted nested arrays.
  const initialForModal = useMemo(() => editing ? {
    ...editing,
    tecniche: (Array.isArray(editing.tecniche) ? editing.tecniche : [])
      .map((entry) => withTask07EmbeddedMedia(
        editing,
        entry,
        'foe-technique'
      )),
    spells: (Array.isArray(editing.spells) ? editing.spells : [])
      .map((entry) => withTask07EmbeddedMedia(
        editing,
        entry,
        'foe-spell'
      )),
  } : newFoeFromSchema(), [editing, newFoeFromSchema]);

  return (
    <div className="p-4 md:p-6 lg:p-8 text-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold mb-1">Foes Hub</h1>
            <p className="text-gray-300">Crea e gestisci creature per gli incontri.</p>
          </div>
          <button onClick={handleCreate} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white px-4 py-2 border border-emerald-400/40 disabled:opacity-60" disabled={busy || !schema}>
            <FiPlus /> Nuovo foe
          </button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="text-slate-300">Caricamento…</div>
        ) : (
          <div className="space-y-3">
            {foes.length === 0 ? (
              <div className="text-slate-400">Nessun foe creato. Clicca "Nuovo foe" per iniziare.</div>
            ) : (
              foes.map((f) => (
                <FoeRow key={f.id} foe={f} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicateOpen} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal */}
  {modalOpen ? (
    <FoeFormModal
      open
      initial={initialForModal}
      onCancel={async () => {
        if (busy) return;
        const pending = pendingFoeRetirementRef.current;
        if (pending && !pending.reconciliation) {
          try {
            const { abandonDurableFoeMediaRetirement } = await import(
              /* webpackChunkName: "feature-task07-media" */
              '../../data/media/foeMediaRetirement'
            );
            await abandonDurableFoeMediaRetirement(pending);
          } catch (abandonError) {
            console.warn('foe retirement abandonment was deferred', abandonError);
          }
        }
        pendingFoeRetirementRef.current = null;
        pendingFoeCreateRef.current = null;
        completedNestedOperationsRef.current.clear();
        completedRootUploadRef.current = null;
        setModalOpen(false);
        setEditing(null);
        setModalError('');
      }}
      onSave={handleSave}
      schema={schema}
      busy={busy}
      error={modalError}
    />
  ) : null}
      {dupOpen && createPortal(
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/95 p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="text-white font-semibold">Duplicate foe</div>
              <button className="text-slate-300 hover:text-white" onClick={closeDuplicateModal} aria-label="close"><FiX /></button>
            </div>
            {dupError && <div className="mb-2 text-sm text-red-300">{dupError}</div>}
            <label className="block mb-3">
              <div className="text-[11px] text-slate-300 mb-1">New name</div>
              <input disabled={dupBusy} className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={dupName} onChange={(e) => setDupName(e.target.value)} />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button disabled={dupBusy} onClick={closeDuplicateModal} className="px-3 py-1 rounded-md border border-slate-400/40 text-slate-200 hover:bg-slate-500/10 text-[12px]">Cancel</button>
              <button disabled={dupBusy || !dupName.trim()} onClick={handleDuplicateConfirm} className="inline-flex items-center gap-2 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white px-3 py-1 border border-amber-400/40 text-[12px]">
                <FiCopy /> {dupBusy ? 'Duplicating…' : 'Duplicate'}
              </button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
};

export default FoesHub;
