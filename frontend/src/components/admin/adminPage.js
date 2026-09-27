import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { getPossibleLists } from '../../data/configRepository';
import { getAdminUsersPage } from '../../data/userData/userDataCommands';
import { getCallable } from '../../data/functions/callableRegistry';
import { deleteAdminUser } from '../../data/userData/adminUserOperations';
import { normalizeDirectorySearch } from '../../data/userDirectoryQueryFactory';
import AdminUserRow from './AdminUserRow';
import AdminDeletionRecovery from './AdminDeletionRecovery';

const DEFAULT_ROLES = ['player', 'dm', 'webmaster'];
const updateUserRole = getCallable('updateUserRole');
const normalizeRole = (value) => {
  const role = String(value || '').trim().toLowerCase();
  return role === 'players' ? 'player' : role;
};
const emptyPage = () => ({ items: [], cursor: null, hasMore: false, search: '', index: 0, history: [null] });

const AdminPage = () => {
  const { user, userData } = useAuth();
  const actorUid = user?.uid || '';
  const isWebmaster = userData?.role === 'webmaster';
  const identity = `${actorUid}:${isWebmaster}`;
  const currentIdentity = useRef(identity);
  const identityEpoch = useRef(0);
  if (currentIdentity.current !== identity) identityEpoch.current += 1;
  currentIdentity.current = identity;
  const [page, setPage] = useState(emptyPage);
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [draftSearch, setDraftSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState({});
  const [pending, setPending] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [operation, setOperation] = useState(null);
  const [deletionRevision, setDeletionRevision] = useState(0);
  const mounted = useRef(false);
  const pageRequest = useRef(0);
  const mutationRevision = useRef(0);
  const confirmedMutations = useRef(new Map());
  const lastRequest = useRef(null);
  const activeRequest = useRef('');
  const inFlight = useRef(new Map());
  const deleteController = useRef(null);
  const valid = useCallback((owner, epoch) => mounted.current && currentIdentity.current === owner && identityEpoch.current === epoch, []);

  const loadPage = useCallback(async (request) => {
    if (!actorUid || !isWebmaster) return;
    const key = JSON.stringify(request);
    if (activeRequest.current === key) return;
    activeRequest.current = key;
    lastRequest.current = request;
    const generation = ++pageRequest.current;
    const requestedRevision = mutationRevision.current;
    const owner = `${actorUid}:${isWebmaster}`;
    const ownerEpoch = identityEpoch.current;
    setLoading(true);
    setError('');
    try {
      const result = await getAdminUsersPage({ schemaVersion: 2, limit: 10, search: request.search, cursor: request.cursor });
      if (!valid(owner, ownerEpoch) || generation !== pageRequest.current) return;
      setPage((previous) => {
        const existing = new Map(previous.items.map((entry) => [entry.id, entry]));
        const items = (result.items || []).filter((entry) => {
          const mutation = confirmedMutations.current.get(entry.id);
          return !(mutation?.deleted && mutation.revision > requestedRevision);
        }).map((entry) => {
          const mutation = confirmedMutations.current.get(entry.id);
          if (mutation?.revision > requestedRevision && mutation.role) entry = { ...entry, role: mutation.role };
          const next = { ...entry, role: normalizeRole(entry.role) };
          const old = existing.get(entry.id);
          return old && Object.keys(next).every((key) => old[key] === next[key]) ? old : next;
        });
        return { ...request, items, cursor: result.cursor, hasMore: result.hasMore };
      });
    } catch (failure) {
      if (valid(owner, ownerEpoch) && generation === pageRequest.current) setError('Impossibile caricare gli utenti. Riprova.');
    } finally {
      if (valid(owner, ownerEpoch) && generation === pageRequest.current) {
        setLoading(false);
        activeRequest.current = '';
      }
    }
  }, [actorUid, isWebmaster, valid]);

  useEffect(() => {
    mounted.current = true;
    const owner = identity;
    const ownerEpoch = identityEpoch.current;
    setPage(emptyPage());
    setDraftSearch('');
    setPending({});
    setRowErrors({});
    setDeleting(null);
    setError('');
    inFlight.current.clear();
    confirmedMutations.current.clear();
    activeRequest.current = '';
    if (actorUid && isWebmaster) {
      loadPage({ search: '', cursor: null, index: 0, history: [null] });
      getPossibleLists().then((data) => {
        if (!valid(owner, ownerEpoch)) return;
        const list = [...new Set((data?.ruoli || []).map(normalizeRole))].filter((role) => DEFAULT_ROLES.includes(role));
        setRoles(list.length ? list : DEFAULT_ROLES);
      }).catch(() => { if (valid(owner, ownerEpoch)) setRoles(DEFAULT_ROLES); });
    }
    return () => {
      mounted.current = false;
      identityEpoch.current += 1;
      pageRequest.current += 1;
      deleteController.current?.abort();
    };
  }, [actorUid, isWebmaster, identity, loadPage, valid]);

  const changeRole = useCallback(async (uid, role) => {
    if (uid === actorUid || !isWebmaster || inFlight.current.has(uid)) return;
    const owner = `${actorUid}:${isWebmaster}`;
    const ownerEpoch = identityEpoch.current;
    const token = {};
    inFlight.current.set(uid, token);
    setPending((previous) => ({ ...previous, [uid]: 'role' }));
    setRowErrors((previous) => ({ ...previous, [uid]: '' }));
    try {
      const response = await updateUserRole({ userId: uid, role: normalizeRole(role) });
      if (!valid(owner, ownerEpoch) || inFlight.current.get(uid) !== token) return;
      const nextRole = normalizeRole(response?.data?.role || role);
      confirmedMutations.current.set(uid, { role: nextRole, revision: ++mutationRevision.current });
      setPage((previous) => ({ ...previous, items: previous.items.map((entry) => entry.id === uid ? { ...entry, role: nextRole } : entry) }));
    } catch (failure) {
      if (valid(owner, ownerEpoch) && inFlight.current.get(uid) === token) setRowErrors((previous) => ({ ...previous, [uid]: 'Aggiornamento non riuscito. Seleziona il ruolo per riprovare.' }));
    } finally {
      if (inFlight.current.get(uid) === token) {
        inFlight.current.delete(uid);
        if (valid(owner, ownerEpoch)) setPending((previous) => ({ ...previous, [uid]: null }));
      }
    }
  }, [actorUid, isWebmaster, valid]);

  const openDelete = useCallback((target) => {
    if (target.id === actorUid || inFlight.current.has(target.id)) return;
    setDeleting(target);
    setConfirmation('');
    setDeleteError('');
    setOperation(null);
  }, [actorUid]);

  const removeUser = async () => {
    if (!deleting || confirmation !== 'ELIMINA' || deleting.id === actorUid || !isWebmaster || inFlight.current.has(deleting.id)) return;
    const target = deleting;
    const owner = identity;
    const ownerEpoch = identityEpoch.current;
    const controller = new AbortController();
    deleteController.current = controller;
    inFlight.current.set(target.id, controller);
    setPending((previous) => ({ ...previous, [target.id]: 'delete' }));
    setDeleteError('');
    try {
      const result = await deleteAdminUser({ actorUid, userId: target.id, signal: controller.signal,
        onProgress: (next) => { if (valid(owner, ownerEpoch) && !controller.signal.aborted) setOperation(next); } });
      if (!valid(owner, ownerEpoch) || controller.signal.aborted) return;
      if (result.status !== 'completed') throw new Error('Eliminazione non completata.');
      confirmedMutations.current.set(target.id, { deleted: true, revision: ++mutationRevision.current });
      setPage((previous) => ({ ...previous, items: previous.items.filter((entry) => entry.id !== target.id) }));
      setDeleting(null);
    } catch (failure) {
      if (valid(owner, ownerEpoch) && !controller.signal.aborted && failure.name !== 'AbortError') setDeleteError('Eliminazione non completata. Riprova per riprendere la stessa operazione.');
    } finally {
      if (inFlight.current.get(target.id) === controller) {
        inFlight.current.delete(target.id);
        if (valid(owner, ownerEpoch)) {
          setPending((previous) => ({ ...previous, [target.id]: null }));
          setDeletionRevision((previous) => previous + 1);
        }
      }
    }
  };

  if (!isWebmaster || !actorUid) return <p role="alert">Accesso riservato ai webmaster.</p>;
  return <main className="min-h-screen bg-gray-900 text-white p-8">
    <h1 className="text-3xl font-bold mb-6">Pannello di Amministrazione</h1>
    <AdminDeletionRecovery key={actorUid} actorUid={actorUid} revision={deletionRevision}
      onRecovered={() => loadPage(lastRequest.current)} />
    <h2 className="text-2xl mb-4">Gestione Utenti</h2>
    <form className="flex gap-2 mb-4" onSubmit={(event) => {
      event.preventDefault();
      loadPage({ search: normalizeDirectorySearch(draftSearch), cursor: null, index: 0, history: [null] });
    }}>
      <input aria-label="Cerca nome personaggio" maxLength={200} value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} className="bg-gray-700 rounded p-2" />
      <button className="bg-blue-700 rounded px-4">Cerca</button>
    </form>
    {loading && <p role="status">Caricamento utenti...</p>}
    {error && <div role="alert" className="text-red-300">{error} <button onClick={() => loadPage(lastRequest.current)}>Riprova</button></div>}
    <div className="overflow-x-auto"><table className="w-full bg-gray-800">
      <thead><tr>{['Character ID', 'Username', 'Email', 'Ruolo Attuale', 'Cambia Ruolo', 'Azioni'].map((label) => <th key={label} className="px-4 py-2 text-left">{label}</th>)}</tr></thead>
      <tbody>{page.items.map((entry) => <AdminUserRow key={entry.id} user={entry} roles={roles} actorUid={actorUid}
        pending={pending[entry.id]} error={rowErrors[entry.id]} onRoleChange={changeRole} onDelete={openDelete} />)}</tbody>
    </table></div>
    {!loading && !page.items.length && <p>Nessun utente trovato.</p>}
    <nav aria-label="Pagine utenti" className="flex items-center gap-4 mt-4">
      <button disabled={loading || page.index === 0} onClick={() => loadPage({ search: page.search, cursor: page.history[page.index - 1], index: page.index - 1, history: page.history })}>Precedente</button>
      <span>Pagina {page.index + 1}</span>
      <button disabled={loading || !page.hasMore} onClick={() => loadPage({ search: page.search, cursor: page.cursor, index: page.index + 1, history: [...page.history.slice(0, page.index + 1), page.cursor] })}>Successiva</button>
    </nav>
    {deleting && <div role="dialog" aria-modal="true" aria-label="Elimina Utente" className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded max-w-md">
        <h2 className="text-xl mb-4">Elimina Utente</h2>
        <p>Eliminare {deleting.characterId || deleting.email}? Questa azione è irreversibile.</p>
        <label>Per confermare, digita ELIMINA:
          <input aria-label="Conferma eliminazione" value={confirmation} disabled={Boolean(pending[deleting.id])} onChange={(event) => setConfirmation(event.target.value)} className="bg-gray-700 p-2 my-4 w-full" />
        </label>
        {pending[deleting.id] && <p role="status">Eliminazione in corso{operation ? `: ${operation.progress.processed}/${operation.progress.planned}` : '...'}</p>}
        {deleteError && <p role="alert" className="text-red-300">{deleteError}</p>}
        <div className="flex gap-4 mt-4"><button disabled={Boolean(pending[deleting.id])} onClick={() => setDeleting(null)}>Annulla</button>
          <button onClick={removeUser} disabled={confirmation !== 'ELIMINA' || Boolean(pending[deleting.id])} className="bg-red-700 rounded p-2 disabled:opacity-50">{deleteError ? 'Riprova eliminazione' : 'Elimina Utente'}</button></div>
      </div>
    </div>}
  </main>;
};
export default AdminPage;
