const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_TASK07_MEDIA_CONTROL,
  normalizeTask07MediaControl,
  task07MediaModeForActor,
  task07MediaWritesV1ForActor,
} = require("../lib/task07MediaControl");

const enabled = {
  schemaVersion: 1,
  policyVersion: 1,
  mode: "v1-write",
  enabledPurposes: ["avatar"],
  enabledRoles: ["player"],
  enabledUids: ["user-1"],
};

test("Task 07 server control fails closed on missing or malformed data", () => {
  assert.equal(normalizeTask07MediaControl(null), LEGACY_TASK07_MEDIA_CONTROL);
  assert.equal(normalizeTask07MediaControl({...enabled, policyVersion: 2}).mode, "legacy");
  assert.equal(normalizeTask07MediaControl({...enabled, enabledUids: [""]}).mode, "legacy");
  assert.equal(normalizeTask07MediaControl({
    ...enabled,
    enabledUids: Array.from({length: 101}, (_, index) => `u-${index}`),
  }).mode, "legacy");
});

test("Task 07 server requires v1-write plus all three allowlists", () => {
  assert.equal(task07MediaWritesV1ForActor({
    control: enabled,
    purpose: "avatar",
    role: "PLAYER",
    uid: "user-1",
  }), true);
  assert.equal(task07MediaWritesV1ForActor({
    control: {...enabled, mode: "canonical-only"},
    purpose: "avatar",
    role: "PLAYER",
    uid: "user-1",
  }), true);
  assert.equal(task07MediaModeForActor({
    control: {...enabled, mode: "shadow"},
    purpose: "avatar",
    role: "player",
    uid: "user-1",
  }), "shadow");
  assert.equal(task07MediaWritesV1ForActor({
    control: enabled,
    purpose: "map",
    role: "player",
    uid: "user-1",
  }), false);
  assert.equal(task07MediaWritesV1ForActor({
    control: {...enabled, enabledPurposes: ["*"], enabledRoles: ["*"], enabledUids: ["*"]},
    purpose: "map-video",
    role: "dm",
    uid: "dm-1",
  }), true);
});

test("Task 07 server accepts canonical-only but rejects pending as control data", () => {
  assert.equal(normalizeTask07MediaControl({
    ...enabled,
    mode: "canonical-only",
  }).mode, "canonical-only");
  assert.equal(normalizeTask07MediaControl({...enabled, mode: "pending"}).mode, "legacy");
});
