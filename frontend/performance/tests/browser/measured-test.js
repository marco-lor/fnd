const path = require('path');
const { test: base, expect } = require('@playwright/test');
const { resultsDir } = require('../../../scripts/performance/common');
const { warmBrowserAssetDelivery } = require('./helpers');

const MEASURED_BROWSER_ORIGIN = 'http://127.0.0.1:5000';

const test = base.extend({
  browserAssetWarmup: [async ({ browser }, use, workerInfo) => {
    const projectName = String(workerInfo.project.name || '');
    if (!/^[a-z0-9-]+$/.test(projectName)) {
      throw new Error(`Browser asset warmup rejected project name: ${projectName || 'missing'}.`);
    }
    await warmBrowserAssetDelivery({
      baseURL: MEASURED_BROWSER_ORIGIN,
      browser,
      diagnosticsPath: path.join(
        resultsDir,
        `browser-worker-asset-warmup-${projectName}.json`
      ),
      owner: `measured-worker:${projectName}`,
    });
    await use();
  }, {
    auto: true,
    scope: 'worker',
    timeout: 180_000,
  }],
});

module.exports = { test, expect };
