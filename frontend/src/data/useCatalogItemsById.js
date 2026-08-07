import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../AuthContext';
import { subscribeCatalogItem } from './catalogItemRepository';

export const normalizeCatalogItemIds = (itemIds) => Array.from(new Set(
  (Array.isArray(itemIds) ? itemIds : [])
    .filter((itemId) => typeof itemId === 'string' && itemId.trim() && !itemId.includes('/'))
    .map((itemId) => itemId.trim())
)).sort();

const emptyState = (scopeKey = null, status = 'idle') => ({
  scopeKey,
  itemsById: {},
  status,
  error: null,
});

export const useCatalogItemsById = (itemIds) => {
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  const normalizedIdsKey = normalizeCatalogItemIds(itemIds).join('\u001f');
  const normalizedIds = useMemo(
    () => (normalizedIdsKey ? normalizedIdsKey.split('\u001f') : []),
    [normalizedIdsKey]
  );
  const scopeKey = user?.uid
    ? `${user.uid}:${repositoryAccessGeneration}:${normalizedIdsKey}`
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
    const pending = new Set(normalizedIds);
    const itemsById = {};
    let firstError = null;
    const publish = () => {
      if (!active) return;
      setState({
        scopeKey,
        itemsById: { ...itemsById },
        status: pending.size ? 'loading' : (firstError ? 'error' : 'fresh'),
        error: firstError,
      });
    };
    setState(emptyState(scopeKey, 'loading'));
    const unsubscribes = normalizedIds.map((itemId) => subscribeCatalogItem(itemId, {
      next: (item) => {
        if (!active) return;
        if (item) itemsById[itemId] = item;
        else delete itemsById[itemId];
        pending.delete(itemId);
        publish();
      },
      error: (error) => {
        if (!active) return;
        firstError ||= error || new Error(`Unable to load catalog item ${itemId}.`);
        pending.delete(itemId);
        publish();
      },
    }));

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
