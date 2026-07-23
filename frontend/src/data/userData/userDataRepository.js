import { db } from '../../components/firebaseConfig';
import {
  applyDocChanges,
  subscribeShared,
} from '../repositoryRuntime';
import {
  collection,
  doc,
  documentId,
  labelFirestoreTarget,
  onSnapshot,
  orderBy,
  query,
} from '../../performance/firestore';
import { recordPerfEvent } from '../../performance/runtime';
import {
  USER_DATA_COLLECTION_IDS,
  USER_DATA_DOMAINS,
  USER_DATA_READ_SOURCES,
  USER_DATA_ROLLOUT_DOCUMENT,
  USER_DATA_ROLLOUT_STAGES,
  USER_DATA_STATE_DOCUMENT_IDS,
  isUserDataDomain,
  normalizeUserDataRolloutStage,
  resolveUserDataReadSource,
} from './domainSchema';
import {
  normalizeLegacyUserAggregate,
  normalizeV2InventoryDocument,
  normalizeV2PersonalContentDocument,
  mapV2PersonalContentItems,
  compareUserDomainValues,
  normalizeV2StateDocument,
  preserveUserDomainIdentity,
  selectLegacyDomain,
  selectLegacyProfile,
} from './normalizers';

const REMOTE_ROLLOUT_ENABLED = process.env.REACT_APP_FND_USER_DATA_ROLLOUT_CONFIG === '1';
const LOCAL_STAGE = normalizeUserDataRolloutStage(
  process.env.REACT_APP_FND_USER_DATA_STAGE,
  USER_DATA_ROLLOUT_STAGES.LEGACY_READ
);

const asObserver = (observer) => {
  if (typeof observer === 'function') return { next: observer };
  if (!observer || typeof observer !== 'object') throw new TypeError('A user-data observer is required.');
  return observer;
};

const validateUid = (uid) => {
  if (typeof uid !== 'string' || !uid.trim()) throw new TypeError('A non-empty user UID is required.');
  return uid;
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
}) => subscribeShared({
  metricKey,
  instanceKey,
  actorScoped,
  listen: ({ next, error }) => onSnapshot(
    labelFirestoreTarget(target, metricKey),
    {
      next: (snapshot) => next(normalize(snapshot)),
      error,
    }
  ),
}, observer);

export const subscribeLegacyUserAggregate = (uid, observer) => {
  const userId = validateUid(uid);
  return listenToDocument({
    target: doc(db, 'users', userId),
    metricKey: 'users.aggregate.subscribe.v1',
    instanceKey: `users:aggregate:${userId}`,
    normalize: (snapshot) => normalizeLegacyUserAggregate(normalizeDocumentSnapshot(snapshot)),
    observer,
  });
};

// Auth owns this dedicated physical listener. Profile snapshots can change the
// repository access scope (for example, player -> DM), which intentionally
// invalidates ordinary actor-scoped resources. Keeping a separate, resilient
// entry lets the authoritative profile listener observe the next snapshot
// without weakening the scope of users:aggregate:${uid} subscriptions.
export const subscribeAuthProfileAggregate = (uid, observer) => {
  const userId = validateUid(uid);
  return listenToDocument({
    target: doc(db, 'users', userId),
    metricKey: 'users.aggregate.subscribe.v1',
    instanceKey: `users:auth-profile:${userId}`,
    normalize: (snapshot) => normalizeLegacyUserAggregate(normalizeDocumentSnapshot(snapshot)),
    observer,
    actorScoped: false,
  });
};

export const subscribeUserShell = (uid, observer) => {
  const normalizedObserver = asObserver(observer);
  let previous;
  return subscribeLegacyUserAggregate(uid, {
    next: (aggregate) => {
      const next = preserveUserDomainIdentity(previous, selectLegacyProfile(aggregate));
      previous = next;
      normalizedObserver.next?.(next);
    },
    error: normalizedObserver.error,
  });
};

export const resolveUserDataRolloutDocumentStage = (data, uid) => {
  if (!data || typeof data !== 'object') return USER_DATA_ROLLOUT_STAGES.LEGACY_READ;
  const override = data.userOverrides?.[uid];
  return normalizeUserDataRolloutStage(
    override,
    normalizeUserDataRolloutStage(data.mode ?? data.stage)
  );
};

export const userDataRolloutInstanceKey = (uid) => (
  `users:rollout:user-data-v2:${validateUid(uid)}`
);

export const subscribeUserDataRolloutStage = (uid, observer) => {
  const userId = validateUid(uid);
  const normalizedObserver = asObserver(observer);
  if (!REMOTE_ROLLOUT_ENABLED) {
    normalizedObserver.next?.(LOCAL_STAGE);
    return () => {};
  }
  return listenToDocument({
    target: doc(db, USER_DATA_ROLLOUT_DOCUMENT.collection, USER_DATA_ROLLOUT_DOCUMENT.id),
    metricKey: 'users.rollout.subscribe.v2',
    // Effective stages are UID-specific because the shared document can carry
    // per-user overrides. Sharing this normalized listener across UIDs would
    // leak the first subscriber's resolved stage to every later observer.
    instanceKey: userDataRolloutInstanceKey(userId),
    normalize: (snapshot) => snapshot?.exists?.() ? snapshot.data() : null,
    observer: {
      next: (data) => normalizedObserver.next?.(
        resolveUserDataRolloutDocumentStage(data, userId)
      ),
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
  let activeSourceUnsubscribe = null;
  let shadowUnsubscribe = null;
  let shadowInventoryUnsubscribe = null;
  let activeSource = null;
  let activeStage = null;
  let previousValue;
  let latestLegacy;
  let latestLegacyAggregate;
  let latestV2;
  let latestV2Inventory;
  let hasV2InventoryContext = false;
  let lastShadowSignature = null;

  const reportShadowComparison = () => {
    if (latestLegacy === undefined || latestV2 === undefined) return;
    if (domain === USER_DATA_DOMAINS.EQUIPMENT && !hasV2InventoryContext) return;
    const comparison = compareUserDomainValues(latestLegacy, latestV2, {
      domain,
      legacyInventory: latestLegacyAggregate?.inventory,
      v2Inventory: latestV2Inventory,
    });
    const { legacy: legacySummary, v2: v2Summary } = comparison;
    const signature = `${legacySummary.count}:${legacySummary.hash}:${v2Summary.count}:${v2Summary.hash}`;
    if (signature === lastShadowSignature) return;
    lastShadowSignature = signature;
    recordPerfEvent({
      category: 'user-data',
      metric: 'shadow-domain-mismatch',
      value: comparison.valueMismatch ? 1 : 0,
      tags: {
        domain,
        countMismatch: comparison.countMismatch ? 'true' : 'false',
        valueMismatch: comparison.valueMismatch ? 'true' : 'false',
      },
    });
  };

  const configureShadowVerification = (stage) => {
    const shouldVerify = stage === USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY
      && domain !== USER_DATA_DOMAINS.PROFILE;
    if (!shouldVerify) {
      shadowUnsubscribe?.();
      shadowInventoryUnsubscribe?.();
      shadowUnsubscribe = null;
      shadowInventoryUnsubscribe = null;
      latestLegacy = undefined;
      latestLegacyAggregate = undefined;
      latestV2 = undefined;
      latestV2Inventory = undefined;
      hasV2InventoryContext = false;
      lastShadowSignature = null;
      return;
    }
    if (shadowUnsubscribe) return;
    shadowUnsubscribe = subscribeV2Domain(userId, domain, {
      next: (value) => {
        latestV2 = value;
        reportShadowComparison();
      },
      error: (error) => recordPerfEvent({
        category: 'user-data',
        metric: 'shadow-domain-error',
        value: 1,
        tags: { domain, code: error?.code || 'unknown' },
      }),
    });
    if (domain === USER_DATA_DOMAINS.EQUIPMENT) {
      shadowInventoryUnsubscribe = subscribeV2Domain(userId, USER_DATA_DOMAINS.INVENTORY, {
        next: (value) => {
          latestV2Inventory = value;
          hasV2InventoryContext = true;
          reportShadowComparison();
        },
        error: (error) => recordPerfEvent({
          category: 'user-data',
          metric: 'shadow-domain-error',
          value: 1,
          tags: { domain: USER_DATA_DOMAINS.INVENTORY, code: error?.code || 'unknown' },
        }),
      });
    }
  };

  const switchSource = (stage) => {
    configureShadowVerification(stage);
    const nextSource = domain === USER_DATA_DOMAINS.PROFILE
      ? USER_DATA_READ_SOURCES.LEGACY
      : resolveUserDataReadSource(stage);
    if (nextSource === activeSource && stage === activeStage) return;
    activeSourceUnsubscribe?.();
    activeSource = nextSource;
    activeStage = stage;
    previousValue = undefined;

    const sourceObserver = {
      next: (value) => {
        if (activeSource === USER_DATA_READ_SOURCES.LEGACY) {
          latestLegacy = value;
          reportShadowComparison();
        }
        const next = preserveUserDomainIdentity(previousValue, value);
        previousValue = next;
        normalizedObserver.next?.(next, { source: activeSource, stage });
      },
      error: normalizedObserver.error,
    };
    if (nextSource === USER_DATA_READ_SOURCES.V2) {
      activeSourceUnsubscribe = subscribeV2Domain(userId, domain, sourceObserver);
    } else {
      activeSourceUnsubscribe = subscribeLegacyUserAggregate(userId, {
        next: (aggregate) => {
          latestLegacyAggregate = aggregate;
          sourceObserver.next(selectLegacyDomain(aggregate, domain));
        },
        error: sourceObserver.error,
      });
    }
  };

  const rolloutUnsubscribe = subscribeUserDataRolloutStage(userId, {
    next: switchSource,
    error: normalizedObserver.error,
  });

  return () => {
    rolloutUnsubscribe?.();
    activeSourceUnsubscribe?.();
    shadowUnsubscribe?.();
    shadowInventoryUnsubscribe?.();
    activeSourceUnsubscribe = null;
    shadowUnsubscribe = null;
    shadowInventoryUnsubscribe = null;
  };
};

export const subscribeUserProgression = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.PROGRESSION, observer);
export const subscribeUserResources = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.RESOURCES, observer);
export const subscribeUserSettings = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.SETTINGS, observer);
export const subscribeUserEquipment = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.EQUIPMENT, observer);
export const subscribeUserProfileContent = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.PROFILE_CONTENT, observer);
export const subscribeUserInventory = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.INVENTORY, observer);
export const subscribeUserSpells = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.SPELLS, observer);
export const subscribeUserTechniques = (uid, observer) => subscribeUserDomain(uid, USER_DATA_DOMAINS.TECHNIQUES, observer);
