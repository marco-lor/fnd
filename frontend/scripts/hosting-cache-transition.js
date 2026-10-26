#!/usr/bin/env node
'use strict';
// Read-only browser acceptance. Separate prepare/verify phases preserve ordinary disk
// caches across the publish. Never install an App Check debug token or export auth state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {createHttpsReader} = require('./retain-hosting-assets');
const ENGINES = new Set(['chromium', 'firefox', 'webkit']);
const SITES = new Set(['fatin-test', 'fatins']);
const ECHI = '/echi-di-viaggio';

function cacheFreshness({cacheControl, date, age = '0', observedAt, requestStartedAt = observedAt, now = Date.now()}) {
  const maxAge = /(?:^|,)\s*max-age=(\d+)(?:\s*,|\s*$)/i.exec(cacheControl || '');
  const serverTime = Date.parse(date);
  const ageSeconds = Number(age || '0');
  if (!maxAge || /(?:^|,)\s*(?:no-cache|no-store)(?:\s*,|\s*$)/i.test(cacheControl)
    || !Number.isFinite(serverTime) || !Number.isFinite(observedAt) || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    throw new Error('Positive old-HTML HTTP freshness requires valid Date / Age / max-age metadata.');
  }
  const receivedAge = Math.max(0, observedAt-serverTime, ageSeconds*1000 + Math.max(0, observedAt-requestStartedAt));
  const freshUntilMs = observedAt + Number(maxAge[1])*1000 - receivedAge;
  const remainingMs = freshUntilMs - now;
  if (remainingMs <= 0) throw new Error('Prepared old HTML is no longer fresh; prepare another profile before publishing.');
  return {remainingMs, freshUntil: new Date(freshUntilMs).toISOString()};
}
function assertReadyForTransition({prepared, projectId, engine, newMainPath, now = Date.now()}) {
  if (prepared.projectId !== projectId) throw new Error('Prepared browser target / site mismatch.');
  if (prepared.engine !== engine) throw new Error('Prepared browser engine mismatch.');
  if (!/^\/static\/js\/main\.[a-f0-9]{8,64}\.js$/.test(newMainPath) || newMainPath === prepared.mainPath) {
    throw new Error('Changed-release proof requires distinct old/new main bundle hashes.');
  }
  return cacheFreshness({...prepared.html, now});
}
function assertOldNavigation({engine, oldMainPath, observedMainPath, documentCache}) {
  if (observedMainPath !== oldMainPath) throw new Error('Ordinary navigation did not exercise the old HTML / old main bundle.');
  if (engine === 'chromium' && !documentCache.some(entry => entry.path === ECHI && entry.fromDiskCache && !entry.fromServiceWorker)) {
    throw new Error('Chromium old-HTML proof requires an ordinary disk-cache document response.');
  }
}
function validateQaIdentity({credentials, projectId}) {
  if (credentials.projectId !== projectId) throw new Error('Owned QA project target mismatch.');
  if (!/^codex-echi-qa-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credentials.uid)
    || !credentials.email || !credentials.password) throw new Error('A high-entropy owned Task15A QA identity is required.');
  return credentials;
}
function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (!['phase', 'site', 'engine', 'profile', 'state', 'credentials', 'output'].includes(key) || !args[i+1] || args[i+1].startsWith('--')) {
      throw new Error('Use --phase prepare|verify --site fatin-test|fatins --engine chromium|firefox|webkit --profile PATH --state FILE --credentials FILE --output FILE.');
    }
    if (options[key]) throw new Error(`Duplicate option --${key}.`);
    options[key] = args[i+1];
  }
  if (!['prepare', 'verify'].includes(options.phase) || !SITES.has(options.site) || !ENGINES.has(options.engine)) throw new Error('Explicit supported phase, site and engine are required.');
  for (const key of ['profile', 'state', 'credentials', 'output']) if (!options[key] || !path.isAbsolute(options[key])) throw new Error(`Explicit absolute --${key} path is required.`);
  return options;
}
const selectedCacheMetadata = response => {
  const headers = response.headers();
  const timing = response.request().timing();
  return {status: response.status(), cacheControl: headers['cache-control'] || null, date: headers.date || null, age: headers.age || null, observedAt: Date.now(), requestStartedAt: timing.startTime};
};
const mainPathFromHtml = html => {
  const match = /["'](\/static\/js\/main\.[a-f0-9]{8,64}\.js)["']/.exec(html);
  if (!match) throw new Error('HTML has no recognizable hashed main bundle path.');
  return match[1];
};
async function pageMainPath(page) {
  const paths = await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => new URL(script.src).pathname));
  const main = paths.find(candidate => /^\/static\/js\/main\.[a-f0-9]{8,64}\.js$/.test(candidate));
  if (!main) throw new Error('Browser document has no recognizable hashed main bundle path.');
  return main;
}
async function waitForEchi(page) {
  await page.getByRole('heading', {name: 'Mappa Artistica', exact: true}).waitFor({timeout: 45000});
}
async function signInIfNeeded(page, qa) {
  await Promise.race([
    page.getByRole('heading', {name: 'Mappa Artistica', exact: true}).waitFor({timeout: 45000}),
    page.locator('input[type="email"]').waitFor({state: 'visible', timeout: 45000}),
  ]);
  const email = page.locator('input[type="email"]');
  if (await email.isVisible()) {
    await email.fill(qa.email);
    await page.locator('input[type="password"]').fill(qa.password);
    await page.getByRole('button', {name: 'Enter', exact: true}).click();
    await page.waitForURL(url => !['/', '/login'].includes(url.pathname), {timeout: 45000});
  }
}
async function roundTrip(page) {
  await page.locator('a[href="/home"]:visible').first().click();
  await page.waitForURL(url => url.pathname === '/home');
  await page.locator('main').last().waitFor({state: 'visible', timeout: 45000});
  await page.locator(`a[href="${ECHI}"]:visible`).first().click();
  await page.waitForURL(url => url.pathname === ECHI);
  await waitForEchi(page);
  return {home: true, echi: true, completedAt: new Date().toISOString()};
}
const staticFailureKind = errorText => /ERR_ABORTED|NS_BINDING_ABORTED|cancelled|canceled/i.test(errorText || '') ? 'aborted' : 'failed';
function observePage(page, origin, engine) {
  const observations = {staticResponses: [], staticFailures: [], staticAborts: [], documentCache: [], pageErrors: [], appCheck: []};
  page.on('pageerror', error => observations.pageErrors.push({name: error.name}));
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/static/')) {
      const kind = staticFailureKind(request.failure()?.errorText);
      observations[kind === 'aborted' ? 'staticAborts' : 'staticFailures'].push({path: url.pathname, kind});
    }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/static/')) {
      const entry = {path: url.pathname, status: response.status()};
      observations.staticResponses.push(entry);
      if (entry.status >= 400) observations.staticFailures.push(entry);
    }
    if (url.hostname.endsWith('firebaseappcheck.googleapis.com') && url.pathname.includes(':exchange')) {
      observations.appCheck.push({operation: url.pathname.split(':').at(-1), status: response.status()});
    }
  });
  return {observations, async attach() {
    if (engine !== 'chromium') return;
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable'); // Keep normal cache; never setCacheDisabled.
    session.on('Network.responseReceived', event => {
      const url = new URL(event.response.url);
      if (event.type === 'Document' && url.origin === origin) observations.documentCache.push({path: url.pathname, fromDiskCache: Boolean(event.response.fromDiskCache), fromServiceWorker: Boolean(event.response.fromServiceWorker)});
    });
  }};
}
async function launch(engine, profile) {
  const playwright = require('playwright');
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  const context = await playwright[engine].launchPersistentContext(profile, {
    ...(engine === 'chromium' ? {channel: 'chromium'} : {}), headless: true,
    ...(proxyUrl ? {proxy: {server: proxyUrl}} : {}),
    viewport: {width: 1440, height: 1000}, locale: 'it-IT',
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(45000);
  return context;
}
async function run(options = parseArguments(process.argv.slice(2))) {
  const qa = validateQaIdentity({credentials: JSON.parse(fs.readFileSync(options.credentials, 'utf8')), projectId: options.site});
  const origin = `https://${options.site}.web.app`;
  const result = {phase: options.phase, projectId: options.site, engine: options.engine,
    surface: `automated Linux ${options.engine}; ordinary persistent HTTP cache; real App Check provider; no debug token`,
    startedAt: new Date().toISOString(), completed: false};
  let context;
  let coldContext;
  let coldProfile;
  try {
    if (options.phase === 'prepare') {
      if (fs.existsSync(options.state) || (fs.existsSync(options.profile) && fs.readdirSync(options.profile).length)) throw new Error('Prepare needs a new empty profile and new state file.');
      context = await launch(options.engine, options.profile);
      const page = context.pages()[0] || await context.newPage();
      const observer = observePage(page, origin, options.engine); await observer.attach();
      result.observations = observer.observations;
      await page.goto(origin+ECHI, {waitUntil: 'domcontentloaded'});
      await signInIfNeeded(page, qa);
      // A normal document navigation caches the requested Echi route before release.
      const response = await page.goto(origin+ECHI, {waitUntil: 'domcontentloaded'});
      if (!response || response.status() !== 200) throw new Error('Old route HTML is unavailable.');
      await waitForEchi(page);
      result.html = selectedCacheMetadata(response);
      result.mainPath = await pageMainPath(page);
      result.roundTrip = await roundTrip(page);
      result.freshness = cacheFreshness({...result.html});
      if (observer.observations.staticFailures.length) throw new Error('Old release has failed static assets.');
      result.browser = context.browser().version();
      result.observations = observer.observations;
      result.profile = options.profile;
      result.completed = true;
      fs.writeFileSync(options.state, `${JSON.stringify(result, null, 2)}\n`, {flag: 'wx', mode: 0o600});
    } else {
      const prepared = JSON.parse(fs.readFileSync(options.state, 'utf8'));
      if (!prepared.completed || prepared.profile !== options.profile) throw new Error('Prepared profile/state mismatch or incomplete preparation.');
      // Inspect the new release outside the ordinary-cache browser profile.
      const response = await createHttpsReader()(origin+'/index.html', {headers: {'Accept-Encoding': 'gzip'}, maxBytes: 1024*1024, timeoutMs: 45000});
      if (response.statusCode !== 200) throw new Error('New release index HTML is unavailable.');
      const html = response.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(response.body, {maxOutputLength: 1024*1024}) : response.body;
      const newMainPath = mainPathFromHtml(html.toString('utf8'));
      result.freshnessAtNavigation = assertReadyForTransition({prepared, projectId: options.site, engine: options.engine, newMainPath});
      result.oldMainPath = prepared.mainPath; result.newMainPath = newMainPath;
      context = await launch(options.engine, options.profile);
      const page = context.pages()[0] || await context.newPage();
      const observer = observePage(page, origin, options.engine); await observer.attach();
      result.observations = observer.observations;
      const beforeReload = await page.goto(origin+ECHI, {waitUntil: 'domcontentloaded'});
      await waitForEchi(page);
      result.beforeAnyReload = {html: selectedCacheMetadata(beforeReload), mainPath: await pageMainPath(page), roundTrip: await roundTrip(page)};
      cacheFreshness({...prepared.html});
      assertOldNavigation({engine: options.engine, oldMainPath: prepared.mainPath, observedMainPath: result.beforeAnyReload.mainPath, documentCache: observer.observations.documentCache});
      if (observer.observations.staticFailures.length || observer.observations.pageErrors.length) throw new Error('Old document failed before reload.');
      result.beforeAnyReload.observations = JSON.parse(JSON.stringify(observer.observations));
      result.beforeAnyReload.verifiedAt = new Date().toISOString();
      // Only after the old-cache navigation and Home/Echi roundtrip are proven may reload run.
      const reloaded = await page.reload({waitUntil: 'domcontentloaded'});
      await waitForEchi(page);
      result.ordinaryReload = {html: selectedCacheMetadata(reloaded), mainPath: await pageMainPath(page), roundTrip: await roundTrip(page)};
      if (result.ordinaryReload.mainPath !== newMainPath) throw new Error('Ordinary reload did not obtain the new release.');
      if (!/no-cache/.test(result.ordinaryReload.html.cacheControl || '')) throw new Error('New requested-route HTML does not revalidate.');
      result.ordinaryReload.observations = observer.observations;
      if (observer.observations.staticFailures.length || observer.observations.pageErrors.length) throw new Error('Reloaded release has failed static assets or page errors.');
      await context.close(); context = null;
      coldProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-transition-cold-'));
      coldContext = await launch(options.engine, coldProfile);
      const coldPage = coldContext.pages()[0] || await coldContext.newPage();
      const coldObserver = observePage(coldPage, origin, options.engine); await coldObserver.attach();
      const coldResponse = await coldPage.goto(origin+ECHI, {waitUntil: 'domcontentloaded'});
      await signInIfNeeded(coldPage, qa);
      await coldPage.goto(origin+ECHI, {waitUntil: 'domcontentloaded'}); await waitForEchi(coldPage);
      result.coldProfile = {html: selectedCacheMetadata(coldResponse), mainPath: await pageMainPath(coldPage), roundTrip: await roundTrip(coldPage), observations: coldObserver.observations};
      if (result.coldProfile.mainPath !== newMainPath || coldObserver.observations.staticFailures.length || coldObserver.observations.pageErrors.length) throw new Error('Separate cold-profile verification failed.');
      result.browser = coldContext.browser().version();
      result.completed = true;
    }
  } finally {
    if (context) await context.close();
    if (coldContext) await coldContext.close();
    if (coldProfile) fs.rmSync(coldProfile, {recursive: true, force: true});
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, {mode: 0o600});
  }
  console.log(JSON.stringify({phase: options.phase, projectId: options.site, engine: options.engine, completed: result.completed, output: options.output}));
  return result;
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {cacheFreshness, assertReadyForTransition, assertOldNavigation, validateQaIdentity, staticFailureKind, parseArguments, run};
