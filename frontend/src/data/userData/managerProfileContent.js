import { updateProfileContent } from './userDataCommands';

const PROFILE_CONTENT_FIELDS = new Set([
  'conoscenze',
  'lingue',
  'professioni',
]);

const asMap = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const stableSerialize = (value) => {
  if (Array.isArray(value)) {
    return '[' + value.map(stableSerialize).join(',') + ']';
  }
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return '{' + Object.keys(value).sort().map(
    (key) => JSON.stringify(key) + ':' + stableSerialize(value[key])
  ).join(',') + '}';
};
const shortHash = (value) => {
  let hash = 2166136261;
  const input = stableSerialize(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const buildProfileContentMap = ({
  currentMap,
  action,
  name,
  value,
}) => {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName) throw new TypeError('A profile-content name is required.');
  const nextMap = { ...asMap(currentMap) };
  if (action === 'delete') {
    if (!Object.prototype.hasOwnProperty.call(nextMap, normalizedName)) {
      throw new Error('Profile content "' + normalizedName + '" no longer exists.');
    }
    delete nextMap[normalizedName];
    return nextMap;
  }
  if (action !== 'upsert') throw new TypeError('Unsupported profile-content action.');
  nextMap[normalizedName] = value;
  return nextMap;
};

export const persistProfileContentMap = ({
  userId,
  field,
  currentMap,
  action,
  name,
  value,
}) => {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new TypeError('A user ID is required.');
  }
  if (!PROFILE_CONTENT_FIELDS.has(field)) {
    throw new TypeError('Unsupported profile-content field.');
  }
  const nextMap = buildProfileContentMap({
    currentMap,
    action,
    name,
    value,
  });
  return updateProfileContent({
    userId,
    patch: { [field]: nextMap },
    retryKey: [
      'dm-profile-content',
      userId,
      field,
      action,
      shortHash(nextMap),
    ].join(':'),
  });
};
