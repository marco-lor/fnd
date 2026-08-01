import { db } from '../components/firebaseConfig';
import {
  doc,
  labelFirestoreTarget,
  onSnapshot,
} from '../performance/firestore';
import { subscribeShared } from './repositoryRuntime';

const CATALOG_ITEM_METRIC_KEY = 'catalog.item.subscribe.v1';

const normalizeCatalogItemId = (itemId) => {
  if (typeof itemId !== 'string' || !itemId.trim() || itemId.includes('/')) {
    throw new TypeError('Catalog item IDs must be non-empty Firestore document IDs.');
  }
  return itemId.trim();
};

const normalizeCatalogItemSnapshot = (itemId, snapshot) => {
  if (!snapshot || typeof snapshot.exists !== 'function' || !snapshot.exists()) return null;
  const data = typeof snapshot.data === 'function' ? snapshot.data() : null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return Object.freeze({ ...data, id: itemId });
};

export const subscribeCatalogItem = (itemId, observer) => {
  const stableItemId = normalizeCatalogItemId(itemId);
  return subscribeShared({
    metricKey: CATALOG_ITEM_METRIC_KEY,
    instanceKey: `catalog:item:${stableItemId}`,
    listen: ({ next, error }) => onSnapshot(
      labelFirestoreTarget(
        doc(db, 'items', stableItemId),
        CATALOG_ITEM_METRIC_KEY
      ),
      (snapshot) => next(normalizeCatalogItemSnapshot(stableItemId, snapshot)),
      error
    ),
  }, observer);
};
