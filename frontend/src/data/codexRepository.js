import { db } from '../components/firebaseConfig';
import {
  doc,
  getDoc,
  labelFirestoreTarget,
  onSnapshot,
  updateDoc,
} from '../performance/firestore';
import {
  getCached,
  invalidate,
  RepositorySessionChangedError,
  subscribeShared,
} from './repositoryRuntime';

const CODEX_DOCUMENT_ID = 'codex';
const CODEX_GET_INSTANCE_KEY = 'codex:document:get';
const CODEX_SUBSCRIPTION_INSTANCE_KEY = 'codex:document:subscribe';
const MAX_CODEX_ATTEMPTS_ACROSS_SESSION_TRANSITIONS = 3;

const METRIC_KEYS = Object.freeze({
  get: 'codex.document.get.v1',
  subscribe: 'codex.document.subscribe.v1',
  patch: 'codex.document.patch.v1',
});

const normalizeCodexSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot.exists !== 'function' || !snapshot.exists()) return null;
  const data = typeof snapshot.data === 'function' ? snapshot.data() : null;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
};

const codexTarget = (metricKey) => labelFirestoreTarget(
  doc(db, 'utils', CODEX_DOCUMENT_ID),
  metricKey
);

export const getCodex = async () => {
  for (let attempt = 1; attempt <= MAX_CODEX_ATTEMPTS_ACROSS_SESSION_TRANSITIONS; attempt += 1) {
    try {
      return await getCached({
        metricKey: METRIC_KEYS.get,
        instanceKey: CODEX_GET_INSTANCE_KEY,
        load: async () => normalizeCodexSnapshot(await getDoc(codexTarget(METRIC_KEYS.get))),
      });
    } catch (error) {
      if (
        !(error instanceof RepositorySessionChangedError)
        || !error.retryableTransition
        || attempt === MAX_CODEX_ATTEMPTS_ACROSS_SESSION_TRANSITIONS
      ) throw error;
    }
  }
  throw new Error('Unreachable Codex retry state.');
};

export const subscribeCodex = (observer) => subscribeShared({
  metricKey: METRIC_KEYS.subscribe,
  instanceKey: CODEX_SUBSCRIPTION_INSTANCE_KEY,
  listen: ({ next, error }) => onSnapshot(
    codexTarget(METRIC_KEYS.subscribe),
    (snapshot) => next(normalizeCodexSnapshot(snapshot)),
    error
  ),
}, observer);

export const patchCodex = async (fields) => {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('Codex patches must be Firestore field maps.');
  }

  const result = await updateDoc(codexTarget(METRIC_KEYS.patch), fields);
  invalidate(CODEX_GET_INSTANCE_KEY);
  return result;
};
