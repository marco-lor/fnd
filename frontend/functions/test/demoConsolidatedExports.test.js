const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const functionsRoot = path.resolve(__dirname, "..");
const legacyDerivedExports = [
  "updateHpTotal",
  "updateManaTotal",
  "updateTotParameters",
  "updateAnimaModifier",
  "expireBarriera",
  "syncUserDirectory",
];

const inspectExports = (consolidated) => {
  const projectId = consolidated ? "demo-fnd-perf" : "fatins";
  const source = [
    "const functions = require('./lib/index.js');",
    "const names = ",
    JSON.stringify([
      ...legacyDerivedExports,
      "syncUserDerivedState",
      "runBackendOperationWorker",
    ]),
    ";",
    "process.stdout.write(JSON.stringify(",
    "Object.fromEntries(names.map((name) => ",
    "[name, typeof functions[name]]))));",
  ].join("");
  const result = childProcess.spawnSync(
    process.execPath,
    ["-e", source],
    {
      cwd: functionsRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GCLOUD_PROJECT: projectId,
        GOOGLE_CLOUD_PROJECT: projectId,
        FATINS_FIREBASE_PROJECT_ID: projectId,
        FND_TASK06_CONSOLIDATED_OWNER: consolidated ? "1" : "",
      },
      shell: false,
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("normal exports preserve every online-compatible legacy trigger", () => {
  const exportsByName = inspectExports(false);
  legacyDerivedExports.forEach((name) => {
    assert.equal(exportsByName[name], "function", name);
  });
  assert.equal(exportsByName.syncUserDerivedState, "function");
  assert.equal(exportsByName.runBackendOperationWorker, "function");
});

test("the generated env flag is exact-demo-only", () => {
  const {
    usesDemoConsolidatedOwner,
  } = require("../lib/demoConsolidatedOwner");
  const demo = {
    GCLOUD_PROJECT: "demo-fnd-perf",
    FATINS_FIREBASE_PROJECT_ID: "demo-fnd-perf",
  };
  assert.equal(
    usesDemoConsolidatedOwner(
      demo,
      () => "FND_TASK06_CONSOLIDATED_OWNER=1\n"
    ),
    true
  );
  assert.equal(
    usesDemoConsolidatedOwner(
      {...demo, GCLOUD_PROJECT: "fatins"},
      () => "FND_TASK06_CONSOLIDATED_OWNER=1\n"
    ),
    false
  );
  assert.equal(
    usesDemoConsolidatedOwner(
      demo,
      () => "FND_TASK06_CONSOLIDATED_OWNER=true\n"
    ),
    false
  );
});

test("demo consolidation omits legacy fan-out and keeps its sole owner", () => {
  const exportsByName = inspectExports(true);
  legacyDerivedExports.forEach((name) => {
    assert.equal(exportsByName[name], "undefined", name);
  });
  assert.equal(exportsByName.syncUserDerivedState, "function");
  assert.equal(exportsByName.runBackendOperationWorker, "function");
});
