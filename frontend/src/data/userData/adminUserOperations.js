import { getCallable } from '../functions/callableRegistry';
import { callBackendOperationAndWait, getBackendOperationView } from '../functions/backendOperationClient';
import { runWithDurableOperationIntent, listDurableOperationIntents, resumeDurableOperationIntent } from '../functions/backendOperationIntentStore';

const deleteUser = getCallable('deleteUser');
const getStatus = getCallable('getBackendOperationStatus');
const resume = getCallable('resumeBackendOperation');

const runDeletion = async (callable, payload, { operationId, signal, onProgress }) => {
  let stopped = false;
  let statusPending = false;
  // The awaited callable performs cleanup. Poll only its durable receipt;
  // transport failures retain the same intent for a later explicit retry.
  const poll = async () => {
    if (stopped || signal?.aborted || statusPending) return;
    statusPending = true;
    try {
      const response = await getStatus({ operationId });
      if (!stopped && !signal?.aborted) onProgress?.(getBackendOperationView(response));
    } catch (error) {
      // A first poll may race creation, and polling cannot turn a transport
      // failure into deletion success. The awaited invocation decides below.
    } finally {
      statusPending = false;
    }
  };
  const timer = setInterval(poll, 400);
  const stop = () => { stopped = true; clearInterval(timer); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return await callBackendOperationAndWait(callable, payload, {
      operationId, signal, onProgress,
    });
  } finally {
    stop();
    signal?.removeEventListener('abort', stop);
  }
};

export const deleteAdminUser = ({ actorUid, userId, signal, onProgress }) => {
  if (actorUid === userId) return Promise.reject(new Error('Non puoi eliminare il tuo account.'));
  return runWithDurableOperationIntent({
    actorUid, kind: 'delete-user', intent: { userId },
    invoke: (operationId) => runDeletion(deleteUser, { userId }, { operationId, signal, onProgress }),
  });
};

export const listAdminUserDeletions = (actorUid, signal) => listDurableOperationIntents({
  actorUid, kind: 'delete-user', signal,
  verifyLegacyOwnership: async (operationId) => {
    try {
      return getBackendOperationView(await getStatus({operationId}))?.kind === 'delete-user';
    } catch (error) {
      if (error?.code?.replace(/^functions\//, '') === 'not-found') return false;
      throw error;
    }
  },
});

export const resumeAdminUserDeletion = ({actorUid, operationId, signal, onProgress}) => resumeDurableOperationIntent({
  actorUid, kind: 'delete-user', operationId,
  invoke: (id) => runDeletion(resume, {}, {operationId: id, signal, onProgress}),
});
