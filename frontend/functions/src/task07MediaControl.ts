import {
  MEDIA_CONTRACT_VERSION,
  MediaKind,
} from "./mediaContracts";

export type Task07MediaMode =
  "legacy" | "shadow" | "derivative-read" | "v1-write";

export interface Task07MediaControl {
  schemaVersion: 1;
  policyVersion: number;
  mode: Task07MediaMode;
  enabledPurposes: readonly string[];
  enabledRoles: readonly string[];
  enabledUids: readonly string[];
}

const MODES = new Set<Task07MediaMode>([
  "legacy", "shadow", "derivative-read", "v1-write",
]);
const MAX_ALLOWLIST_ENTRIES = 100;
const SAFE_ALLOWLIST_VALUE =
  /^[A-Za-z0-9*][A-Za-z0-9._:@*-]{0,127}$/;

export const LEGACY_TASK07_MEDIA_CONTROL: Task07MediaControl = Object.freeze({
  schemaVersion: 1,
  policyVersion: MEDIA_CONTRACT_VERSION,
  mode: "legacy",
  enabledPurposes: Object.freeze([]),
  enabledRoles: Object.freeze([]),
  enabledUids: Object.freeze([]),
});

const normalizedAllowlist = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length > MAX_ALLOWLIST_ENTRIES) {
    return null;
  }
  const result = [...new Set(value.map((entry) => (
    typeof entry === "string" ? entry.trim() : ""
  )))];
  return result.every((entry) => SAFE_ALLOWLIST_VALUE.test(entry)) ?
    Object.freeze(result) :
    null;
};

export const normalizeTask07MediaControl = (
  value: unknown
): Task07MediaControl => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return LEGACY_TASK07_MEDIA_CONTROL;
  }
  const input = value as Record<string, unknown>;
  const mode = typeof input.mode === "string" ? input.mode.trim() : "";
  if (!MODES.has(mode as Task07MediaMode) ||
    input.schemaVersion !== 1 ||
    input.policyVersion !== MEDIA_CONTRACT_VERSION ||
    mode === "legacy") {
    return LEGACY_TASK07_MEDIA_CONTROL;
  }
  const enabledPurposes = normalizedAllowlist(input.enabledPurposes);
  const enabledRoles = normalizedAllowlist(input.enabledRoles);
  const enabledUids = normalizedAllowlist(input.enabledUids);
  if (!enabledPurposes || !enabledRoles || !enabledUids) {
    return LEGACY_TASK07_MEDIA_CONTROL;
  }
  return Object.freeze({
    schemaVersion: 1,
    policyVersion: MEDIA_CONTRACT_VERSION,
    mode: mode as Task07MediaMode,
    enabledPurposes,
    enabledRoles,
    enabledUids,
  });
};

const includes = (values: readonly string[], candidate: string): boolean =>
  values.includes("*") || Boolean(candidate && values.includes(candidate));

export const task07MediaModeForActor = (input: {
  control: unknown;
  purpose: MediaKind;
  role: string;
  uid: string;
}): Task07MediaMode => {
  const control = normalizeTask07MediaControl(input.control);
  if (control.mode === "legacy") return "legacy";
  return includes(control.enabledPurposes, input.purpose) &&
    includes(control.enabledRoles, input.role.trim().toLowerCase()) &&
    includes(control.enabledUids, input.uid.trim()) ?
    control.mode :
    "legacy";
};

export const task07MediaWritesV1ForActor = (input: {
  control: unknown;
  purpose: MediaKind;
  role: string;
  uid: string;
}): boolean => task07MediaModeForActor(input) === "v1-write";
