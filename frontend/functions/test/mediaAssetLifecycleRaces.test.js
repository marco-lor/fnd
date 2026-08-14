const test = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");

const lifecycleSource = readFileSync(join(
  __dirname,
  "../src/mediaAssetLifecycle.ts"
), "utf8");
const processorSource = readFileSync(join(
  __dirname,
  "../src/mediaAssetProcessor.ts"
), "utf8");
const targetAdaptersSource = readFileSync(join(
  __dirname,
  "../src/mediaTargetAdapters.ts"
), "utf8");
const duplicateFoeSource = readFileSync(join(
  __dirname,
  "../src/duplicateFoeWithAssets.ts"
), "utf8");
const spawnFoeTokenSource = readFileSync(join(
  __dirname,
  "../src/spawnGrigliataFoeTokenV2.ts"
), "utf8");

test("processor code never offers promoted canonical paths to deletion", () => {
  assert.doesNotMatch(
    processorSource,
    /deletePaths\(\[\.\.\.temporaryPaths,\s*\.\.\.finalPaths\]\)/
  );
  assert.match(processorSource, /task07ProcessorFailureCleanupPaths\(\{/);
  assert.match(
    processorSource,
    /sourceFile\.delete\(\{ignoreNotFound: true\}\)\.catch/
  );
  assert.equal(
    (processorSource.match(
      /Number\([^\n]*get\("error\.attempts"\)\) !==/g
    ) || []).length,
    2
  );
});

test("cleanup claims fence manifests and stale failures use attempt CAS", () => {
  assert.match(lifecycleSource, /state: "cleanup-pending"/);
  assert.match(
    lifecycleSource,
    /Number\(queue\.get\("attempts"\)\) !== attempts/
  );
  assert.match(
    lifecycleSource,
    /isTask07CleanupQueueClaimable\(\{[\s\S]*?leaseUntilMs:/
  );
});

test("manual retry is state guarded and sweeps paginate past terminals", () => {
  assert.match(
    lifecycleSource,
    /isTask07MediaStateManualCleanupRetryable\(/
  );
  assert.match(
    lifecycleSource,
    /!\["retry", "dead-letter"\]\.includes\(queueState\)/
  );
  assert.match(lifecycleSource, /query = query\.startAfter\(cursor\)/);
  assert.match(
    lifecycleSource,
    /partitionTask07CleanupSweepRecords\(/
  );
  assert.match(
    lifecycleSource,
    /partitioned\.terminal[\s\S]*?cleanupAfter:\s*FieldValue\.delete\(\)/
  );
});

test(`reference-removal triggers retry transient delivery failures`, () => {
  assert.match(
    lifecycleSource,
    /const referenceRemovalTrigger[\s\S]*?retry:\s*true/
  );
});

test("generated temporary copies are durably recorded and swept", () => {
  assert.match(
    processorSource,
    /pendingTemporaryPaths = await deleteTask07TemporaryPathsBestEffort\([\s\S]*?temporaryPaths: pendingTemporaryPaths/
  );
  assert.match(
    processorSource,
    /attemptSuffix = `-\$\{claimed\.attempt\}`[\s\S]*?\.tmp-\$\{eventId\}/
  );
  assert.match(
    processorSource,
    /snapshot\.get\("cleanupTemporaryPaths"\)[\s\S]*?\.\.\.input\.temporaryPaths/
  );
  assert.match(
    processorSource,
    /current\.get\("cleanupTemporaryPaths"\)[\s\S]*?\.\.\.promoted\.temporaryPaths/
  );
  assert.match(
    processorSource,
    /task07TemporaryCleanupFields\(cleanupTemporaryPaths, now\)/
  );
  assert.match(
    processorSource,
    /processTask07TemporaryCleanup\(claimed\.plan\.assetId\)/
  );
  assert.match(
    spawnFoeTokenSource,
    /task07TemporaryCleanupFields\([\s\S]*?cleanupTemporaryPaths[\s\S]*?processTask07TemporaryCleanup\(/
  );
  assert.match(
    spawnFoeTokenSource,
    /pendingTemporaryPaths = await deleteTask07TemporaryPathsBestEffort\([\s\S]*?temporaryPaths: pendingTemporaryPaths/
  );
  assert.match(
    spawnFoeTokenSource,
    /pendingTemporaryPaths = processed\.objects\.map\([\s\S]*?uploadTask07GeneratedSet\(/
  );
  assert.match(lifecycleSource, /await sweepTask07TemporaryCleanup\(\)/);
});

test("reference-removal transactions fence delayed reattachments", () => {
  assert.match(
    lifecycleSource,
    /transaction\.getAll\(\s*ref,\s*currentTargetRef\s*\)/
  );
  assert.match(
    lifecycleSource,
    /currentTargetReferences\[slot\]\.includes\(removedAssetId\)/
  );
  assert.match(
    lifecycleSource,
    /currentTargetReferences\[slot\]\.includes\(removedAssetId\)[\s\S]*?transaction\.update\(ref,\s*\{[\s\S]*?state: "superseded"/
  );
});

test("foe prepare and retirement reject conflicts and mutate canonically", () => {
  assert.match(
    lifecycleSource,
    /task07MediaTargetState\(data, plan\)/
  );
  assert.match(
    targetAdaptersSource,
    /task07MediaTargetState[\s\S]*?task07FoeCanonicalMediaStateFromTarget\(data\)/
  );
  assert.match(
    lifecycleSource,
    /plan\.nestedTarget[\s\S]*?\[\s*["']superseded["'],\s*["']cleanup-pending["'],\s*["']deleted["'][\s\S]*?targetBinding\.conflict[\s\S]*?task07NestedMediaRetirementPatch\(/
  );
  assert.match(
    lifecycleSource,
    /task07FoeCanonicalRetirementPatch\(\{[\s\S]*?revision:\s*targetBinding\.revision,[\s\S]*?transaction\.update\(targetRef, targetUpdate\)/
  );
  assert.match(
    lifecycleSource,
    /task07CanonicalRootRetirementPatch\(\{[\s\S]*?current:\s*target\.data\(\)[\s\S]*?plan,[\s\S]*?revision:\s*targetBinding\.revision/
  );
});

test("attachment and long-running foe duplication recheck the live actor", () => {
  assert.match(
    targetAdaptersSource,
    /transaction\.getAll\(\s*assetRef,\s*controlRef,\s*actorRef\s*\)/
  );
  assert.match(
    targetAdaptersSource,
    /actor\.get\("deletionState"\) === "pending"/
  );
  assert.ok((duplicateFoeSource.match(
    /actorSnapshotIsActiveDm\(actor\)/g
  ) || []).length >= 3);
  assert.match(
    duplicateFoeSource,
    /canonicalFoeClonePlanBudgetIssue\(clones\)/
  );
});
