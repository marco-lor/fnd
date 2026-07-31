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

test("foe prepare and retirement reject conflicts and mutate canonically", () => {
  assert.match(
    lifecycleSource,
    /task07FoeCanonicalMediaStateFromTarget\(data\)/
  );
  assert.equal(
    (lifecycleSource.match(/targetBinding\.conflict/g) || []).length,
    2
  );
  assert.match(
    lifecycleSource,
    /task07FoeCanonicalRetirementPatch\(\{[\s\S]*?revision:\s*targetBinding\.revision,[\s\S]*?transaction\.update\(targetRef, targetUpdate\)/
  );
});
