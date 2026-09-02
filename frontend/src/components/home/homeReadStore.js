import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

const loadingSlice = () => Object.freeze({
  data: null,
  status: 'loading',
  error: null,
  uid: null,
});

const EMPTY_PROJECTION = Object.freeze({
  inventory: Object.freeze([]),
  inventoryById: Object.freeze({}),
  equipped: Object.freeze({}),
  availableEquipment: Object.freeze([]),
  items: Object.freeze([]),
  searchItems: Object.freeze([]),
});

const createInitialState = (scopeKey) => Object.freeze({
  scopeKey,
  progression: loadingSlice(),
  resources: loadingSlice(),
  settings: loadingSlice(),
  equipment: loadingSlice(),
  profileContent: loadingSlice(),
  inventory: loadingSlice(),
  catalog: Object.freeze({ itemsById: Object.freeze({}), status: 'loading', error: null }),
  config: Object.freeze({
    dadiAnimaByLevel: Object.freeze([]),
    combatCosts: Object.freeze({}),
    specialSchemaKeys: Object.freeze([]),
    status: 'loading',
    error: null,
    retry: null,
  }),
  inventoryProjection: EMPTY_PROJECTION,
});

export const createHomeReadStore = (scopeKey) => {
  let state = createInitialState(scopeKey);
  const listeners = new Set();

  return {
    scopeKey,
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(publisherScopeKey, patch) {
      if (publisherScopeKey !== scopeKey || !patch || typeof patch !== 'object') return false;
      const entries = Object.entries(patch).filter(([key, value]) => state[key] !== value);
      if (!entries.length) return false;
      state = Object.freeze({ ...state, ...Object.fromEntries(entries) });
      [...listeners].forEach((listener) => listener());
      return true;
    },
  };
};

export const createSelectedSnapshotReader = (store, selector, isEqual = Object.is) => {
  let hasSelection = false;
  let previousSnapshot;
  let previousSelection;
  return () => {
    const snapshot = store.getSnapshot();
    if (hasSelection && snapshot === previousSnapshot) return previousSelection;
    const nextSelection = selector(snapshot);
    previousSnapshot = snapshot;
    if (hasSelection && isEqual(previousSelection, nextSelection)) return previousSelection;
    hasSelection = true;
    previousSelection = nextSelection;
    return nextSelection;
  };
};

const HomeReadStoreContext = createContext(null);

export const HomeReadStoreProvider = ({ store, children }) => (
  <HomeReadStoreContext.Provider value={store}>
    {children}
  </HomeReadStoreContext.Provider>
);

export const useOptionalHomeReadStore = () => useContext(HomeReadStoreContext);

export const useOptionalHomeReadSelector = (
  selector,
  fallbackValue,
  isEqual = Object.is
) => {
  const store = useOptionalHomeReadStore();
  const fallbackStore = useMemo(() => ({
    getSnapshot: () => fallbackValue,
    subscribe: () => () => {},
  }), [fallbackValue]);
  const activeStore = store || fallbackStore;
  const readSelection = useMemo(
    () => createSelectedSnapshotReader(
      activeStore,
      store ? selector : (value) => value,
      isEqual
    ),
    [activeStore, isEqual, selector, store]
  );
  return useSyncExternalStore(activeStore.subscribe, readSelection, readSelection);
};

export const useHomeReadSelector = (selector, isEqual = Object.is) => {
  const store = useOptionalHomeReadStore();
  if (!store) throw new Error('useHomeReadSelector must be used within HomeReadPlane.');
  const readSelection = useMemo(
    () => createSelectedSnapshotReader(store, selector, isEqual),
    [isEqual, selector, store]
  );
  return useSyncExternalStore(store.subscribe, readSelection, readSelection);
};
