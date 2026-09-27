import React, { useState, useEffect, useRef } from 'react';
import CodexBackground from '../backgrounds/CodexBackground';
import { useAuth } from '../../AuthContext';
import { subscribeCodexControl, subscribeCodexMetadataPage, subscribeCodexItemsPage } from '../../data/codexRepository';
import { useShellLayout } from '../common/shellLayout';
import CodexDialog from './CodexDialog';
import AggiungiButton from './buttons/AggiungiButton';
import AggiungiCategoriaButton from './buttons/AggiungiCategoriaButton';
import DeleteCategoriaButton from './buttons/DeleteCategoriaButton';
import EditItemButton from './buttons/EditItemButton';
import DeleteItemButton from './buttons/DeleteItemButton';

const controlKey = control => control && JSON.stringify([control.mode, control.epoch, control.generation, control.metadataRevision]);
const staleCursor = error => error.code === 'codex-stale-snapshot' || /cursor.*stale/i.test(error.message);
const formatCategory = key => key.replace(/_/g, ' ').split(' ').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
const singular = key => ({ lingue: 'Lingua', conoscenze: 'Conoscenza', professioni: 'Professione', abilita: 'Abilità', incantesimi: 'Incantesimo' }[key]
  || (key.endsWith('ioni') ? key.slice(0, -4) + 'one' : key.endsWith('enze') ? key.slice(0, -3) + 'a' : key.endsWith('gue') ? key.slice(0, -2) + 'a' : key.endsWith('i') ? key.slice(0, -1) + 'o' : key));

function Paging({ label, history, page, onChange, disabled }) {
  return <nav aria-label={label} className="flex items-center justify-between gap-2 mt-4 text-sm">
    <button type="button" className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40" disabled={disabled || history.length === 1} onClick={() => onChange(history.slice(0, -1))}>Precedente</button>
    <span>Pagina {history.length}</span>
    <button type="button" className="px-2 py-1 rounded bg-gray-700 disabled:opacity-40" disabled={disabled || !page?.hasMore} onClick={() => onChange([...history, page.cursor])}>Successiva</button>
  </nav>;
}

// A session boundary tears down listeners and drafts even when only the role changes.
export default function Codex() {
  const { user, userData, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-gray-900 text-white p-8">Caricamento utente...</div>;
  if (!user) return <main className="min-h-screen bg-gray-900 text-white p-8"><h1>Codex</h1><p>Accedi per consultare il Codex.</p></main>;
  return <CodexSession key={`${user.uid}:${userData?.role}`} role={userData?.role} />;
}

function CodexSession({ role }) {
  const { topInset } = useShellLayout();
  const [control, setControl] = useState(null);
  const controlRef = useRef(null);
  const [metadata, setMetadata] = useState(null);
  const [active, setActive] = useState(null);
  const [items, setItems] = useState(null);
  const [categoryHistory, setCategoryHistory] = useState([null]);
  const [itemHistory, setItemHistory] = useState([null]);
  const [error, setError] = useState('');
  const [itemError, setItemError] = useState('');
  const [controlError, setControlError] = useState('');
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const isEditor = role === 'dm' || role === 'webmaster';
  const modeKey = controlKey(control);
  const categoryCursor = categoryHistory[categoryHistory.length - 1];
  const itemCursor = itemHistory[itemHistory.length - 1];
  const activeId = active?.id;
  const activeKey = active?.legacyKey;

  useEffect(() => {
    let alive = true;
    const stop = subscribeCodexControl({ next: next => {
      if (!alive) return;
      if (controlKey(controlRef.current) !== controlKey(next)) {
        setCategoryHistory([null]); setItemHistory([null]); setMetadata(null); setItems(null); setActive(null);
      }
      controlRef.current = next;
      setControl(next); setControlError('');
    }, error: failure => { if (alive) { setControlError(`Impossibile verificare lo stato del Codex: ${failure.message}`); controlRef.current = null; setControl(null); } } });
    return () => { alive = false; controlRef.current = null; stop(); };
  }, [reload]);

  useEffect(() => {
    if (!modeKey) return undefined;
    let alive = true;
    setMetadata(null); setError('');
    const stop = subscribeCodexMetadataPage({ cursor: categoryCursor, order: 'display', pageSize: 25 }, {
      next: page => {
        if (!alive || controlKey(page.control) !== controlKey(controlRef.current)) return;
        setMetadata(page); setError('');
        setActive(previous => page.items.find(category => category.legacyKey === previous?.legacyKey) || page.items[0] || null);
      },
      error: failure => {
        if (!alive) return;
        setError(`Impossibile caricare le categorie: ${failure.message}`);
        if (categoryCursor && staleCursor(failure)) { setCategoryHistory([null]); setNotice('Categorie aggiornate: ritorno alla prima pagina.'); }
      },
    });
    return () => { alive = false; stop(); };
  }, [modeKey, categoryCursor, reload]);

  useEffect(() => {
    if (!modeKey || !activeId) { setItems(null); return undefined; }
    let alive = true;
    setItems(null); setItemError('');
    const stop = subscribeCodexItemsPage({ categoryId: activeId, categoryKey: activeKey, cursor: itemCursor, order: 'display', pageSize: 25 }, {
      next: page => {
        if (!alive || controlKey(page.control) !== controlKey(controlRef.current)) return;
        setItems(page); setItemError('');
      },
      error: failure => {
        if (!alive) return;
        setItems(null); setItemError(`Impossibile caricare gli elementi: ${failure.message}`);
        if (itemCursor && staleCursor(failure)) { setItemHistory([null]); setNotice('Categoria aggiornata: ritorno alla prima pagina.'); }
      },
    });
    return () => { alive = false; stop(); };
  }, [modeKey, activeId, activeKey, itemCursor, reload]);

  // Current compact category listener is authoritative for mutation revisions.
  const category = items?.category || active;
  const writable = isEditor && control && !control.readOnly && !controlError;
  const open = (action, selectedCategory = null, item = null) => {
    if (!writable) return;
    setDialog({ id: ++sequence.current, action, control, category: selectedCategory, item,
      legacyContent: action.startsWith('category-') ? metadata?.legacyContent : items?.legacyContent,
      categoryPage: categoryCursor, itemPage: itemCursor, activeId: active?.id });
  };
  const selectedDialogCategory = dialog?.category && (items?.category?.id === dialog.category.id ? items.category : metadata?.items.find(row => row.id === dialog.category.id));
  const selectedDialogItem = dialog?.item && items?.items.find(row => row.id === dialog.item.id);
  const dialogValid = Boolean(dialog && writable && controlKey(dialog.control) === modeKey
    && (control.source !== 'legacy' || (dialog.legacyContent === metadata?.legacyContent
      && (!dialog.action.startsWith('item-') || dialog.legacyContent === items?.legacyContent)))
    && dialog.categoryPage === categoryCursor && dialog.itemPage === itemCursor && dialog.activeId === active?.id
    && (!dialog.category || (selectedDialogCategory?.revision === dialog.category.revision && selectedDialogCategory?.legacyKey === dialog.category.legacyKey))
    && (!dialog.item || (selectedDialogItem?.revision === dialog.item.revision && selectedDialogItem?.legacyKey === dialog.item.legacyKey
      && JSON.stringify(selectedDialogItem?.value) === JSON.stringify(dialog.item.value))));
  const selectCategory = next => { setActive(next); setItems(null); setItemHistory([null]); setItemError(''); };
  const changeCategories = history => { setCategoryHistory(history); setActive(null); setItems(null); setItemHistory([null]); };

  return <div className="codex-page-container relative min-h-screen text-white">
    <CodexBackground />
    <main className="relative z-10 p-4 md:p-8 pointer-events-none">
      <h1 className="text-3xl font-bold text-center mb-8 pointer-events-auto">Codex</h1>
      {control?.readOnly && <p role="status" className="bg-gray-800 p-3 mb-4 pointer-events-auto">Codex temporaneamente in sola lettura. Puoi continuare a consultarlo.</p>}
      {notice && <p role="status" className="mb-4 pointer-events-auto">{notice}</p>}
      {(controlError || error) && <div role="alert" className="text-yellow-300 mb-4 pointer-events-auto">{controlError || error} <button onClick={() => setReload(value => value + 1)}>Ricarica</button></div>}
      {!control && !controlError && <p className="pointer-events-auto">Caricamento Codex...</p>}
      {control && <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <aside className="w-full md:w-1/4 lg:w-1/5 bg-gray-800 p-4 rounded-lg shadow-lg self-start md:sticky md:overflow-y-auto pointer-events-auto" style={{ top: `${topInset + 24}px`, maxHeight: `calc(100vh - ${topInset + 48}px)` }}>
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Categorie</h2>
          {isEditor && <AggiungiCategoriaButton disabled={!writable || !metadata} onClick={() => open('category-add')} />}
          {!metadata && !error && <p>Caricamento categorie...</p>}
          {metadata?.items.length === 0 && <p>Nessuna categoria disponibile.</p>}
          <nav aria-label="Categorie Codex"><ul className="space-y-2">{metadata?.items.map(row => <li key={row.id} className="flex items-center">
            <button type="button" aria-current={active?.id === row.id ? 'true' : undefined} onClick={() => selectCategory(row)} className={`flex-grow text-left px-3 py-2 rounded ${active?.id === row.id ? 'bg-blue-600 text-white font-medium' : 'hover:bg-gray-700 text-gray-300'}`}>{formatCategory(row.legacyKey)}</button>
            {isEditor && <DeleteCategoriaButton categoryKey={row.legacyKey} disabled={!writable} onClick={() => open('category-delete', row.id === category?.id ? category : row)} />}
          </li>)}</ul></nav>
          <Paging label="Pagine categorie" history={categoryHistory} page={metadata} onChange={changeCategories} disabled={!metadata} />
        </aside>
        <section aria-label="Elementi Codex" className="w-full md:w-3/4 lg:w-4/5 bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col pointer-events-auto">
          {active && <>
            <h2 className="text-xl mb-4">{formatCategory(active.legacyKey)}</h2>
            {isEditor && <div className="mb-4 pb-4 border-b border-gray-700"><AggiungiButton categoryDisplayNameSingular={singular(active.legacyKey)} disabled={!writable || !items} onClick={() => open('item-add', category)} /></div>}
            {itemError && <p role="alert" className="text-yellow-300">{itemError} <button onClick={() => { setItemHistory([null]); setReload(value => value + 1); }}>Ricarica</button></p>}
            {!items && !itemError && <p>Caricamento elementi...</p>}
            {items?.items.length === 0 && <p className="text-gray-400">Nessun elemento disponibile in {formatCategory(active.legacyKey)}.</p>}
            <ul className="space-y-4">{items?.items.map(item => <li key={item.id} className="p-4 rounded-md bg-gray-700 flex justify-between items-start gap-4 shadow-sm">
              <div className="flex-grow min-w-0"><h3 className="font-semibold text-lg text-blue-300 break-words">{item.legacyKey}</h3>
                {typeof item.value === 'string' && item.value.trim() !== '' && <p className="text-sm text-gray-300 mt-1 break-words whitespace-pre-line">{item.value}</p>}
                {typeof item.value !== 'string' && item.value !== null && <pre className="text-xs text-gray-400 mt-2 bg-gray-800/50 p-2 rounded overflow-x-auto">{JSON.stringify(item.value, null, 2)}</pre>}
              </div>
              {isEditor && <div className="flex-shrink-0 flex items-center space-x-2 pt-1"><EditItemButton itemKey={item.legacyKey} disabled={!writable} onClick={() => open('item-edit', category, item)} /><DeleteItemButton itemKey={item.legacyKey} disabled={!writable} onClick={() => open('item-delete', category, item)} /></div>}
            </li>)}</ul>
            <Paging label="Pagine elementi" history={itemHistory} page={items} onChange={history => { setItems(null); setItemHistory(history); }} disabled={!items} />
          </>}
          {!active && <p>Seleziona una categoria dal menu.</p>}
        </section>
      </div>}
    </main>
    {dialog && <CodexDialog key={dialog.id} context={dialog} valid={dialogValid} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setNotice('Modifica salvata.'); }} />}
  </div>;
}
