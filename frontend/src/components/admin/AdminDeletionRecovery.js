import React, { useEffect, useRef, useState } from 'react';
import { listAdminUserDeletions, resumeAdminUserDeletion } from '../../data/userData/adminUserOperations';

const RecoveryAction = ({actorUid, receipt, onCompleted}) => {
  const controller = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState(null);
  useEffect(() => () => controller.current?.abort(), []);
  const resume = async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      await resumeAdminUserDeletion({actorUid, operationId: receipt.operationId, signal: request.signal,
        onProgress: (next) => { if (!request.signal.aborted) setOperation(next); }});
      if (!request.signal.aborted) onCompleted(receipt.operationId);
    } catch (failure) {
      if (!request.signal.aborted) setError('Eliminazione non completata. Riprova per riprendere la stessa operazione.');
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  return <li className="rounded bg-gray-800 p-3">
    <p>Eliminazione avviata il {new Date(receipt.createdAt).toLocaleString('it-IT')}</p>
    {busy && <p role="status">Eliminazione in corso{operation?.progress ? `: ${operation.progress.processed}/${operation.progress.planned}` : '...'}</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <button disabled={busy} onClick={resume} className="mt-2 rounded bg-red-700 p-2 disabled:opacity-50">Riprendi eliminazione</button>
  </li>;
};

// This component is keyed by actor in AdminPage. Unmounting aborts every
// recovery observer, including an A -> B -> A authentication transition.
const AdminDeletionRecovery = ({actorUid, revision, onRecovered}) => {
  const [receipts, setReceipts] = useState([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setError('');
    listAdminUserDeletions(actorUid, request.signal).then((entries) => {
      if (!request.signal.aborted) setReceipts(entries);
    }).catch(() => {
      if (!request.signal.aborted) setError('Impossibile recuperare le eliminazioni avviate in questa sessione.');
    });
    return () => request.abort();
  }, [actorUid, revision, reload]);
  if (!receipts.length && !error) return null;
  return <section aria-label="Eliminazioni da verificare" className="mb-6">
    <h2 className="text-xl mb-2">Eliminazioni da verificare</h2>
    <p className="mb-2">Puoi riprendere le eliminazioni avviate in questa sessione anche se l’utente non compare più nell’elenco.</p>
    {error && <p role="alert">{error} <button onClick={() => setReload((value) => value + 1)}>Riprova recupero</button></p>}
    <ul className="space-y-2">{receipts.map((receipt) => <RecoveryAction key={receipt.operationId} actorUid={actorUid} receipt={receipt}
      onCompleted={(operationId) => {
        setReceipts((previous) => previous.filter((entry) => entry.operationId !== operationId));
        onRecovered();
      }} />)}</ul>
  </section>;
};

export default AdminDeletionRecovery;
