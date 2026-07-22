import React, { useEffect, useState } from 'react';
import {
  deleteApp,
  getApps,
  initializeApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  collection,
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  documentId,
  enableNetwork,
  getDocs,
  getDocsFromCache,
  initializeFirestore,
  labelFirestoreTarget,
  limit,
  onSnapshot as subscribeToSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  terminate,
  where,
} from './firestore';

const EXPERIMENT_MARKER = '__FND_FIRESTORE_PERSISTENCE_EXPERIMENT__';
const EXPERIMENT_CLEANUP_MARKER = '__FND_FIRESTORE_PERSISTENCE_EXPERIMENT_CLEANUP__';
const PROJECT_ID = 'demo-fnd-perf';
const APP_NAME = 'fnd-firestore-persistence-experiment';
const MINIMUM_CACHE_BYTES = 1024 * 1024;
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 8080;
const PASSWORD = 'PerfTest!123';
const CLEANUP_STAGE_TIMEOUT_MS = 15_000;
const ALLOWED_ACCOUNTS = new Set([
  'perf-player',
  'perf-dm',
  'perf-webmaster',
]);
const ALLOWED_COLLECTIONS = new Set([
  'user_directory',
  'users',
  'items',
  'foes',
  'echi_npcs',
]);
const METRIC_KEY_BY_COLLECTION = Object.freeze({
  user_directory: 'experiment.directory.list.v1',
  users: 'experiment.users.list.v1',
  items: 'experiment.items.list.v1',
  foes: 'experiment.foes.list.v1',
  echi_npcs: 'experiment.echi-npcs.list.v1',
});

const firebaseConfig = Object.freeze({
  apiKey: 'demo-api-key',
  authDomain: 'demo-fnd-perf.firebaseapp.com',
  projectId: PROJECT_ID,
  storageBucket: 'demo-fnd-perf.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:persistence-experiment',
});

const cleanupPromises = new WeakMap();

export const cleanupPersistenceExperimentBridge = (bridge) => {
  if (!bridge || typeof bridge !== 'object' || typeof bridge.cleanup !== 'function') {
    return Promise.resolve({ alreadyCleaned: true, cleared: false });
  }
  const existing = cleanupPromises.get(bridge);
  if (existing) return existing;
  const cleanup = Promise.resolve()
    .then(() => bridge.cleanup({ clearPersistence: true }))
    .catch((error) => {
      if (cleanupPromises.get(bridge) === cleanup) cleanupPromises.delete(bridge);
      throw error;
    });
  cleanupPromises.set(bridge, cleanup);
  return cleanup;
};

const assertExperimentEnvironment = () => {
  if (process.env.REACT_APP_FND_PERF !== '1') {
    throw new Error('Firestore persistence experiment is unavailable outside performance builds.');
  }
  if (process.env.REACT_APP_FND_PERF_PROJECT_ID !== PROJECT_ID) {
    throw new Error(`Firestore persistence experiment requires ${PROJECT_ID}.`);
  }
};

const estimatedBytes = (value) => {
  const json = JSON.stringify(value, (_key, candidate) => {
    if (candidate?.toDate && typeof candidate.toDate === 'function') {
      return candidate.toDate().toISOString();
    }
    return candidate;
  });
  return new TextEncoder().encode(json).byteLength;
};

const summarizeSnapshot = (snapshot) => {
  const documents = snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() }));
  return {
    count: documents.length,
    estimatedBytes: estimatedBytes(documents),
    fromCache: snapshot.metadata.fromCache,
    ids: documents.map(({ id }) => id),
  };
};

const buildBridge = () => {
  assertExperimentEnvironment();
  const existingApp = getApps().find((candidate) => candidate.name === APP_NAME);
  const app = existingApp || initializeApp(firebaseConfig, APP_NAME);
  if (app.options.projectId !== PROJECT_ID) {
    throw new Error(`Refusing persistence experiment project ${String(app.options.projectId)}.`);
  }
  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
  const firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({
      cacheSizeBytes: MINIMUM_CACHE_BYTES,
      tabManager: persistentMultipleTabManager(),
    }),
  });
  connectFirestoreEmulator(firestore, FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);

  const listeners = new Map();
  const listenerStates = new Map();
  let networkEnabled = true;
  let cleanedUp = false;
  let cleanupInFlight = null;
  let cleanupResult = null;

  const stopListener = (listenerId) => {
    const unsubscribe = listeners.get(listenerId);
    if (unsubscribe) unsubscribe();
    listeners.delete(listenerId);
  };

  const bridge = {
    marker: EXPERIMENT_MARKER,
    projectId: PROJECT_ID,
    cacheSizeBytes: MINIMUM_CACHE_BYTES,
    persistenceEnabledForExperimentOnly: true,
    persistenceEnabledForNormalApplication: false,
    async signIn(uid) {
      if (!ALLOWED_ACCOUNTS.has(uid)) throw new TypeError('Unsupported performance account.');
      if (auth.currentUser) await signOut(auth);
      const credential = await signInWithEmailAndPassword(auth, `${uid}@example.test`, PASSWORD);
      return { signedIn: true, uid: credential.user.uid };
    },
    async signOut() {
      if (auth.currentUser) await signOut(auth);
      return { signedIn: false };
    },
    async setNetwork(enabled) {
      if (enabled) await enableNetwork(firestore);
      else await disableNetwork(firestore);
      networkEnabled = Boolean(enabled);
      return { networkEnabled };
    },
    async readQuery({ collectionName, role = null, maxDocuments = 50, source = 'default' }) {
      if (!ALLOWED_COLLECTIONS.has(collectionName)) throw new TypeError('Unsupported experiment collection.');
      if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 2000) {
        throw new TypeError('Experiment query limit must be between 1 and 2000.');
      }
      const constraints = [];
      if (collectionName === 'user_directory') {
        if (role !== null && !['player', 'dm', 'webmaster'].includes(role)) {
          throw new TypeError('Unsupported directory role.');
        }
        if (role !== null) constraints.push(where('role', '==', role));
        constraints.push(orderBy('normalizedLabel', 'asc'), orderBy(documentId(), 'asc'));
      }
      constraints.push(limit(maxDocuments));
      const target = labelFirestoreTarget(
        query(collection(firestore, collectionName), ...constraints),
        METRIC_KEY_BY_COLLECTION[collectionName],
        'experiment'
      );
      const snapshot = source === 'cache'
        ? await getDocsFromCache(target)
        : await getDocs(target);
      return summarizeSnapshot(snapshot);
    },
    startDocumentListener({ listenerId, documentPath }) {
      if (typeof listenerId !== 'string' || !listenerId || listeners.has(listenerId)) {
        throw new TypeError('Experiment listener IDs must be unique non-empty strings.');
      }
      const segments = String(documentPath || '').split('/').filter(Boolean);
      if (segments.length !== 2 || segments[0] !== 'users') {
        throw new TypeError('Experiment document listeners are restricted to users/{uid}.');
      }
      const unsubscribe = subscribeToSnapshot(
        labelFirestoreTarget(
          doc(firestore, ...segments),
          'experiment.document.subscribe.v1',
          'experiment'
        ),
        (snapshot) => {
          const previous = listenerStates.get(listenerId);
          listenerStates.set(listenerId, {
            revision: (previous?.revision || 0) + 1,
            exists: snapshot.exists(),
            fromCache: snapshot.metadata.fromCache,
            data: snapshot.exists() ? snapshot.data() : null,
          });
        },
        (error) => {
          listenerStates.set(listenerId, {
            revision: (listenerStates.get(listenerId)?.revision || 0) + 1,
            error: { code: error.code || 'unknown', message: error.message },
          });
        }
      );
      listeners.set(listenerId, unsubscribe);
      return { listenerId };
    },
    getListenerState(listenerId) {
      return listenerStates.get(listenerId) || null;
    },
    stopListener(listenerId) {
      stopListener(listenerId);
      return { stopped: true };
    },
    async cleanup({ clearPersistence = true } = {}) {
      if (cleanedUp) return { ...cleanupResult, alreadyCleaned: true };
      if (cleanupInFlight) return cleanupInFlight;
      cleanupInFlight = (async () => {
        const errors = [];
        const recordError = (stage, error) => {
          const normalized = { stage, code: error?.code || 'unknown', message: error?.message || String(error) };
          errors.push(normalized);
          return normalized;
        };
        const runCleanupStage = async (stage, operation) => {
          let timeoutId;
          const operationPromise = Promise.resolve().then(operation);
          // Keep observing a timed-out SDK operation so it cannot become an
          // unhandled rejection while later cleanup stages proceed.
          operationPromise.catch(() => {});
          try {
            return await Promise.race([
              operationPromise,
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  const timeoutError = new Error(`${stage} timed out after ${CLEANUP_STAGE_TIMEOUT_MS} ms.`);
                  timeoutError.code = 'cleanup-timeout';
                  reject(timeoutError);
                }, CLEANUP_STAGE_TIMEOUT_MS);
              }),
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
        };
        for (const listenerId of [...listeners.keys()]) {
          try {
            stopListener(listenerId);
          } catch (error) {
            recordError('listener-stop', error);
          }
        }
        let terminated = false;
        try {
          await runCleanupStage('terminate', () => terminate(firestore));
          terminated = true;
        } catch (error) {
          recordError('terminate', error);
        }
        let cleared = false;
        let clearError = null;
        if (clearPersistence) {
          try {
            await runCleanupStage('clear-indexed-db', () => clearIndexedDbPersistence(firestore));
            cleared = true;
          } catch (error) {
            clearError = recordError('clear-indexed-db', error);
          }
        }
        let appDeleted = false;
        try {
          await runCleanupStage('delete-app', () => deleteApp(app));
          appDeleted = true;
        } catch (error) {
          recordError('delete-app', error);
        }
        cleanupResult = {
          appDeleted,
          cleared,
          clearError,
          errors,
          terminated,
        };
        cleanedUp = true;
        return cleanupResult;
      })();
      try {
        return await cleanupInFlight;
      } finally {
        cleanupInFlight = null;
      }
    },
  };
  return bridge;
};

export default function FirestorePersistenceExperiment() {
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState('');

  useEffect(() => {
    let bridge;
    let cancelled = false;
    const initialize = async () => {
      try {
        const pendingCleanup = window[EXPERIMENT_CLEANUP_MARKER];
        if (pendingCleanup) await pendingCleanup.catch(() => {});
        if (cancelled) return;
        bridge = buildBridge();
        window[EXPERIMENT_MARKER] = bridge;
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setStatus('error');
        setError(caught?.message || String(caught));
      }
    };
    initialize();
    return () => {
      cancelled = true;
      if (window[EXPERIMENT_MARKER] === bridge) delete window[EXPERIMENT_MARKER];
      if (bridge) {
        const cleanup = cleanupPersistenceExperimentBridge(bridge);
        window[EXPERIMENT_CLEANUP_MARKER] = cleanup;
        const clearCleanupMarker = () => {
          if (window[EXPERIMENT_CLEANUP_MARKER] === cleanup) delete window[EXPERIMENT_CLEANUP_MARKER];
        };
        cleanup.then(clearCleanupMarker, clearCleanupMarker);
      }
    };
  }, []);

  return (
    <main aria-label="Firestore persistence experiment" data-testid="firestore-persistence-experiment">
      <h1>Firestore persistence experiment</h1>
      <p data-testid="firestore-persistence-status">{status}</p>
      {error ? <pre role="alert">{error}</pre> : null}
    </main>
  );
}
