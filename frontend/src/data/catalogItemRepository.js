import { db } from '../components/firebaseConfig';
import {
  collection,
  documentId,
  labelFirestoreTarget,
  onSnapshot,
  query,
  where,
} from '../performance/firestore';
import { subscribeShared } from './repositoryRuntime';

const CATALOG_ITEMS_METRIC_KEY = 'catalog.items-batch.subscribe.v1';
export const CATALOG_ITEM_QUERY_MAX_IDS = 10;

const normalizeCatalogItemId = (itemId) => {
  if (typeof itemId !== 'string' || !itemId.trim() || itemId.includes('/')) {
    throw new TypeError('Catalog item IDs must be non-empty Firestore document IDs.');
  }
  return itemId.trim();
};

export const normalizeCatalogItemIds = (itemIds) => Array.from(new Set(
  (Array.isArray(itemIds) ? itemIds : [])
    .map(normalizeCatalogItemId)
)).sort();

const normalizeCatalogItemSnapshot = (snapshot) => {
  const itemId = normalizeCatalogItemId(snapshot?.id);
  const data = typeof snapshot.data === 'function' ? snapshot.data() : null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return Object.freeze({ ...data, id: itemId });
};

export const subscribeCatalogItems = (itemIds, observer) => {
  const stableItemIds = normalizeCatalogItemIds(itemIds);
  if (!stableItemIds.length || stableItemIds.length > CATALOG_ITEM_QUERY_MAX_IDS) {
    throw new RangeError(
      `Catalog item subscriptions require 1-${CATALOG_ITEM_QUERY_MAX_IDS} document IDs.`
    );
  }
  const instanceSuffix = JSON.stringify(stableItemIds);
  const requestedIds = new Set(stableItemIds);
  return subscribeShared({
    metricKey: CATALOG_ITEMS_METRIC_KEY,
    instanceKey: `catalog:items:${instanceSuffix}`,
    listen: ({ next, error }) => onSnapshot(
      labelFirestoreTarget(
        query(
          collection(db, 'catalogMedia'),
          where(documentId(), 'in', stableItemIds)
        ),
        CATALOG_ITEMS_METRIC_KEY
      ),
      (snapshot) => next(Object.freeze(Object.fromEntries(
        (Array.isArray(snapshot?.docs) ? snapshot.docs : []).flatMap((entry) => {
          const item = normalizeCatalogItemSnapshot(entry);
          return item && requestedIds.has(item.id) ? [[item.id, item]] : [];
        })
      ))),
      error
    ),
  }, observer);
};
