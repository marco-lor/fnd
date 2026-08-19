import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../AuthContext';
import {
  CATALOG_ITEM_QUERY_MAX_IDS,
  subscribeCatalogItems,
} from './catalogItemRepository';

export const CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY = 4;

const catalogStartupSchedulers = new Map();

const createCatalogStartupScheduler = (scopeKey) => {
  const scheduler = {
    consumers: [],
    cursor: 0,
    drainScheduled: false,
    draining: false,
    inFlight: 0,
    scopeKey,
  };

  const hasQueuedWork = () => scheduler.consumers.some((consumer) => (
    consumer.active && consumer.nextIndex < consumer.starts.length
  ));
  const removeIfIdle = () => {
    if (
      scheduler.inFlight === 0
      && !hasQueuedWork()
      && catalogStartupSchedulers.get(scopeKey) === scheduler
    ) {
      catalogStartupSchedulers.delete(scopeKey);
    }
  };
  const takeNextStart = () => {
    const { consumers } = scheduler;
    if (!consumers.length) return null;
    for (let offset = 0; offset < consumers.length; offset += 1) {
      const index = (scheduler.cursor + offset) % consumers.length;
      const consumer = consumers[index];
      if (!consumer.active || consumer.nextIndex >= consumer.starts.length) continue;
      const start = consumer.starts[consumer.nextIndex];
      consumer.nextIndex += 1;
      scheduler.cursor = (index + 1) % consumers.length;
      return start;
    }
    return null;
  };
  const drain = () => {
    if (scheduler.draining) return;
    scheduler.draining = true;
    try {
      while (scheduler.inFlight < CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY) {
        const start = takeNextStart();
        if (!start) break;
        scheduler.inFlight += 1;
        let released = false;
        const release = ({ deferDrain = false } = {}) => {
          if (released) return;
          released = true;
          scheduler.inFlight -= 1;
          if (deferDrain) {
            if (!scheduler.drainScheduled) {
              scheduler.drainScheduled = true;
              Promise.resolve().then(() => {
                scheduler.drainScheduled = false;
                drain();
                removeIfIdle();
              });
            }
          } else {
            drain();
            removeIfIdle();
          }
        };
        start(release);
      }
    } finally {
      scheduler.draining = false;
    }
    removeIfIdle();
  };

  scheduler.register = (starts) => {
    const consumer = {
      active: true,
      nextIndex: 0,
      starts,
    };
    scheduler.consumers.push(consumer);
    if (scheduler.inFlight >= CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY) {
      scheduler.cursor = scheduler.consumers.length - 1;
    }
    drain();

    return () => {
      if (!consumer.active) return;
      consumer.active = false;
      const index = scheduler.consumers.indexOf(consumer);
      if (index >= 0) {
        scheduler.consumers.splice(index, 1);
        if (index < scheduler.cursor) scheduler.cursor -= 1;
        if (scheduler.cursor >= scheduler.consumers.length) scheduler.cursor = 0;
      }
      drain();
      removeIfIdle();
    };
  };

  return scheduler;
};

const registerCatalogStartupConsumer = (scopeKey, starts) => {
  let scheduler = catalogStartupSchedulers.get(scopeKey);
  if (!scheduler) {
    scheduler = createCatalogStartupScheduler(scopeKey);
    catalogStartupSchedulers.set(scopeKey, scheduler);
  }
  return scheduler.register(starts);
};

export const normalizeCatalogItemIds = (itemIds) => Array.from(new Set(
  (Array.isArray(itemIds) ? itemIds : [])
    .filter((itemId) => typeof itemId === 'string' && itemId.trim() && !itemId.includes('/'))
    .map((itemId) => itemId.trim())
)).sort();

export const chunkCatalogItemIds = (itemIds) => {
  const normalizedIds = normalizeCatalogItemIds(itemIds);
  const chunks = [];
  for (let index = 0; index < normalizedIds.length; index += CATALOG_ITEM_QUERY_MAX_IDS) {
    chunks.push(normalizedIds.slice(index, index + CATALOG_ITEM_QUERY_MAX_IDS));
  }
  return chunks;
};

const emptyState = (scopeKey = null, status = 'idle') => ({
  scopeKey,
  itemsById: {},
  status,
  error: null,
});

export const useCatalogItemsById = (itemIds) => {
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  const normalizedIdsKey = JSON.stringify(normalizeCatalogItemIds(itemIds));
  const normalizedIds = useMemo(
    () => JSON.parse(normalizedIdsKey),
    [normalizedIdsKey]
  );
  const scopeKey = user?.uid
    ? JSON.stringify([user.uid, repositoryAccessGeneration, normalizedIds])
    : null;
  const startupScopeKey = user?.uid
    ? JSON.stringify([user.uid, repositoryAccessGeneration])
    : null;
  const [state, setState] = useState(() => emptyState());

  useEffect(() => {
    if (!scopeKey) {
      setState(emptyState());
      return undefined;
    }
    if (!normalizedIds.length) {
      setState(emptyState(scopeKey, 'fresh'));
      return undefined;
    }

    let active = true;
    const chunks = chunkCatalogItemIds(normalizedIds);
    const chunkKeys = chunks.map((chunk) => JSON.stringify(chunk));
    const pending = new Set(chunkKeys);
    const itemsByChunkKey = new Map();
    let firstError = null;
    const startedSubscriptions = [];
    const publish = () => {
      if (!active) return;
      const itemsById = Object.freeze(Object.fromEntries(chunkKeys.flatMap((chunkKey) => (
        Object.entries(itemsByChunkKey.get(chunkKey) || {})
      ))));
      setState({
        scopeKey,
        itemsById,
        status: pending.size ? 'loading' : (firstError ? 'error' : 'fresh'),
        error: firstError,
      });
    };
    const settleInitialChunk = (chunkIndex, chunkItemsById, error = null) => {
      if (!active) return;
      const chunkKey = chunkKeys[chunkIndex];
      if (error) firstError ||= error;
      itemsByChunkKey.set(chunkKey, chunkItemsById || {});
      pending.delete(chunkKey);
      publish();
    };
    const startSubscription = (chunkIndex, releaseStartupSlot) => {
      const chunk = chunks[chunkIndex];
      let initialSettled = false;
      try {
        const unsubscribe = subscribeCatalogItems(chunk, {
          next: (chunkItemsById) => {
            if (!active) return;
            if (!initialSettled) {
              initialSettled = true;
              settleInitialChunk(chunkIndex, chunkItemsById);
              releaseStartupSlot();
              return;
            }
            itemsByChunkKey.set(chunkKeys[chunkIndex], chunkItemsById || {});
            publish();
          },
          error: (error) => {
            if (!active) return;
            const resolvedError = error
              || new Error(`Unable to subscribe to catalog item batch ${chunkIndex + 1}.`);
            if (!initialSettled) {
              initialSettled = true;
              settleInitialChunk(chunkIndex, {}, resolvedError);
              releaseStartupSlot();
              return;
            }
            firstError ||= resolvedError;
            publish();
          },
        });
        const cancel = () => {
          if (!initialSettled) {
            initialSettled = true;
            releaseStartupSlot({ deferDrain: true });
          }
          unsubscribe?.();
        };
        if (active) startedSubscriptions.push(cancel);
        else cancel();
      } catch (error) {
        if (!initialSettled) {
          initialSettled = true;
          settleInitialChunk(chunkIndex, {}, error);
          releaseStartupSlot();
        }
      }
    };
    setState(emptyState(scopeKey, 'loading'));
    const cancelQueuedSubscriptions = registerCatalogStartupConsumer(
      startupScopeKey,
      chunks.map((_, chunkIndex) => (
        (releaseStartupSlot) => startSubscription(chunkIndex, releaseStartupSlot)
      ))
    );

    return () => {
      active = false;
      cancelQueuedSubscriptions();
      startedSubscriptions.forEach((cancel) => cancel());
    };
  }, [normalizedIds, scopeKey, startupScopeKey]);

  const visibleState = state.scopeKey === scopeKey
    ? state
    : (scopeKey ? emptyState(scopeKey, 'loading') : emptyState());
  return {
    itemsById: visibleState.itemsById,
    status: visibleState.status,
    error: visibleState.error,
  };
};

export default useCatalogItemsById;
