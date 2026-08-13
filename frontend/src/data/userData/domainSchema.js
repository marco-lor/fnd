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
