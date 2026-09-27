import React, { useEffect, useRef, useState } from 'react';
import { mutateCodex } from '../../data/codexRepository';

export const normalizeCategoryName = name => name.trim().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
const inputClass = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white disabled:opacity-50';

// One mounted action context owns all drafts and pending/error state.
export default function CodexDialog({ context, valid, onClose, onSaved }) {
  const { action, category, item } = context;
  const deleting = action.endsWith('-delete');
  const addingCategory = action === 'category-add';
  const structured = action === 'item-edit' && typeof item.value !== 'string';
  const original = action === 'item-edit' ? (structured ? JSON.stringify(item.value, null, 2) : item.value) : '';
  const [name, setName] = useState('');
  const [description, setDescription] = useState(original);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const invalidated = useRef(false);
  if (!valid) invalidated.current = true;
  const usable = valid && !invalidated.current;
  const current = useRef(usable);
  current.current = usable && !conflict;
  const mounted = useRef(true);
  const dialogRef = useRef(null);
  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => { mounted.current = false; previousFocus?.focus?.(); };
  }, []);
  const close = () => { if (!busy.current) onClose(); };
  const submit = async event => {
    event.preventDefault();
    if (busy.current || !current.current) return;
    let legacyKey = addingCategory ? normalizeCategoryName(name) : name.trim();
    let value = description.trim();
    if (addingCategory && legacyKey.length < 2) { setError('Il nome della categoria deve contenere almeno 2 caratteri.'); return; }
    if (action === 'item-add' && !legacyKey) { setError('Il nome non può essere vuoto.'); return; }
    if (!deleting && !addingCategory && !value) { setError('La descrizione non può essere vuota.'); return; }
    if (structured) {
      try { value = JSON.parse(description); }
      catch (_) { setError('Inserisci un valore JSON valido: il tipo originale verrà preservato.'); return; }
      if (typeof value !== typeof item.value || Array.isArray(value) !== Array.isArray(item.value) || (value === null) !== (item.value === null)) {
        setError('Mantieni il tipo del valore originale.'); return;
      }
    }
    busy.current = true; setPending(true); setError('');
    try {
      await mutateCodex({ ...context, legacyKey, value }, () => mounted.current && current.current);
      if (mounted.current) onSaved();
    } catch (failure) {
      if (mounted.current) {
        setError(`Impossibile salvare: ${failure.message}`);
        // Conflicts and uncertain outcomes require a new explicit action context.
        setConflict(true);
      }
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  const title = addingCategory ? 'Crea Nuova Categoria' : action === 'category-delete' ? `Elimina categoria: ${category.legacyKey}`
    : action === 'item-add' ? `Aggiungi elemento: ${category.legacyKey}` : action === 'item-edit' ? `Modifica Descrizione: ${item.legacyKey}` : `Elimina: ${item.legacyKey}`;
  const keyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  return <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="codex-dialog-title" tabIndex={-1} ref={dialogRef} onKeyDown={keyDown} className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md text-white max-h-[90vh] overflow-y-auto">
      <h2 id="codex-dialog-title" className="text-xl font-semibold mb-4">{title}</h2>
      <form onSubmit={submit}>
        {action.endsWith('-add') && <label className="block mb-4">{addingCategory ? 'Nome Categoria' : 'Nome'}<input className={inputClass} value={name} onChange={event => setName(event.target.value)} disabled={pending || !usable || conflict} /></label>}
        {!addingCategory && !deleting && <label className="block mb-4">{structured ? 'Valore JSON' : 'Descrizione'}<textarea rows={6} className={inputClass} value={description} onChange={event => setDescription(event.target.value)} disabled={pending || !usable || conflict} /></label>}
        {deleting && <p className="mb-4">Confermi l’eliminazione di “{item?.legacyKey || category.legacyKey}”?{action === 'category-delete' && ` Verranno eliminati tutti i ${category.itemCount} elementi della categoria.`}</p>}
        {error && <p role="alert" className="text-red-300 mb-4">{error}</p>}
        {(!usable || conflict) && <p role="status" className="text-yellow-300 mb-4">I dati o la sessione sono cambiati. Chiudi e riapri il dialogo per una nuova azione.</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={close} disabled={pending} className="py-2 px-4 bg-gray-600 rounded disabled:opacity-50">Annulla</button>
          <button type="submit" disabled={pending || !usable || conflict || (action === 'item-edit' && description === original)} className={`py-2 px-4 rounded disabled:opacity-50 ${deleting ? 'bg-red-600' : 'bg-blue-600'}`}>{pending ? 'Salvataggio...' : deleting ? 'Elimina' : 'Salva'}</button></div>
      </form>
    </div>
  </div>;
}
