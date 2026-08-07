const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isLegacyCleanupClaimable,
  LEGACY_CLEANUP_RETAINED_REASON,
  LEGACY_CLEANUP_SWEEP_STATES,
  settleUnfencedLegacyCleanup,
} = require("../lib/foeMediaRetirementCleanupCore.js");

test("legacy cleanup sweep includes expired processing leases", () => {
  assert.deepEqual(LEGACY_CLEANUP_SWEEP_STATES, [
    "pending",
    "retry",
    "processing",
  ]);
  assert.equal(isLegacyCleanupClaimable({
    state: "processing",
    nowMs: 1_000,
    cleanupAfterMs: 999,
    leaseUntilMs: 999,
  }), true);
  assert.equal(isLegacyCleanupClaimable({
    state: "processing",
    nowMs: 1_000,
    cleanupAfterMs: 1_001,
    leaseUntilMs: 1_001,
  }), false);
  assert.equal(isLegacyCleanupClaimable({
    state: "complete",
    nowMs: 1_000,
    cleanupAfterMs: null,
    leaseUntilMs: null,
  }), false);
});

test("unfenced legacy generations are retained instead of deleted", () => {
  const entries = [{path: "foes/shared.png", generation: "7"}];
  assert.deepEqual(settleUnfencedLegacyCleanup(entries), {
    state: "retained",
    retained: entries,
    retainedReason: LEGACY_CLEANUP_RETAINED_REASON,
  });
  assert.deepEqual(settleUnfencedLegacyCleanup([]), {
    state: "complete",
    retained: [],
    retainedReason: null,
  });
});
