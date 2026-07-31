export const USER_DATA_SCHEMA_VERSION = 2;

export const USER_DATA_DOMAINS = Object.freeze({
  PROFILE: 'profile',
  PROGRESSION: 'progression',
  RESOURCES: 'resources',
  SETTINGS: 'settings',
  EQUIPMENT: 'equipment',
  PROFILE_CONTENT: 'profileContent',
  INVENTORY: 'inventory',
  SPELLS: 'spells',
  TECHNIQUES: 'techniques',
});

export const USER_DATA_ROLLOUT_STAGES = Object.freeze({
  LEGACY_READ: 'legacy-read',
  SHADOW_VERIFY: 'shadow-verify',
  DUAL_WRITE: 'dual-write',
  NEW_READ_DUAL_WRITE: 'new-read-dual-write',
  NEW_ONLY: 'new-only',
});

export const USER_DATA_READ_SOURCES = Object.freeze({
  LEGACY: 'legacy',
  V2: 'v2',
});

const VALID_STAGES = new Set(Object.values(USER_DATA_ROLLOUT_STAGES));
const V2_READ_STAGES = new Set([
  USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE,
  USER_DATA_ROLLOUT_STAGES.NEW_ONLY,
]);

export const isUserDataRolloutStage = (value) => VALID_STAGES.has(value);

export const normalizeUserDataRolloutStage = (value, fallback = USER_DATA_ROLLOUT_STAGES.LEGACY_READ) => (
  isUserDataRolloutStage(value) ? value : fallback
);

export const resolveUserDataReadSource = (stage) => (
  V2_READ_STAGES.has(normalizeUserDataRolloutStage(stage))
    ? USER_DATA_READ_SOURCES.V2
    : USER_DATA_READ_SOURCES.LEGACY
);

export const USER_DATA_ROLLOUT_DOCUMENT = Object.freeze({
  collection: 'app_config',
  id: 'user_data_v2',
});

export const USER_DATA_STATE_DOCUMENT_IDS = Object.freeze({
  [USER_DATA_DOMAINS.PROGRESSION]: 'progression',
  [USER_DATA_DOMAINS.RESOURCES]: 'resources',
  [USER_DATA_DOMAINS.SETTINGS]: 'settings',
  [USER_DATA_DOMAINS.EQUIPMENT]: 'equipment',
  [USER_DATA_DOMAINS.PROFILE_CONTENT]: 'profileContent',
});

export const USER_DATA_COLLECTION_IDS = Object.freeze({
  [USER_DATA_DOMAINS.INVENTORY]: 'inventory',
  [USER_DATA_DOMAINS.SPELLS]: 'spells',
  [USER_DATA_DOMAINS.TECHNIQUES]: 'tecniche',
});

export const isUserDataDomain = (value) => Object.values(USER_DATA_DOMAINS).includes(value);
