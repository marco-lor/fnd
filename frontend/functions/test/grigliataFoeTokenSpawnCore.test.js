const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSpawnedFoePlacementDocument,
  buildSpawnedFoeTokenDocument,
  isActiveGrigliataDm,
  normalizeSpawnGrigliataFoeTokenInput,
  spawnGrigliataFoeTokenIdentity,
  spawnGrigliataFoeTokenRequestHash,
  task07FoeTokenSpawnMode,
  task07SpawnReceiptMatches,
  TASK07_FOE_TOKEN_SPAWN_KIND,
} = require("../lib/grigliataFoeTokenSpawnCore");

const payload = {
  foeId: "foe-source",
  backgroundId: "arena-one",
  col: 3,
  row: 4,
  operationId: "spawn-foe-operation-0001",
};

test("foe-token spawn routes only write-enabled modes to canonical media", () => {
  assert.equal(task07FoeTokenSpawnMode(true), "canonical");
  assert.equal(task07FoeTokenSpawnMode(false), "legacy");
});

test("foe-token spawn requires a durable operation identity", () => {
  assert.deepEqual(normalizeSpawnGrigliataFoeTokenInput(payload), payload);
  assert.throws(
    () => normalizeSpawnGrigliataFoeTokenInput({...payload, operationId: ""}),
    /operationId/
  );
  assert.throws(
    () => normalizeSpawnGrigliataFoeTokenInput({...payload, col: 3.5}),
    /integer coordinates/
  );
});

test("durable retries resolve to one deterministic token and placement", () => {
  const first = spawnGrigliataFoeTokenIdentity(
    "dm-user",
    payload.operationId,
    payload.backgroundId
  );
  const replay = spawnGrigliataFoeTokenIdentity(
    "dm-user",
    payload.operationId,
    payload.backgroundId
  );
  const differentOperation = spawnGrigliataFoeTokenIdentity(
    "dm-user",
    "spawn-foe-operation-0002",
    payload.backgroundId
  );
  assert.deepEqual(first, replay);
  assert.notEqual(first.tokenId, differentOperation.tokenId);
  assert.equal(first.placementId, `${payload.backgroundId}__${first.tokenId}`);
  assert.match(first.tokenId, /^foe_[a-f0-9]{24}$/);
});

test("request hashes and receipts reject operation-key reuse", () => {
  const normalized = normalizeSpawnGrigliataFoeTokenInput(payload);
  const identity = spawnGrigliataFoeTokenIdentity(
    "dm-user",
    normalized.operationId,
    normalized.backgroundId
  );
  const requestHash = spawnGrigliataFoeTokenRequestHash(normalized);
  const receipt = {
    actorUid: "dm-user",
    kind: TASK07_FOE_TOKEN_SPAWN_KIND,
    requestHash,
    tokenId: identity.tokenId,
    placementId: identity.placementId,
  };
  assert.equal(task07SpawnReceiptMatches({
    receipt,
    actorUid: "dm-user",
    requestHash,
    tokenId: identity.tokenId,
    placementId: identity.placementId,
  }), true);
  assert.notEqual(
    requestHash,
    spawnGrigliataFoeTokenRequestHash({...normalized, row: 5})
  );
  assert.equal(task07SpawnReceiptMatches({
    receipt,
    actorUid: "dm-user",
    requestHash: spawnGrigliataFoeTokenRequestHash({...normalized, row: 5}),
    tokenId: identity.tokenId,
    placementId: identity.placementId,
  }), false);
});

test("only active DM profiles may spawn foe tokens", () => {
  assert.equal(isActiveGrigliataDm({role: "dm"}), true);
  assert.equal(isActiveGrigliataDm({role: "DM"}), true);
  assert.equal(isActiveGrigliataDm({role: "player"}), false);
  assert.equal(isActiveGrigliataDm({role: "dm", disabled: true}), false);
  assert.equal(isActiveGrigliataDm({
    role: "dm",
    deletionState: "pending",
  }), false);
});

test("spawn payloads snapshot foe state and bind the placement", () => {
  const timestamp = {seconds: 123};
  const token = buildSpawnedFoeTokenDocument({
    actorUid: "dm-user",
    foeId: payload.foeId,
    source: {name: "Goblin", stats: {hpTotal: 7}},
    timestamp,
  });
  const placement = buildSpawnedFoePlacementDocument({
    actorUid: "dm-user",
    backgroundId: payload.backgroundId,
    tokenId: "foe_token",
    col: payload.col,
    row: payload.row,
    label: token.label,
    imageUrl: token.imageUrl,
    timestamp,
  });
  assert.equal(token.foeSourceId, payload.foeId);
  assert.equal(token.stats.hpCurrent, 7);
  assert.equal(placement.backgroundId, payload.backgroundId);
  assert.equal(placement.tokenId, "foe_token");
  assert.equal(placement.isVisibleToPlayers, true);

  const explicitNullCurrent = buildSpawnedFoeTokenDocument({
    actorUid: "dm-user",
    foeId: payload.foeId,
    source: {
      name: "Goblin",
      stats: {hpTotal: 7, hpCurrent: null},
    },
    timestamp,
  });
  assert.equal(explicitNullCurrent.stats.hpCurrent, 7);
});
