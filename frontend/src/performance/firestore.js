import * as firestore from 'firebase/firestore';
import {
  beginRouteAsyncWork,
  isPerformanceEnabled,
  recordPerfEvent,
  registerActiveListener,
  withAsyncResourceOwner,
} from './runtime';
import { assertFirestoreMetricKey } from '../data/telemetryKeys';

const performanceTargetMetadata = new WeakMap();
const runFirestoreTransport = (operation) => (
  withAsyncResourceOwner('firestore-transport', operation)
);

export const labelFirestoreTarget = (target, label, ownership = 'route') => {
  const metricKey = assertFirestoreMetricKey(label);
  if (target && typeof target === 'object') {
    performanceTargetMetadata.set(target, { label: metricKey, ownership });
  }
  return target;
};

export * from 'firebase/firestore';

// CRA does not consistently surface star re-exports from Firebase's conditional
// package exports. Keep the uninstrumented constructors/query helpers explicit.
export const {
  Bytes,
  CACHE_SIZE_UNLIMITED,
  FieldPath,
  FieldValue,
  GeoPoint,
  Timestamp,
  and,
  arrayRemove,
  arrayUnion,
  clearIndexedDbPersistence,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteField,
  disableNetwork,
  doc,
  documentId,
  enableNetwork,
  endAt,
  endBefore,
  getFirestore,
  increment,
  initializeFirestore,
  limit,
  limitToLast,
  memoryLocalCache,
  namedQuery,
  or,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  startAfter,
  startAt,
  terminate,
  waitForPendingWrites,
  where,
} = firestore;

const canonicalizePath = (pathValue) => {
  const segments = String(pathValue || '').split('/').filter(Boolean);
  return segments.map((segment, index) => (index % 2 === 1 ? ':id' : segment)).join('/') || 'unknown';
};

const describeTarget = (target) => {
  if (typeof target?.path === 'string') return canonicalizePath(target.path);
  const internalPath = target?._query?.path?.canonicalString?.()
    || target?._query?.path?.toString?.()
    || target?.type
    || 'query';
  return canonicalizePath(internalPath);
};

const legacyMetricKey = (target, operation) => {
  const canonicalPath = describeTarget(target)
    .split('/')
    .filter(Boolean)
    .map((segment) => (
      segment === ':id'
        ? 'document'
        : segment.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'unknown'
    ))
    .join('.');
  return `legacy.${canonicalPath || 'unknown'}.${operation}.v1`;
};

const resolveMetricKey = (target, operation) => (
  performanceTargetMetadata.get(target)?.label || legacyMetricKey(target, operation)
);

export const estimatePayloadBytes = (payload) => {
  try {
    const serialized = JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'function') return '[function]';
      if (value instanceof Date) return value.toISOString();
      return value;
    });
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(serialized).byteLength;
    return unescape(encodeURIComponent(serialized)).length;
  } catch (_error) {
    return 0;
  }
};

const snapshotDocumentCount = (snapshot) => {
  if (typeof snapshot?.size === 'number') return snapshot.size;
  if (typeof snapshot?.exists === 'function') return snapshot.exists() ? 1 : 0;
  return 0;
};

const estimateSnapshotPayloadBytes = (snapshot, initial) => {
  try {
    if (!initial && typeof snapshot?.docChanges === 'function') {
      return estimatePayloadBytes(snapshot.docChanges().map((change) => change.doc.data()));
    }
    if (Array.isArray(snapshot?.docs)) return estimatePayloadBytes(snapshot.docs.map((entry) => entry.data()));
    if (typeof snapshot?.data === 'function') return estimatePayloadBytes(snapshot.data());
  } catch (_error) {
    return 0;
  }
  return 0;
};

const wrapSnapshotNext = (next, metricKey, completeInitial) => {
  let initial = true;
  return (snapshot) => {
    const normalizationStart = performance.now();
    const count = initial
      ? snapshotDocumentCount(snapshot)
      : typeof snapshot?.docChanges === 'function'
        ? snapshot.docChanges().length
        : snapshotDocumentCount(snapshot);
    recordPerfEvent({
      category: 'firestore',
      metric: initial ? 'initial-documents-delivered' : 'changed-documents-delivered',
      value: count,
      tags: { target: metricKey },
    });
    recordPerfEvent({
      category: 'firestore',
      metric: 'documents-delivery-estimated-bytes',
      value: estimateSnapshotPayloadBytes(snapshot, initial),
      unit: 'bytes',
      tags: { target: metricKey, delivery: initial ? 'initial' : 'changed' },
    });
    if (initial) {
      initial = false;
      completeInitial();
    }
    const result = next?.(snapshot);
    recordPerfEvent({
      category: 'normalization',
      metric: 'snapshot-callback',
      value: performance.now() - normalizationStart,
      unit: 'ms',
      tags: { target: metricKey, inputCount: count, outputCount: count },
    });
    return result;
  };
};

export const onSnapshot = (target, ...args) => {
  if (!isPerformanceEnabled()) return firestore.onSnapshot(target, ...args);
  const targetMetadata = performanceTargetMetadata.get(target);
  const metricKey = resolveMetricKey(target, 'subscribe');
  const closeListener = registerActiveListener(metricKey, targetMetadata?.ownership || 'route');
  const completeInitial = beginRouteAsyncWork(`firestore-listener:${metricKey}`);
  const wrappedArgs = [...args];
  const observerIndex = wrappedArgs.findIndex((value) => value && typeof value === 'object' && typeof value.next === 'function');

  if (observerIndex >= 0) {
    const observer = wrappedArgs[observerIndex];
    wrappedArgs[observerIndex] = {
      ...observer,
      next: wrapSnapshotNext(observer.next?.bind(observer), metricKey, completeInitial),
      error: (error) => {
        completeInitial();
        observer.error?.(error);
      },
    };
  } else {
    const nextIndex = wrappedArgs.findIndex((value) => typeof value === 'function');
    if (nextIndex >= 0) {
      wrappedArgs[nextIndex] = wrapSnapshotNext(wrappedArgs[nextIndex], metricKey, completeInitial);
      const errorIndex = wrappedArgs.findIndex((value, index) => index > nextIndex && typeof value === 'function');
      if (errorIndex >= 0) {
        const originalError = wrappedArgs[errorIndex];
        wrappedArgs[errorIndex] = (error) => {
          completeInitial();
          return originalError(error);
        };
      }
    }
  }

  let unsubscribe;
  try {
    unsubscribe = runFirestoreTransport(() => firestore.onSnapshot(target, ...wrappedArgs));
  } catch (error) {
    completeInitial();
    closeListener();
    throw error;
  }
  let underlyingClosed = false;
  return () => {
    if (underlyingClosed) return;
    underlyingClosed = true;
    completeInitial();
    closeListener();
    unsubscribe();
  };
};

const trackedRead = async (operationName, operation, target, args) => {
  if (!isPerformanceEnabled()) return operation(target, ...args);
  const metricKey = resolveMetricKey(target, operationName);
  const complete = beginRouteAsyncWork(`firestore-read:${metricKey}`);
  const start = performance.now();
  try {
    const snapshot = await runFirestoreTransport(() => operation(target, ...args));
    recordPerfEvent({
      category: 'firestore',
      metric: 'one-shot-documents-delivered',
      value: snapshotDocumentCount(snapshot),
      tags: { target: metricKey, durationMs: performance.now() - start },
    });
    recordPerfEvent({
      category: 'firestore',
      metric: 'documents-delivery-estimated-bytes',
      value: estimateSnapshotPayloadBytes(snapshot, true),
      unit: 'bytes',
      tags: { target: metricKey, delivery: 'one-shot' },
    });
    return snapshot;
  } finally {
    complete();
  }
};

export const getDoc = (target, ...args) => trackedRead('get', firestore.getDoc, target, args);
export const getDocs = (target, ...args) => trackedRead('list', firestore.getDocs, target, args);
export const getCountFromServer = (target, ...args) => trackedRead('count', firestore.getCountFromServer, target, args);

const trackedWrite = async (operationName, operation, target, args, payloadIndex = 0) => {
  if (!isPerformanceEnabled()) return operation(target, ...args);
  const metricKey = resolveMetricKey(target, operationName);
  const payloadBytes = estimatePayloadBytes(args[payloadIndex]);
  recordPerfEvent({ category: 'firestore', metric: 'write-attempt', value: payloadBytes, unit: 'bytes', tags: { target: metricKey, operation: operationName } });
  try {
    const result = await runFirestoreTransport(() => operation(target, ...args));
    recordPerfEvent({ category: 'firestore', metric: 'write-success', tags: { target: metricKey, operation: operationName } });
    return result;
  } catch (error) {
    recordPerfEvent({ category: 'firestore', metric: 'write-failure', tags: { target: metricKey, operation: operationName, code: error?.code || 'unknown' } });
    throw error;
  }
};

export const addDoc = (target, ...args) => trackedWrite('add', firestore.addDoc, target, args);
export const setDoc = (target, ...args) => trackedWrite('set', firestore.setDoc, target, args);
export const updateDoc = (target, ...args) => trackedWrite('update', firestore.updateDoc, target, args);
export const deleteDoc = (target, ...args) => trackedWrite('delete', firestore.deleteDoc, target, args, -1);

const trackedTransactionOrBatch = (target, operationName, state) => new Proxy(target, {
  get(subject, property) {
    if (['set', 'update', 'delete'].includes(property)) {
      return (reference, ...args) => {
        state.operations += 1;
        state.payloadBytes += property === 'delete' ? 0 : estimatePayloadBytes(args[0]);
        state.targets.add(describeTarget(reference));
        subject[property](reference, ...args);
        return state.proxy;
      };
    }
    const value = subject[property];
    if (property === 'commit' && typeof value === 'function') {
      return async (...args) => {
        recordPerfEvent({ category: 'firestore', metric: 'write-attempt', value: state.payloadBytes, unit: 'bytes', tags: { operation: operationName, operations: state.operations } });
        try {
          const result = await runFirestoreTransport(() => value.apply(subject, args));
          recordPerfEvent({ category: 'firestore', metric: 'write-success', tags: { operation: operationName, operations: state.operations } });
          return result;
        } catch (error) {
          recordPerfEvent({ category: 'firestore', metric: 'write-failure', tags: { operation: operationName, code: error?.code || 'unknown' } });
          throw error;
        }
      };
    }
    return typeof value === 'function' ? value.bind(subject) : value;
  },
});

export const writeBatch = (...args) => {
  const batch = firestore.writeBatch(...args);
  if (!isPerformanceEnabled()) return batch;
  const state = { operations: 0, payloadBytes: 0, targets: new Set(), proxy: null };
  state.proxy = trackedTransactionOrBatch(batch, 'batch', state);
  return state.proxy;
};

export const runTransaction = (db, updateFunction, ...args) => {
  if (!isPerformanceEnabled()) return firestore.runTransaction(db, updateFunction, ...args);
  let latestState = { operations: 0, payloadBytes: 0 };
  let attempt = 0;
  return runFirestoreTransport(() => firestore.runTransaction(db, (transaction) => {
    attempt += 1;
    const state = { operations: 0, payloadBytes: 0, targets: new Set(), proxy: null };
    latestState = state;
    state.proxy = trackedTransactionOrBatch(transaction, 'transaction', state);
    return Promise.resolve(updateFunction(state.proxy)).then((result) => {
      recordPerfEvent({
        category: 'firestore',
        metric: 'write-attempt',
        value: state.payloadBytes,
        unit: 'bytes',
        tags: { operation: 'transaction', operations: state.operations, attempt },
      });
      return result;
    });
  }, ...args)).then((result) => {
    recordPerfEvent({ category: 'firestore', metric: 'write-success', tags: { operation: 'transaction', operations: latestState.operations, attempts: attempt } });
    return result;
  }, (error) => {
    recordPerfEvent({ category: 'firestore', metric: 'write-failure', tags: { operation: 'transaction', code: error?.code || 'unknown', attempts: attempt } });
    throw error;
  });
};
