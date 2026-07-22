import { assertFirestoreMetricKey } from './telemetryKeys';

const FAILURE_BACKOFF_MS = Object.freeze([250, 1_000, 4_000]);
const scheduleMicrotask = typeof queueMicrotask === 'function'
  ? queueMicrotask
  : (callback) => Promise.resolve().then(callback);

let actorUid = null;
let sessionGeneration = 0;
const cacheEntries = new Map();
const subscriptionEntries = new Map();

export class RepositorySessionChangedError extends Error {
  constructor({ retryableTransition = false } = {}) {
    super('The repository actor changed before the operation completed.');
    this.name = 'RepositorySessionChangedError';
    this.code = 'repository-session-changed';
    this.retryableTransition = retryableTransition === true;
  }
}

export class RepositoryInvalidatedError extends Error {
  constructor(instanceKey) {
    super(`The repository request was invalidated before it completed: ${instanceKey}`);
    this.name = 'RepositoryInvalidatedError';
    this.code = 'repository-invalidated';
  }
}

const assertInstanceKey = (instanceKey) => {
  if (typeof instanceKey !== 'string' || !instanceKey.trim()) {
    throw new TypeError('Repository instance keys must be non-empty strings.');
  }
  return instanceKey;
};

const normalizeActor = (uidOrNull) => {
  if (uidOrNull === null || uidOrNull === undefined) return null;
  if (typeof uidOrNull !== 'string' || !uidOrNull.trim()) {
    throw new TypeError('Repository actors must be a non-empty UID or null.');
  }
  return uidOrNull;
};

const isRetryableSessionTransition = (previousActor, currentActor) => (
  previousActor === currentActor
  || (previousActor === null && currentActor !== null)
);

const closePhysicalSubscription = (entry) => {
  if (entry.closed && !entry.unsubscribe) return;
  entry.closed = true;
  entry.teardownToken = null;
  const unsubscribe = entry.unsubscribe;
  entry.unsubscribe = null;
  if (typeof unsubscribe === 'function') unsubscribe();
};

/**
 * Moves every actor-scoped repository resource to a new session generation.
 * Late callbacks from the previous generation are ignored.
 *
 * @param {string|null} uidOrNull
 * @returns {number} the new session generation
 */
export const setRepositoryActor = (uidOrNull) => {
  actorUid = normalizeActor(uidOrNull);
  sessionGeneration += 1;

  for (const entry of subscriptionEntries.values()) {
    if (entry.actorScoped) closePhysicalSubscription(entry);
  }
  for (const [instanceKey, entry] of subscriptionEntries) {
    if (entry.actorScoped) subscriptionEntries.delete(instanceKey);
  }
  for (const [instanceKey, entry] of cacheEntries) {
    if (entry.actorScoped) cacheEntries.delete(instanceKey);
  }

  return sessionGeneration;
};

/**
 * Shares an in-flight load and its successful result until invalidation or an
 * authoritative auth transition. Rejections are shared only for bounded
 * retry windows (250 ms, 1 second, then 4 seconds).
 *
 * @template T
 * @param {{
 *   metricKey: string,
 *   instanceKey: string,
 *   load: () => Promise<T>|T,
 *   actorScoped?: boolean,
 * }} options
 * @returns {Promise<T>}
 */
export const getCached = ({
  metricKey,
  instanceKey,
  load,
  actorScoped = true,
}) => {
  assertFirestoreMetricKey(metricKey);
  assertInstanceKey(instanceKey);
  if (typeof load !== 'function') throw new TypeError('Repository loads must be functions.');

  const existing = cacheEntries.get(instanceKey);
  if (existing) {
    if (existing.generation !== sessionGeneration && existing.actorScoped) {
      cacheEntries.delete(instanceKey);
    } else if (existing.status !== 'failure' || Date.now() < existing.retryAt) {
      return existing.promise;
    }
  }

  const previousFailureCount = existing?.status === 'failure' ? existing.failureCount : 0;
  const generation = sessionGeneration;
  const requestActorUid = actorUid;
  const entry = {
    actorScoped,
    failureCount: previousFailureCount,
    generation,
    metricKey,
    promise: null,
    retryAt: 0,
    status: 'pending',
    value: undefined,
  };

  entry.promise = Promise.resolve()
    .then(load)
    .then((value) => {
      if (actorScoped && generation !== sessionGeneration) {
        throw new RepositorySessionChangedError({
          retryableTransition: isRetryableSessionTransition(requestActorUid, actorUid),
        });
      }
      if (cacheEntries.get(instanceKey) !== entry) {
        throw new RepositoryInvalidatedError(instanceKey);
      }
      entry.status = 'success';
      entry.failureCount = 0;
      entry.retryAt = 0;
      entry.value = value;
      return value;
    })
    .catch((error) => {
      const stillCurrent = cacheEntries.get(instanceKey) === entry;
      const sessionIsCurrent = !actorScoped || generation === sessionGeneration;
      if (!sessionIsCurrent) {
        if (stillCurrent) cacheEntries.delete(instanceKey);
        throw new RepositorySessionChangedError({
          retryableTransition: isRetryableSessionTransition(requestActorUid, actorUid),
        });
      }
      if (stillCurrent && sessionIsCurrent && !(error instanceof RepositoryInvalidatedError)) {
        entry.status = 'failure';
        entry.failureCount = previousFailureCount + 1;
        const backoffIndex = Math.min(entry.failureCount - 1, FAILURE_BACKOFF_MS.length - 1);
        entry.retryAt = Date.now() + FAILURE_BACKOFF_MS[backoffIndex];
      } else if (stillCurrent) {
        cacheEntries.delete(instanceKey);
      }
      throw error;
    });

  cacheEntries.set(instanceKey, entry);
  return entry.promise;
};

export const invalidate = (instanceKey) => {
  assertInstanceKey(instanceKey);
  return cacheEntries.delete(instanceKey);
};

export const invalidatePrefix = (prefix) => {
  assertInstanceKey(prefix);
  let invalidated = 0;
  for (const instanceKey of cacheEntries.keys()) {
    if (instanceKey.startsWith(prefix)) {
      cacheEntries.delete(instanceKey);
      invalidated += 1;
    }
  }
  return invalidated;
};

const normalizeObserver = (observer) => {
  if (typeof observer === 'function') return { next: observer };
  if (!observer || typeof observer !== 'object') {
    throw new TypeError('Shared subscription observers must be functions or observer objects.');
  }
  if (typeof observer.next !== 'function' && typeof observer.error !== 'function') {
    throw new TypeError('Shared subscription observers require next or error callbacks.');
  }
  return observer;
};

const notifyObservers = (entry, method, value) => {
  for (const observer of [...entry.observers]) {
    try {
      observer[method]?.(value);
    } catch (error) {
      // Keep one consumer from starving the remaining shared consumers while
      // still surfacing the exception through the browser/Jest error channel.
      scheduleMicrotask(() => { throw error; });
    }
  }
};

/**
 * @template T
 * @param {{
 *   metricKey: string,
 *   instanceKey: string,
 *   listen: (observer: {next: (value: T) => void, error: (error: unknown) => void}) => (() => void),
 *   actorScoped?: boolean,
 * }} descriptor
 * @param {((value: T) => void)|{next?: (value: T) => void, error?: (error: unknown) => void}} observer
 * @returns {() => void}
 */
export const subscribeShared = (descriptor, observer) => {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('Shared subscriptions require a descriptor.');
  }
  const {
    metricKey,
    instanceKey,
    listen,
    actorScoped = true,
  } = descriptor;
  assertFirestoreMetricKey(metricKey);
  assertInstanceKey(instanceKey);
  if (typeof listen !== 'function') throw new TypeError('Shared subscription descriptors require listen().');
  const normalizedObserver = normalizeObserver(observer);

  let entry = subscriptionEntries.get(instanceKey);
  if (entry && actorScoped && entry.generation !== sessionGeneration) {
    closePhysicalSubscription(entry);
    subscriptionEntries.delete(instanceKey);
    entry = null;
  }

  if (!entry) {
    entry = {
      actorScoped,
      closed: false,
      generation: sessionGeneration,
      hasLatest: false,
      latest: undefined,
      metricKey,
      observers: new Set(),
      teardownToken: null,
      unsubscribe: null,
    };
    subscriptionEntries.set(instanceKey, entry);
  } else if (entry.metricKey !== metricKey) {
    throw new Error(`Repository instance key ${instanceKey} was reused with a different metric key.`);
  }

  entry.teardownToken = null;
  entry.observers.add(normalizedObserver);

  if (!entry.unsubscribe && !entry.listening) {
    entry.listening = true;
    const expectedEntry = entry;
    let unsubscribe;
    try {
      unsubscribe = listen({
        next: (value) => {
          if (
            expectedEntry.closed
            || subscriptionEntries.get(instanceKey) !== expectedEntry
            || (actorScoped && expectedEntry.generation !== sessionGeneration)
          ) return;
          expectedEntry.hasLatest = true;
          expectedEntry.latest = value;
          notifyObservers(expectedEntry, 'next', value);
        },
        error: (error) => {
          if (
            expectedEntry.closed
            || subscriptionEntries.get(instanceKey) !== expectedEntry
            || (actorScoped && expectedEntry.generation !== sessionGeneration)
          ) return;
          subscriptionEntries.delete(instanceKey);
          const observers = [...expectedEntry.observers];
          expectedEntry.observers.clear();
          closePhysicalSubscription(expectedEntry);
          for (const subscriber of observers) {
            try {
              subscriber.error?.(error);
            } catch (observerError) {
              scheduleMicrotask(() => { throw observerError; });
            }
          }
        },
      });
    } catch (error) {
      expectedEntry.observers.delete(normalizedObserver);
      subscriptionEntries.delete(instanceKey);
      expectedEntry.closed = true;
      throw error;
    } finally {
      expectedEntry.listening = false;
    }
    expectedEntry.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
    if (expectedEntry.closed) {
      const lateUnsubscribe = expectedEntry.unsubscribe;
      expectedEntry.unsubscribe = null;
      lateUnsubscribe();
    }
  } else if (entry.hasLatest) {
    try {
      normalizedObserver.next?.(entry.latest);
    } catch (error) {
      scheduleMicrotask(() => { throw error; });
    }
  }

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    entry.observers.delete(normalizedObserver);
    if (entry.observers.size !== 0 || entry.closed) return;

    const teardownToken = Symbol(instanceKey);
    entry.teardownToken = teardownToken;
    scheduleMicrotask(() => {
      if (
        entry.teardownToken !== teardownToken
        || entry.observers.size !== 0
        || subscriptionEntries.get(instanceKey) !== entry
      ) return;
      subscriptionEntries.delete(instanceKey);
      closePhysicalSubscription(entry);
    });
  };
};

export const createStructuralResult = () => ({
  byId: {},
  orderedIds: [],
  items: [],
  revision: 0,
});

const removeOrderedId = (orderedIds, id, preferredIndex) => {
  const resolvedIndex = orderedIds[preferredIndex] === id
    ? preferredIndex
    : orderedIds.indexOf(id);
  if (resolvedIndex >= 0) orderedIds.splice(resolvedIndex, 1);
};

/**
 * Applies only Firestore document changes. Unchanged normalized entities keep
 * their object identity, while orderedIds/items receive a new revision.
 *
 * @template T
 * @param {{byId: Record<string, T>, orderedIds: string[], items: T[], revision: number}|null|undefined} previous
 * @param {{docChanges: () => Array<{type: string, doc: {id: string}, oldIndex: number, newIndex: number}>}} snapshot
 * @param {(document: {id: string}) => T} normalize
 * @returns {{byId: Record<string, T>, orderedIds: string[], items: T[], revision: number}}
 */
export const applyDocChanges = (previous, snapshot, normalize) => {
  if (!snapshot || typeof snapshot.docChanges !== 'function') {
    throw new TypeError('Structural sharing requires a Firestore query snapshot.');
  }
  if (typeof normalize !== 'function') {
    throw new TypeError('Structural sharing requires a document normalizer.');
  }
  const current = previous || createStructuralResult();
  const changes = snapshot.docChanges();
  if (!Array.isArray(changes) || changes.length === 0) return current;

  const byId = { ...current.byId };
  const orderedIds = [...current.orderedIds];

  for (const change of changes) {
    const id = change?.doc?.id;
    if (typeof id !== 'string' || !id) {
      throw new TypeError('Firestore document changes require stable document IDs.');
    }

    if (change.type === 'removed') {
      delete byId[id];
      removeOrderedId(orderedIds, id, change.oldIndex);
      continue;
    }

    const normalized = normalize(change.doc);
    byId[id] = normalized;
    if (change.type === 'modified') {
      removeOrderedId(orderedIds, id, change.oldIndex);
    } else if (change.type !== 'added') {
      throw new TypeError(`Unsupported Firestore document change type: ${change.type}`);
    }
    const insertionIndex = Number.isInteger(change.newIndex) && change.newIndex >= 0
      ? Math.min(change.newIndex, orderedIds.length)
      : orderedIds.length;
    orderedIds.splice(insertionIndex, 0, id);
  }

  return {
    byId,
    orderedIds,
    items: orderedIds.map((id) => byId[id]),
    revision: (Number.isFinite(current.revision) ? current.revision : 0) + 1,
  };
};

export const __resetRepositoryRuntimeForTests = () => {
  if (process.env.NODE_ENV !== 'test') return;
  for (const entry of subscriptionEntries.values()) closePhysicalSubscription(entry);
  subscriptionEntries.clear();
  cacheEntries.clear();
  actorUid = null;
  sessionGeneration = 0;
};

export const __getRepositoryRuntimeStateForTests = () => {
  if (process.env.NODE_ENV !== 'test') return null;
  return {
    actorUid,
    cacheCount: cacheEntries.size,
    sessionGeneration,
    subscriptionCount: subscriptionEntries.size,
  };
};
