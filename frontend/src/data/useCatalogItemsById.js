import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../AuthContext';
import {
  CATALOG_ITEM_QUERY_MAX_IDS,
  subscribeCatalogItems,
} from './catalogItemRepository';

export const CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY = 4;

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
    let nextChunkIndex = 0;
    let subscriptionsStarting = 0;
    let firstError = null;
    const unsubscribes = [];
    const publish = () => {
      if (!active) return;
      const itemsById = Object.assign({}, ...chunkKeys.map((chunkKey) => (
        itemsByChunkKey.get(chunkKey) || {}
      )));
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
      subscriptionsStarting -= 1;
      publish();
      startNextSubscriptions();
    };
    const startSubscription = (chunkIndex) => {
      const chunk = chunks[chunkIndex];
      let initialSettled = false;
      subscriptionsStarting += 1;
      try {
        const unsubscribe = subscribeCatalogItems(chunk, {
          next: (chunkItemsById) => {
            if (!active) return;
            if (!initialSettled) {
              initialSettled = true;
              settleInitialChunk(chunkIndex, chunkItemsById);
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
              return;
            }
            firstError ||= resolvedError;
            publish();
          },
        });
        if (active) unsubscribes.push(unsubscribe);
        else unsubscribe?.();
      } catch (error) {
        if (!initialSettled) {
          initialSettled = true;
          settleInitialChunk(chunkIndex, {}, error);
        }
      }
    };
    function startNextSubscriptions() {
      while (
        active
        && subscriptionsStarting < CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY
        && nextChunkIndex < chunks.length
      ) {
        const chunkIndex = nextChunkIndex;
        nextChunkIndex += 1;
        startSubscription(chunkIndex);
      }
    }
    setState(emptyState(scopeKey, 'loading'));
    startNextSubscriptions();

    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [normalizedIds, scopeKey]);

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
