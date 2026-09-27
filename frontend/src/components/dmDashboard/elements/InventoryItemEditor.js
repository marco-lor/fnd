import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthSession } from '../../../AuthContext';
import { catalogDetail, watchCatalogRevision } from '../../../data/bazaarCatalogRepository';
import { AddAccessorioOverlay, AddArmaturaOverlay, AddConsumabileOverlay, AddWeaponOverlay } from '../../bazaar/lazyBazaarEditors';
import { EditVarieItemOverlay } from './lazyPlayerInfoOverlays';

const editors = { weapon: AddWeaponOverlay, armatura: AddArmaturaOverlay,
  accessorio: AddAccessorioOverlay, consumabile: AddConsumabileOverlay, varie: EditVarieItemOverlay };
const itemType = (item) => {
  const type = String(item?.type || item?.item_type || '').toLowerCase();
  return Object.hasOwn(editors, type) ? type : null;
};

// Resolve only the selected incomplete snapshot; never load the catalog list.
export default function InventoryItemEditor({ initialData, inventoryUserId, inventoryItemId, inventoryItemIndex, onClose }) {
  const { repositoryAccessGeneration = 0 } = useAuthSession();
  const savedType = itemType(initialData);
  const catalogId = initialData?._task05?.catalogItemId || initialData?._instance?.catalogItemId || initialData?.id;
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([inventoryUserId, inventoryItemId, catalogId, repositoryAccessGeneration, attempt]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [state, setState] = useState({ key: null, item: null, error: null });
  useEffect(() => {
    if (savedType) return undefined;
    let active = true;
    let sequence = 0;
    let lastRevision;
    let stop;
    const release = () => { stop?.(); stop = null; };
    const isCurrent = (token) => active && currentKey.current === key && token === sequence;
    setState({ key, item: null, error: null });
    if (!catalogId) {
      setState({ key, item: null, error: 'Oggetto privo di un riferimento al catalogo.' });
      return undefined;
    }
    stop = watchCatalogRevision(async (revision) => {
      if (!active || currentKey.current !== key || revision === lastRevision) return;
      lastRevision = revision;
      const token = ++sequence;
      setState({ key, item: null, error: null });
      try {
        const item = await catalogDetail(catalogId, revision);
        if (!item || item.id !== catalogId || !itemType(item)) throw new Error('Tipo di oggetto non disponibile nel catalogo.');
        if (isCurrent(token)) {
          // The editor owns this snapshot now; later catalog changes must not reset its draft.
          active = false;
          release();
          setState({ key, item, error: null });
        }
      } catch (error) {
        if (isCurrent(token)) setState({ key, item: null, error: error.message });
      }
    }, (error) => {
      if (!active || currentKey.current !== key) return;
      sequence += 1;
      lastRevision = undefined;
      setState({ key, item: null, error: error.message });
    });
    return () => { active = false; release(); };
  }, [key, catalogId, savedType]);

  const catalogItem = state.key === key ? state.item : null;
  const error = state.key === key ? state.error : null;
  const type = savedType || itemType(catalogItem);
  const data = useMemo(() => catalogItem ? { ...catalogItem, ...initialData,
    General: { ...catalogItem.General, ...initialData.General },
    Specific: { ...catalogItem.Specific, ...initialData.Specific }, item_type: type,
  } : { ...initialData, item_type: type }, [catalogItem, initialData, type]);
  if (!type) return <div role="dialog" aria-label="Modifica oggetto" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div className="rounded-lg bg-slate-900 p-5 text-slate-100">
      {error ? <p role="alert">{error}</p> : <p role="status">Caricamento oggetto...</p>}
      {error && <button type="button" onClick={() => setAttempt((value) => value + 1)} className="m-2 rounded border px-3 py-1">Riprova</button>}
      <button type="button" onClick={() => onClose(false)} className="m-2 rounded border px-3 py-1">Chiudi</button>
    </div>
  </div>;

  const Editor = editors[type];
  return <Editor initialData={data} onClose={onClose} showMessage={console.log}
    editMode inventoryEditMode userId={inventoryUserId} inventoryUserId={inventoryUserId}
    inventoryItemId={inventoryItemId} inventoryItemIndex={inventoryItemIndex} />;
}
