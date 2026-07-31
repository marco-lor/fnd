const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const {
  projectId,
  readJson,
  resultsDir,
  writeJson,
} = require('../../../scripts/performance/common');
const {
  assertStaticAssetWarmupInventory,
  createStaticAssetWarmupBatches,
  runStaticAssetWarmupPass,
} = require('./helpers');

const WARMUP_BATCH_SIZE = 4;
const WARM_PASS_TIMEOUT_MS = 30_000;
const VALIDATION_PASS_TIMEOUT_MS = 5_000;
const diagnosticsPath = path.join(resultsDir, 'asset-warmup-diagnostics.json');
const buildReportPath = path.join(resultsDir, 'build-report.json');
const buildPath = path.resolve(__dirname, '..', '..', '..', 'build');
const buildStaticPath = path.join(buildPath, 'static');

const walk = (directoryPath) => (
  fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  })
);

const assertCurrentStaticInventory = (batches) => {
  const actualPaths = walk(buildStaticPath)
    .filter((filePath) => /\.(?:js|css)$/.test(filePath) && !filePath.endsWith('.map'))
    .map((filePath) => path.relative(buildPath, filePath).replace(/\\/g, '/'))
    .sort();
  assertStaticAssetWarmupInventory(batches, actualPaths);
};

test('warm and validate deterministic static asset delivery before browser measurements', async ({
  baseURL,
  request,
}) => {
  test.setTimeout(240_000);
  const diagnostics = {
    schemaVersion: 1,
    generatedAt: null,
    projectId,
    status: 'running',
    assetCount: 0,
    batchSize: WARMUP_BATCH_SIZE,
    passes: [],
    failure: null,
  };

  try {
    const origin = new URL(baseURL).origin;
    if (origin !== 'http://127.0.0.1:5000') {
      throw new Error(`Static asset warmup refuses non-owned origin: ${origin}.`);
    }
    const batches = createStaticAssetWarmupBatches(readJson(buildReportPath), {
      batchSize: WARMUP_BATCH_SIZE,
    });
    assertCurrentStaticInventory(batches);
    diagnostics.assetCount = batches.flat().length;

    for (const [passName, timeoutMs] of [
      ['warm', WARM_PASS_TIMEOUT_MS],
      ['validation', VALIDATION_PASS_TIMEOUT_MS],
    ]) {
      const results = await runStaticAssetWarmupPass({
        batches,
        passName,
        timeoutMs,
        requestAsset: (asset, { timeoutMs: requestTimeoutMs }) => request.get(asset.path, {
          headers: { 'Accept-Encoding': 'br' },
          timeout: requestTimeoutMs,
        }),
      });
      diagnostics.passes.push({
        name: passName,
        timeoutMs,
        results,
      });
    }

    const failures = diagnostics.passes.flatMap((pass) => (
      pass.results.filter((result) => !result.ok)
    ));
    if (failures.length) {
      throw new Error(
        `Static asset warmup failed ${failures.length} requests: `
        + failures.slice(0, 10).map((failure) => (
          `${failure.pass} ${failure.path}: ${failure.error}`
        )).join('; ')
      );
    }
    diagnostics.status = 'passed';
  } catch (error) {
    diagnostics.status = 'failed';
    diagnostics.failure = {
      message: error.message,
      stack: error.stack,
    };
    throw error;
  } finally {
    diagnostics.generatedAt = new Date().toISOString();
    writeJson(diagnosticsPath, diagnostics);
  }
});
