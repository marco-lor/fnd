const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { resultsDir, writeJson } = require('../../../scripts/performance/common');
const {
  ACCOUNT,
  createPageAssetTracker,
  drainPageConnections,
  isExpectedFirestoreLifecycleCancellation,
  isKnownDemoFirestoreStartupWarning,
  waitForReadiness,
} = require('./helpers');

const authDirectory = path.resolve(__dirname, '..', '..', '..', 'playwright', '.auth');
const diagnosticsPath = path.join(resultsDir, 'auth-setup-diagnostics.json');

const summarizeDiagnostics = (accounts) => ({
  consoleErrors: accounts.reduce((total, account) => total + account.consoleErrors.length, 0),
  explainedFirestoreEmulatorStartupWarnings: accounts.reduce((total, account) => (
    total + account.explainedStartupWarnings.length
  ), 0),
  unhandledErrors: accounts.reduce((total, account) => total + account.unhandledErrors.length, 0),
  failedRequests: accounts.reduce((total, account) => total + account.failedRequests.length, 0),
  cleanupErrors: accounts.reduce((total, account) => total + account.cleanupErrors.length, 0),
});

test('create deterministic emulator authentication states', async ({ browser, baseURL }) => {
  fs.mkdirSync(authDirectory, { recursive: true });
  const accountDiagnostics = [];
  let setupError = null;
  try {
    for (const [role, account] of Object.entries(ACCOUNT)) {
      const context = await browser.newContext({ baseURL });
      const diagnostics = {
        role,
        completed: false,
        consoleErrors: [],
        explainedStartupWarnings: [],
        explainedLifecycleTransportCancellations: [],
        unhandledErrors: [],
        failedRequests: [],
        cleanupErrors: [],
      };
      accountDiagnostics.push(diagnostics);
      let page;
      let operationError = null;
      let recording = true;
      let lifecyclePhase = null;
      const pageAssets = createPageAssetTracker();
      try {
        page = await context.newPage();
        page.on('request', (request) => {
          pageAssets.begin(request);
        });
        page.on('requestfinished', (request) => pageAssets.complete(request));
        page.on('console', (message) => {
          if (!recording || message.type() !== 'error') return;
          const text = message.text();
          if (isKnownDemoFirestoreStartupWarning(text, {
            baseURL,
            beforeReadiness: !diagnostics.completed,
          })) {
            diagnostics.explainedStartupWarnings.push({
              kind: 'firestore-emulator-online-state-startup-timeout',
              phase: 'auth-setup',
              text: text.slice(0, 500),
            });
            return;
          }
          diagnostics.consoleErrors.push(text.slice(0, 300));
        });
        page.on('pageerror', (error) => {
          if (recording) diagnostics.unhandledErrors.push(error.message.slice(0, 300));
        });
        page.on('requestfailed', (request) => {
          pageAssets.complete(request);
          if (!recording) return;
          let requestPath;
          try {
            requestPath = new URL(request.url()).pathname;
          } catch (_error) {
            requestPath = String(request.url()).slice(0, 200);
          }
          const failure = {
            resourceType: request.resourceType(),
            failure: request.failure()?.errorText || 'unknown',
            path: requestPath,
          };
          if (isExpectedFirestoreLifecycleCancellation({
            ...failure,
            lifecyclePhase,
            url: request.url(),
          })) {
            diagnostics.explainedLifecycleTransportCancellations.push({
              ...failure,
              phase: lifecyclePhase,
            });
            return;
          }
          diagnostics.failedRequests.push(failure);
        });
        await page.goto('/');
        await page.locator('input[type="email"]').fill(`${account.uid}@example.test`);
        await page.locator('input[type="password"]').fill('PerfTest!123');
        lifecyclePhase = 'auth-transition';
        await page.locator('form button[type="submit"]').click();
        await expect(page).not.toHaveURL(/\/$/, { timeout: 30_000 });
        const destinationPathname = new URL(page.url()).pathname;
        await waitForReadiness(page, { expectedPathname: destinationPathname });
        await context.storageState({ path: path.join(authDirectory, account.state), indexedDB: true });
        await expect.poll(
          () => pageAssets.isQuiet(),
          {
            timeout: 10_000,
            message: `Page assets did not settle before authentication-state cleanup for ${role}.`,
          }
        ).toBe(true);
        diagnostics.completed = true;
      } catch (error) {
        operationError = error;
      }

      lifecyclePhase = 'connection-drain';
      try {
        await drainPageConnections(page);
      } catch (error) {
        diagnostics.cleanupErrors.push(error.message);
      }
      try {
        await context.close();
      } catch (error) {
        diagnostics.cleanupErrors.push(error.message);
      }
      lifecyclePhase = null;
      recording = false;

      const diagnosticFailures = [
        ...diagnostics.consoleErrors.map((message) => `console: ${message}`),
        ...diagnostics.explainedStartupWarnings.map((entry) => `firestore startup: ${entry.text}`),
        ...diagnostics.unhandledErrors.map((message) => `pageerror: ${message}`),
        ...diagnostics.failedRequests.map((entry) => `requestfailed: ${JSON.stringify(entry)}`),
        ...(diagnostics.explainedLifecycleTransportCancellations.length > 2
          ? [`excess Firestore lifecycle cancellations: ${JSON.stringify(diagnostics.explainedLifecycleTransportCancellations)}`]
          : []),
        ...diagnostics.cleanupErrors.map((message) => `cleanup: ${message}`),
      ];
      const errors = [
        ...(operationError ? [operationError] : []),
        ...(diagnosticFailures.length
          ? [new Error(`Authentication setup diagnostics failed for ${role}: ${diagnosticFailures.join('\n')}`)]
          : []),
      ];
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new global.AggregateError(errors, `Authentication setup and cleanup failed for ${role}.`);
      }
    }
  } catch (error) {
    setupError = error;
    throw error;
  } finally {
    writeJson(diagnosticsPath, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectId: 'demo-fnd-perf',
      status: setupError ? 'failed' : 'passed',
      expectedAccountCount: Object.keys(ACCOUNT).length,
      completedAccountCount: accountDiagnostics.filter(({ completed }) => completed).length,
      metrics: summarizeDiagnostics(accountDiagnostics),
      accounts: accountDiagnostics,
      failure: setupError ? setupError.message : null,
    });
  }
});
