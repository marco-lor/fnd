const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.resolve(__dirname, "..", "src");
const readSource = (fileName) => fs.readFileSync(
  path.join(sourceRoot, fileName),
  "utf8"
);

const assertNoTask06OperationState = (source, label) => {
  [
    "app_config/task06_backend",
    "backend_operations",
    "backend_operation_work",
    "user_operations",
    "backendOperationExpiry",
    "operationReceiptId",
  ].forEach((marker) => {
    assert.equal(
      source.includes(marker),
      false,
      `${label} must not reference ${marker}`
    );
  });
};

test("legacy spend callable is isolated from receipt-backed V2 work", () => {
  const wrapper = readSource("spendCharacterPoint.ts");
  const legacy = readSource("spendCharacterPointLegacy.ts");

  assert.match(
    wrapper,
    /export const spendCharacterPoint = onCall\([\s\S]*?spendCharacterPointLegacyHandler/
  );
  assert.match(
    wrapper,
    /export const spendCharacterPointV2 = onCall\([\s\S]*?spendCharacterPointHandler/
  );
  assert.match(
    wrapper,
    /validateOperationId\(suppliedOperationId\)/
  );
  assertNoTask06OperationState(legacy, "legacy spend handler");
  assert.match(legacy, /assertLegacyRootMutationAllowed/);
  assert.match(legacy, /tx\.update\(userRef, update\)/);
});

test("level-up dispatches absent operation IDs to the HEAD-compatible path", () => {
  const wrapper = readSource("levelUpUser.ts");
  const legacy = readSource("levelUpUserLegacy.ts");

  assert.match(
    wrapper,
    /Object\.prototype\.hasOwnProperty\.call\([\s\S]*?"operationId"/
  );
  assert.match(
    wrapper,
    /if \(!hasExplicitOperationId\) \{[\s\S]*?levelUpUserLegacyHandler/
  );
  assert.match(
    wrapper,
    /validateOperationId\(suppliedOperationId\)/
  );
  assertNoTask06OperationState(legacy, "legacy level-up handler");
  assert.match(legacy, /assertLegacyRootMutationAllowed/);
  assert.match(legacy, /collection\("level_events"\)\.doc\(\)/);
});

test("west1 foe alias uses legacy duplication while V2 owns Task 06", () => {
  const wrapper = readSource("duplicateFoeWithAssets.ts");
  const legacy = readSource("duplicateFoeWithAssetsLegacy.ts");

  assert.match(
    wrapper,
    /export const duplicateFoeWithAssets = onCall<DuplicatePayload>\([\s\S]*?region: LEGACY_REGION[\s\S]*?duplicateFoeWithAssetsLegacyHandler/
  );
  assert.match(
    wrapper,
    /export const duplicateFoeWithAssetsV2 = onCall<DuplicatePayload>\([\s\S]*?region: CANONICAL_REGION[\s\S]*?duplicateFoeHandler\([\s\S]*?true/
  );
  assertNoTask06OperationState(legacy, "legacy foe-duplication handler");
  assert.match(legacy, /collection\("duplications"\)/);
  assert.match(legacy, /"foes\/tecniche"/);
  assert.match(legacy, /"foes\/spells"/);
});
