import React, { useEffect, useMemo } from 'react';
import { getSchema, getVarie, invalidateConfig } from '../../data/configRepository';
import { collectInventoryCatalogItemIds } from '../../data/inventoryCatalogProjection';
import useCatalogItemsById from '../../data/useCatalogItemsById';
import {
  useEquipment,
  useInventory,
  useProfileContent,
  useProgression,
  useResources,
  useUserSettings,
} from '../../data/userData/userDataHooks';
import { SPECIAL_PARAM_SCHEMA_IDS } from '../common/paramMetadata';
import { beginAsyncResourceOwner } from '../../performance/runtime';
import { createHomeInventoryProjectionSelector } from './homeInventoryProjection';
import { createHomeReadStore, HomeReadStoreProvider } from './homeReadStore';

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

const createConfigSlice = ({
  combatCosts = EMPTY_OBJECT,
  dadiAnimaByLevel = EMPTY_ARRAY,
  error = null,
  retry,
  specialSchemaKeys = EMPTY_ARRAY,
  status,
}) => Object.freeze({
  dadiAnimaByLevel,
  combatCosts,
  specialSchemaKeys,
  status,
  error,
  retry,
});

export const createHomeConfigOwner = ({
  loadSchema = getSchema,
  loadVarie = getVarie,
  invalidate = invalidateConfig,
  scopeKey,
  store,
}) => {
  let active = false;
  let attemptSequence = 0;
  let inFlight = null;

  const publish = (attempt, config) => {
    if (!active || attempt !== attemptSequence || store.scopeKey !== scopeKey) return false;
    return store.publish(scopeKey, { config });
  };

  const retry = () => start({ invalidateFirst: true });

  const start = ({ invalidateFirst = false } = {}) => {
    if (!active) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const attempt = ++attemptSequence;
    publish(attempt, createConfigSlice({ status: 'loading', retry }));

    const releaseConfigResourceOwner = beginAsyncResourceOwner('home');
    const read = (loader) => {
      try { return Promise.resolve(loader()); } catch (error) { return Promise.reject(error); }
    };
    let config = createConfigSlice({ status: 'loading', retry });
    const patchConfig = (patch) => {
      config = createConfigSlice({ ...config, ...patch });
      publish(attempt, config);
    };
    const schemaRequest = Promise.allSettled(SPECIAL_PARAM_SCHEMA_IDS.map((id) => read(() => {
      if (invalidateFirst) invalidate(id);
      return loadSchema(id);
    }))).then((results) => {
      const schemas = results.filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      patchConfig({ specialSchemaKeys: Object.freeze(Array.from(new Set(
        schemas.flatMap((schema) => Object.keys(schema?.Parametri?.Special || {}))
      )).sort()) });
    });
    // Optional display schemas settle separately: neither rejection nor a
    // stalled read can disable actions backed by the usable Varie document.
    const currentAttempt = read(() => {
      if (invalidateFirst) invalidate('varie');
      return loadVarie();
    })
      .then((varie) => {
        patchConfig({
          dadiAnimaByLevel: Object.freeze([...(varie?.dadiAnimaByLevel || [])]),
          combatCosts: Object.freeze({ ...(varie?.cost_params_combat || {}) }),
          status: 'fresh',
        });
        return true;
      })
      .catch((error) => {
        patchConfig({ status: 'error', error });
        return false;
      })
      .finally(() => {
        if (inFlight === currentAttempt) inFlight = null;
      });
    void Promise.allSettled([currentAttempt, schemaRequest]).then(releaseConfigResourceOwner);
    inFlight = currentAttempt;
    return currentAttempt;
  };

  return Object.freeze({
    mount() {
      active = true;
      start();
      return () => { active = false; };
    },
    retry,
  });
};

const HomeReadOwner = ({ configOwner, scopeKey, store, uid }) => {
  const progression = useProgression(uid);
  const resources = useResources(uid);
  const settings = useUserSettings(uid);
  const equipment = useEquipment(uid);
  const profileContent = useProfileContent(uid);
  const inventory = useInventory(uid);
  const catalogItemIds = useMemo(
    () => collectInventoryCatalogItemIds(inventory.data),
    [inventory.data]
  );
  const catalog = useCatalogItemsById(catalogItemIds);
  const selectProjection = useMemo(createHomeInventoryProjectionSelector, []);
  const inventoryProjection = useMemo(() => selectProjection({
    inventory: inventory.data || EMPTY_ARRAY,
    equipment: equipment.data || EMPTY_OBJECT,
    catalogItemsById: catalog.itemsById,
  }), [catalog.itemsById, equipment.data, inventory.data, selectProjection]);

  useEffect(() => {
    store.publish(scopeKey, {
      progression,
      resources,
      settings,
      equipment,
      profileContent,
      inventory,
      catalog,
      inventoryProjection,
    });
  }, [
    catalog,
    equipment,
    inventory,
    inventoryProjection,
    profileContent,
    progression,
    resources,
    scopeKey,
    settings,
    store,
  ]);

  useEffect(() => configOwner.mount(), [configOwner]);

  return null;
};

const HomeReadScope = ({ children, repositoryAccessGeneration, uid }) => {
  const scopeKey = `${uid}:${repositoryAccessGeneration}`;
  const store = useMemo(() => createHomeReadStore(scopeKey), [scopeKey]);
  const configOwner = useMemo(
    () => createHomeConfigOwner({ scopeKey, store }),
    [scopeKey, store]
  );
  return (
    <>
      <HomeReadOwner
        configOwner={configOwner}
        scopeKey={scopeKey}
        store={store}
        uid={uid}
      />
      <HomeReadStoreProvider store={store}>{children}</HomeReadStoreProvider>
    </>
  );
};

export default HomeReadScope;
