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
const HOME_CONFIG_DOCUMENT_IDS = Object.freeze([
  'varie',
  ...SPECIAL_PARAM_SCHEMA_IDS,
]);

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
    let request;
    try {
      if (invalidateFirst) {
        HOME_CONFIG_DOCUMENT_IDS.forEach((documentId) => invalidate(documentId));
      }
      request = Promise.all([
        loadVarie(),
        Promise.all(SPECIAL_PARAM_SCHEMA_IDS.map((id) => loadSchema(id))),
      ]);
    } catch (error) {
      request = Promise.reject(error);
    }

    const currentAttempt = request
      .then(([varie, schemas]) => {
        const specialSchemaKeys = Array.from(new Set(schemas.flatMap((schema) => (
          Object.keys(schema?.Parametri?.Special || {})
        )))).sort();
        publish(attempt, createConfigSlice({
          dadiAnimaByLevel: Object.freeze([...(varie?.dadiAnimaByLevel || [])]),
          combatCosts: Object.freeze({ ...(varie?.cost_params_combat || {}) }),
          specialSchemaKeys: Object.freeze(specialSchemaKeys),
          status: 'fresh',
          retry,
        }));
        return true;
      })
      .catch((error) => {
        publish(attempt, createConfigSlice({ status: 'error', error, retry }));
        return false;
      })
      .finally(() => {
        releaseConfigResourceOwner();
        if (inFlight === currentAttempt) inFlight = null;
      });
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
