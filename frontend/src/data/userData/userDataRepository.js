import { db } from '../../components/firebaseConfig';
import {
  applyDocChanges,
  subscribeShared,
} from '../repositoryRuntime';
import {
  collection,
  doc,
  documentId,
  getDoc,
  labelFirestoreTarget,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from '../../performance/firestore';
import {
  USER_DATA_COLLECTION_IDS,
  USER_DATA_DOMAINS,
  USER_DATA_STATE_DOCUMENT_IDS,
  isUserDataDomain,
} from './domainSchema';
import {
  normalizeUserShell,
  normalizeV2InventoryDocument,
  normalizeV2PersonalContentDocument,
  mapV2PersonalContentItems,
  normalizeV2StateDocument,
  preserveUserDomainIdentity,
} from './normalizers';

const asObserver = (observer) => {
  if (typeof observer === 'function') return { next: observer };
  if (!observer || typeof observer !== 'object') throw new TypeError('A user-data observer is required.');
  return observer;
};

const validateUid = (uid) => {
  if (typeof uid !== 'string' || !uid.trim()) throw new TypeError('A non-empty user UID is required.');
  return uid;
};

const USER_PROFILE_MEDIA_FIELDS = new Set(['imageUrl', 'imagePath', 'media']);

const normalizeUserProfileMediaPatch = (patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('A profile media patch is required.');
  }
  const entries = Object.entries(patch);
  if (
    entries.length === 0
    || entries.some(([field]) => !USER_PROFILE_MEDIA_FIELDS.has(field))
  ) {
    throw new TypeError('Profile media patches may update only media fields.');
  }
  return Object.fromEntries(entries.map(([field, value]) => {
    if (field === 'media') {
      if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw new TypeError('Profile media metadata must be an object or null.');
      }
    } else if (typeof value !== 'string') {
      throw new TypeError(`Profile ${field} must be a string.`);
    }
    return [field, value];
  }));
};

export const updateUserProfileMedia = (uid, patch) => updateDoc(
  doc(db, 'users', validateUid(uid)),
  normalizeUserProfileMediaPatch(patch)
);

const TASK07_USER_COLLECTIONS = new Set(['inventory', 'spells', 'tecniche']);

const validateUserEntityId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(normalized)) {
    throw new TypeError('A valid user-data entity ID is required.');
  }
  return normalized;
};

export const readUserDataRole = async (uid) => {
  const snapshot = await getDoc(doc(db, 'users', validateUid(uid)));
  const role = snapshot.exists() ? snapshot.data()?.role : null;
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
};

export const readUserOwnedDataDocument = async (uid, collectionId, entityId) => {
  if (!TASK07_USER_COLLECTIONS.has(collectionId)) {
    throw new TypeError('Unsupported user-data collection.');
  }
  const snapshot = await getDoc(doc(
    db,
    'users',
    validateUid(uid),
    collectionId,
    validateUserEntityId(entityId)
  ));
  return snapshot.exists()
    ? { id: snapshot.id, data: snapshot.data() || {} }
    : null;
};

const normalizeDocumentSnapshot = (snapshot) => (
  snapshot?.exists?.() ? snapshot.data() : null
);

const listenToDocument = ({
  target,
  metricKey,
  instanceKey,
  normalize,
  observer,
  actorScoped = true,
  ownership = 'route',
}) => subscribeShared({
  metricKey,
  instanceKey,
  actorScoped,
  listen: ({ next, error }) => onSnapshot(
    labelFirestoreTarget(target, metricKey, ownership),
    {
      next: (snapshot) => next(normalize(snapshot)),
      error,
    }
  ),
}, observer);

// Auth owns this dedicated shell listener. Profile snapshots can change the
// repository access scope (for example, player -> DM), so it remains outside
// ordinary actor-scoped resources.
export const subscribeAuthProfile = (uid, observer) => {
  const userId = validateUid(uid);
  return listenToDocument({
    target: doc(db, 'users', userId),
    metricKey: 'users.shell.subscribe.v2',
    instanceKey: `users:auth-profile:${userId}`,
    normalize: (snapshot) => normalizeUserShell(normalizeDocumentSnapshot(snapshot)),
    observer,
    actorScoped: false,
    ownership: 'shell',
  });
};

export const subscribeUserShell = (uid, observer) => {
  const userId = validateUid(uid);
  const normalizedObserver = asObserver(observer);
  let previous;
  return listenToDocument({
    target: doc(db, 'users', userId),
    metricKey: 'users.shell.subscribe.v2',
    instanceKey: `users:shell:${userId}`,
    normalize: (snapshot) => normalizeUserShell(normalizeDocumentSnapshot(snapshot)),
    observer: {
      next: (shell) => {
        const next = preserveUserDomainIdentity(previous, shell);
        previous = next;
        normalizedObserver.next?.(next);
      },
      error: normalizedObserver.error,
    },
  });
};

const stateMetricKey = (domain) => `users.${domain.toLowerCase()}.subscribe.v2`;

const subscribeV2StateDomain = (uid, domain, observer) => {
  const stateDocumentId = USER_DATA_STATE_DOCUMENT_IDS[domain];
  if (!stateDocumentId) throw new TypeError(`Domain ${domain} is not a V2 state document.`);
  return listenToDocument({
    target: doc(db, 'users', uid, 'state', stateDocumentId),
    metricKey: stateMetricKey(domain),
    instanceKey: `users:v2:${uid}:state:${stateDocumentId}`,
    normalize: (snapshot) => normalizeV2StateDocument(domain, normalizeDocumentSnapshot(snapshot)),
    observer,
  });
};

const collectionMetricKey = (domain) => `users.${domain.toLowerCase()}.subscribe.v2`;

const subscribeV2CollectionDomain = (uid, domain, observer) => {
  const collectionId = USER_DATA_COLLECTION_IDS[domain];
  if (!collectionId) throw new TypeError(`Domain ${domain} is not a V2 collection.`);
  const metricKey = collectionMetricKey(domain);
  const base = collection(db, 'users', uid, collectionId);
  // Until the personal-content screens expose an explicit load-more control,
  // subscribe to the complete ordered collection. A first-page-only listener
  // would silently hide existing records after item 50.
  const target = domain === USER_DATA_DOMAINS.INVENTORY
    ? base
    : query(base, orderBy('normalizedName'), orderBy(documentId()));
  let structuralResult = null;
  return subscribeShared({
    metricKey,
    instanceKey: `users:v2:${uid}:${collectionId}:first`,
    listen: ({ next, error }) => onSnapshot(
      labelFirestoreTarget(target, metricKey),
      {
        next: (snapshot) => {
          structuralResult = applyDocChanges(
            structuralResult,
            snapshot,
            domain === USER_DATA_DOMAINS.INVENTORY
              ? normalizeV2InventoryDocument
              : normalizeV2PersonalContentDocument
          );
          if (domain === USER_DATA_DOMAINS.INVENTORY) {
            next(structuralResult.items);
            return;
          }
          next(mapV2PersonalContentItems(structuralResult.items));
        },
        error,
      }
    ),
  }, observer);
};

const subscribeV2Domain = (uid, domain, observer) => {
  if (domain === USER_DATA_DOMAINS.PROFILE) return subscribeUserShell(uid, observer);
  if (USER_DATA_STATE_DOCUMENT_IDS[domain]) return subscribeV2StateDomain(uid, domain, observer);
  return subscribeV2CollectionDomain(uid, domain, observer);
};

export const subscribeUserDomain = (uid, domain, observer) => {
  const userId = validateUid(uid);
  if (!isUserDataDomain(domain)) throw new TypeError(`Unsupported user-data domain: ${String(domain)}`);
  const normalizedObserver = asObserver(observer);
  let previousValue;
  return subscribeV2Domain(userId, domain, {
    next: (value) => {
      const next = preserveUserDomainIdentity(previousValue, value);
      previousValue = next;
      normalizedObserver.next?.(next);
    },
    error: normalizedObserver.error,
  });
};

export const subscribeUserProgression = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.PROGRESSION, observer);
export const subscribeUserResources = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.RESOURCES, observer);
export const subscribeUserSettings = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.SETTINGS, observer);
export const subscribeUserEquipment = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.EQUIPMENT, observer);
export const subscribeUserProfileContent = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.PROFILE_CONTENT, observer);
export const subscribeUserInventory = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.INVENTORY, observer);
export const subscribeUserSpells = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.SPELLS, observer);
export const subscribeUserTechniques = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.TECHNIQUES, observer);
