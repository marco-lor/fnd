import { getTask07MediaControlDocument } from '../configRepository';
import { TASK07_MEDIA_POLICY_VERSION } from './mediaPolicy';

export const TASK07_MEDIA_MODES = Object.freeze([
  'legacy',
  'shadow',
  'derivative-read',
  'v1-write',
]);

const TASK07_MEDIA_MODE_SET = new Set(TASK07_MEDIA_MODES);
const MAX_ALLOWLIST_ENTRIES = 100;
const SAFE_ALLOWLIST_VALUE = /^[A-Za-z0-9*][A-Za-z0-9._:@*-]{0,127}$/;

const normalizeAllowlist = (value) => {
  if (!Array.isArray(value) || value.length > MAX_ALLOWLIST_ENTRIES) return null;
  const normalized = [...new Set(value.map((entry) => (
    typeof entry === 'string' ? entry.trim() : ''
  )))];
  return normalized.every((entry) => SAFE_ALLOWLIST_VALUE.test(entry))
    ? normalized
    : null;
};

export const LEGACY_TASK07_MEDIA_CONTROL = Object.freeze({
  mode: 'legacy',
  schemaVersion: 1,
  policyVersion: TASK07_MEDIA_POLICY_VERSION,
  enabledPurposes: Object.freeze([]),
  enabledRoles: Object.freeze([]),
  enabledUids: Object.freeze([]),
});

export const normalizeTask07MediaControl = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return LEGACY_TASK07_MEDIA_CONTROL;
  }
  const mode = typeof value.mode === 'string' ? value.mode.trim() : '';
  if (
    !TASK07_MEDIA_MODE_SET.has(mode)
    || value.schemaVersion !== 1
    || value.policyVersion !== TASK07_MEDIA_POLICY_VERSION
  ) {
    return LEGACY_TASK07_MEDIA_CONTROL;
  }
  if (mode === 'legacy') return LEGACY_TASK07_MEDIA_CONTROL;
  const enabledPurposes = normalizeAllowlist(value.enabledPurposes);
  const enabledRoles = normalizeAllowlist(value.enabledRoles);
  const enabledUids = normalizeAllowlist(value.enabledUids);
  if (!enabledPurposes || !enabledRoles || !enabledUids) {
    return LEGACY_TASK07_MEDIA_CONTROL;
  }
  return Object.freeze({
    mode,
    schemaVersion: 1,
    policyVersion: TASK07_MEDIA_POLICY_VERSION,
    enabledPurposes: Object.freeze(enabledPurposes),
    enabledRoles: Object.freeze(enabledRoles),
    enabledUids: Object.freeze(enabledUids),
  });
};

const allowlistContains = (values, candidate) => (
  values.includes('*') || (candidate && values.includes(candidate))
);

export const task07MediaModeForActor = ({
  control,
  purpose,
  role,
  uid,
}) => {
  const normalized = normalizeTask07MediaControl(control);
  if (normalized.mode === 'legacy') return 'legacy';
  const normalizedPurpose = typeof purpose === 'string' ? purpose.trim() : '';
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  const normalizedUid = typeof uid === 'string' ? uid.trim() : '';
  return (
    allowlistContains(normalized.enabledPurposes, normalizedPurpose)
    && allowlistContains(normalized.enabledRoles, normalizedRole)
    && allowlistContains(normalized.enabledUids, normalizedUid)
  )
    ? normalized.mode
    : 'legacy';
};

export const loadTask07MediaMode = async (actor) => {
  const control = await getTask07MediaControlDocument().catch(() => null);
  return task07MediaModeForActor({ ...actor, control });
};

export const task07ModeReadsDerivatives = (mode) => (
  mode === 'derivative-read' || mode === 'v1-write'
);

export const task07ModeWritesV1 = (mode) => mode === 'v1-write';
