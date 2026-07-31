export const LEGACY_CLEANUP_SWEEP_STATES = [
  "pending",
  "retry",
  "processing",
] as const;

export const LEGACY_CLEANUP_RETAINED_REASON =
  "reference-fence-unavailable" as const;

type LegacyCleanupClaimInput = {
  state: string;
  nowMs: number;
  cleanupAfterMs: number | null;
  leaseUntilMs: number | null;
};

export const isLegacyCleanupClaimable = (
  input: LegacyCleanupClaimInput
): boolean => {
  if (!(LEGACY_CLEANUP_SWEEP_STATES as readonly string[])
    .includes(input.state)) return false;
  if (input.cleanupAfterMs !== null && input.cleanupAfterMs > input.nowMs) {
    return false;
  }
  return input.leaseUntilMs === null || input.leaseUntilMs <= input.nowMs;
};

export const settleUnfencedLegacyCleanup = <T>(
  entries: readonly T[]
): {
  state: "complete" | "retained";
  retained: T[];
  retainedReason: typeof LEGACY_CLEANUP_RETAINED_REASON | null;
} => entries.length ? {
  state: "retained",
  retained: [...entries],
  retainedReason: LEGACY_CLEANUP_RETAINED_REASON,
} : {
  state: "complete",
  retained: [],
  retainedReason: null,
};
