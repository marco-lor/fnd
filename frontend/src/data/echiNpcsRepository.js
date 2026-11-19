import { db } from '../components/firebaseConfig';
import { collection, labelFirestoreTarget, onSnapshot } from '../performance/firestore';
import { applyDocChanges, subscribeShared } from './repositoryRuntime';

const METRIC_KEY = 'echi.npcs.subscribe.v1';
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// Firestore compares UTF-8 bytes, including for its implicit document-ID tie-break.
const compareStrings = (left, right) => {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = compare(a[index], b[index]);
    if (difference) return difference;
  }
  return compare(a.length, b.length);
};

// Existing createdAt values are null, Timestamp or legacy ISO strings. Preserve
// Firestore's mixed-type order rather than coercing strings into dates.
const timestampOrder = (value, pending = false) => {
  if (value == null) return { rank: 0, value: null };
  if (typeof value === 'boolean') return { rank: 1, value };
  if (typeof value === 'number') return { rank: 2, value };
  if (typeof value === 'string') return { rank: 5, value };
  return { rank: pending ? 4 : 3, value };
};

const compareCreatedAt = (left, right) => {
  const rank = compare(left.rank, right.rank);
  if (rank) return rank;
  if (left.rank === 3 || left.rank === 4) {
    return compare(left.value.seconds, right.value.seconds)
      || compare(left.value.nanoseconds, right.value.nanoseconds);
  }
  if (left.rank === 5) return compareStrings(left.value, right.value);
  if (left.rank === 2) {
    if (Number.isNaN(left.value)) return Number.isNaN(right.value) ? 0 : -1;
    if (Number.isNaN(right.value)) return 1;
  }
  return compare(left.value, right.value);
};

/** Derive sidebar order without disturbing collection indices used by docChanges. */
export const createEchiNpcsProjector = () => {
  let structural = null;
  let projection = null;
  const orderByEntity = new WeakMap();
  const normalize = (document) => {
    const raw = document.data();
    const entity = { ...raw, id: document.id };
    if (Object.prototype.hasOwnProperty.call(raw, 'createdAt')) {
      // A pending serverTimestamp reads as null by default, but sorts after all
      // acknowledged timestamps. Its public estimate supplies local write time.
      const estimate = raw.createdAt === null
        ? document.data({ serverTimestamps: 'estimate' }).createdAt
        : raw.createdAt;
      orderByEntity.set(entity, timestampOrder(estimate, raw.createdAt === null && estimate != null));
    }
    return entity;
  };
  return (snapshot) => {
    const nextStructural = applyDocChanges(structural, snapshot, normalize);
    if (projection && nextStructural === structural) return projection;
    structural = nextStructural;
    projection = {
      byId: structural.byId,
      items: structural.items.filter((entity) => orderByEntity.has(entity)).sort((left, right) => (
        compareCreatedAt(orderByEntity.get(right), orderByEntity.get(left))
        || compareStrings(right.id, left.id)
      )),
    };
    return projection;
  };
};

/** One unbounded reader, shared within the actor/access scope of the route. */
export const subscribeEchiNpcs = (observer, { scopeKey = 'route' } = {}) => subscribeShared({
  metricKey: METRIC_KEY,
  instanceKey: `${METRIC_KEY}:${scopeKey}`,
  listen: ({ next, error }) => {
    const project = createEchiNpcsProjector();
    return onSnapshot(labelFirestoreTarget(collection(db, 'echi_npcs'), METRIC_KEY), {
      next: (snapshot) => next(project(snapshot)),
      error,
    });
  },
}, observer);
