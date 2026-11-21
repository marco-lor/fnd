// The browser and both Firebase clients use the local performance emulator project.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createRequire} = require('node:module');
const path = require('node:path');
const {test} = require('node:test');
const {chromium, expect} = require('@playwright/test');
const functionsRequire = createRequire(path.join(__dirname, '../../functions/package.json'));
const {initializeApp, deleteApp} = functionsRequire('firebase-admin/app');
const {getFirestore} = functionsRequire('firebase-admin/firestore');
const {getAuth} = functionsRequire('firebase-admin/auth');
const catalog = require('./fixtures/grigliata-combat-catalog.json');

const origin = 'http://127.0.0.1:' + Number(process.env.GRIGLIATA_TEST_APP_PORT || 5000);
const mapVideo = path.join(__dirname, '../../map_test/map_test_dynamic_lighting.mp4');
const mapUrl = origin + '/qa-map-test-dynamic-lighting.mp4';
const loadout = name => catalog.items.find(({item}) => item.General.Nome === name).item;
const bomb = catalog.cards.find(({entry}) => entry.Nome === 'Bomba Scasso').entry;
const board = 'guided-browser-' + randomUUID();
const attacker = {uid: board + '-a', name: 'QA Combat Attacker', col: 22, defense: 13, attack: 8};
const defender = {uid: board + '-d', name: 'QA Combat Receiver', col: 21, defense: 16, attack: 17};
const placement = player => board + '__' + player.uid;
const email = player => player.uid + '@example.test';
const password = randomUUID();

async function login(browser, player, mobile = false) {
  const context = await browser.newContext({
    viewport: mobile ? {width: 390, height: 844} : {width: 1500, height: 940},
    reducedMotion: mobile ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(() => { window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__ = true; });
  await context.route(mapUrl, route => route.fulfill({path: mapVideo, contentType: 'video/mp4'}));
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  await page.goto(origin);
  await page.locator('input[type="email"]').fill(email(player));
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(url => url.pathname !== '/' && url.pathname !== '/login');
  return page;
}

test('two players throw on the fatin-test map, resume damage, and use weapon and ground spells', {timeout: 150_000}, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  const app = initializeApp({projectId: 'demo-fnd-perf'});
  const db = getFirestore(app);
  const auth = getAuth(app);
  const owned = new Set();
  const shared = await db.getAll(db.doc('grigliata_state/current'), db.doc('utils/varie'));
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
      const cleanup = db.batch();
      for (const name of ['grigliata_combat_actions', 'grigliata_combat_requests']) {
        const docs = await db.collection(name).where('backgroundId', '==', board).select().get();
        docs.forEach(doc => cleanup.delete(doc.ref));
      }
      for (const p of owned) cleanup.delete(db.doc(p));
      for (const doc of shared) {
        if (doc.exists) cleanup.set(doc.ref, doc.data());
        else cleanup.delete(doc.ref);
      }
      await cleanup.commit();
      await auth.deleteUsers([attacker.uid, defender.uid]);
    } finally {
      await deleteApp(app);
    }
  });

  const batch = db.batch();
  const seed = (p, value) => { owned.add(p); batch.set(db.doc(p), value); };
  for (const player of [attacker, defender]) {
    await auth.createUser({uid: player.uid, email: email(player), password});
    const p = 'users/' + player.uid;
    const stats = {level: 8, hpCurrent: 9999, hpTotal: 9999, barrieraCurrent: 10, manaCurrent: 100, manaTotal: 100};
    const soul = {Anima_4: 'Astuzia', Anima_7: 'Potenza'};
    const token = {tokenType: 'character', ownerUid: player.uid, characterId: player.name, label: player.name, isVisibleToPlayers: true};
    seed(p, {uid: player.uid, role: 'player', schemaVersion: 2, characterId: player.name, email: email(player),
      flags: {characterCreationDone: true}, summary: {level: 8}, stats, AltriParametri: soul});
    seed(p + '/state/progression', {stats: {level: 8}, AltriParametri: soul,
      Parametri: {Base: {Forza: {Tot: 5}, Intelligenza: {Tot: 6}, Saggezza: {Tot: 3}},
      Combattimento: {Attacco: {Tot: player.attack}, Mira: {Tot: 9}, Difesa: {Tot: player.defense}, RiduzioneDanni: {Tot: 4}}}});
    seed(p + '/state/resources', {stats});
    seed(p + '/inventory/sword', {currentSnapshot: loadout('Spada')});
    const slots = {weaponMain: 'sword'};
    if (player === attacker) {
      slots.weaponOff = 'chain';
      seed(p + '/inventory/chain', {currentSnapshot: loadout('Catena del Predatore')});
      seed(p + '/spells/bomb', bomb);
    }
    seed(p + '/state/equipment', {slots});
    seed('grigliata_tokens/' + player.uid, token);
    seed('grigliata_token_placements/' + placement(player), {...token, tokenId: player.uid, backgroundId: board, col: player.col, row: 13});
  }
  seed('grigliata_backgrounds/' + board, {name: 'map test dynamic lighting', assetType: 'video', imageUrl: mapUrl,
    imageWidth: 2040, imageHeight: 1620, grid: {cellSizePx: 60, offsetXPx: 0, offsetYPx: 0}});
  batch.set(shared[0].ref, {activeBackgroundId: board, gridVisible: true});
  batch.set(shared[1].ref, {dadiAnimaByLevel: {8: 20}});
  await batch.commit();

  browser = await chromium.launch();
  const [map, home] = await Promise.all([login(browser, attacker), login(browser, defender, true)]);
  await map.goto(origin + '/grigliata');
  const tab = map.getByRole('tab', {name: 'Combattimento'});
  const tray = map.locator('section.gc-dice-tray');
  const projection = map.getByTestId('grigliata-board-dice-projection').locator('canvas');
  const aimAtReceiver = async () => {
    await map.getByRole('button', {name: /Scegli bersaglio sulla mappa/}).click();
    await map.getByRole('button', {name: 'Bersaglio QA Combat Receiver', exact: true}).click();
  };
  const journal = db.collection('grigliata_combat_actions').where('backgroundId', '==', board);
  await tab.click();
  await map.getByRole('button', {name: /Mano principale.*Spada/}).click();
  await aimAtReceiver();
  const drag = tray.locator('.gc-dice-drag');
  await expect(drag.locator('canvas')).toBeVisible();
  assert.equal((await journal.get()).size, 0);
  const handle = await drag.boundingBox();
  await map.mouse.move(handle.x + 8, handle.y + handle.height / 2);
  await map.mouse.down();
  await map.mouse.move(handle.x + handle.width - 8, handle.y + handle.height / 2, {steps: 6});
  await map.mouse.up();
  await expect(projection).toBeVisible({timeout: 25_000});
  await expect(tray.locator('.gc-dice-faces li')).toHaveCount(1, {timeout: 25_000});
  const launched = await journal.get();
  assert.equal(launched.size, 1);
  const hit = launched.docs[0].ref;
  await expect(tray.locator('.gc-dice-faces strong')).toHaveText(String(launched.docs[0].data().targets[0].attack.rolls[0]));

  const dialog = home.getByRole('dialog');
  // Use the defender's editable modifier to guarantee a hit with any server RNG.
  await dialog.getByLabel('Difesa', {exact: true}).fill('-99');
  await dialog.getByRole('button', {name: 'Tira Difesa'}).click();
  await expect(home.getByText(/In attesa che l.attaccante tiri il danno/)).toBeVisible();
  assert.equal((await hit.get()).data().targets[0].pendingDamage.expr, '3d8');
  const resources = db.doc('users/' + defender.uid + '/state/resources');
  assert.equal((await resources.get()).data().stats.barrieraCurrent, 10);
  await Promise.all([map.reload(), home.reload()]);
  await tab.click();
  await map.getByRole('button', {name: /Tiro di danno · QA Combat Receiver/}).click();
  await tray.getByRole('button', {name: 'Tira i dadi'}).press('Enter');
  await expect(tray.locator('.gc-dice-faces li')).toHaveCount(3);
  await expect(projection).toBeVisible();
  const target = (await hit.get()).data().targets[0];
  const faces = target.damageRoll.rolls.map(die => die.value);
  assert.deepEqual(await tray.locator('.gc-dice-faces strong').allTextContents(), faces.map(String));
  const amount = 8 + faces.reduce((a, b) => a + b) - 4;
  assert.equal(target.damage, amount);
  const apply = home.getByRole('button', {name: 'Applica danno'});
  await expect(apply).toHaveCount(1);
  await apply.click();
  await expect.poll(async () => (await hit.get()).data().targets[0].damageApplied?.amount).toBe(amount);
  const remaining = (await resources.get()).data().stats;
  assert.equal(remaining.barrieraCurrent, Math.max(0, 10 - amount));
  assert.equal(remaining.hpCurrent, 9999 - Math.max(0, amount - 10));

  await map.getByRole('button', {name: 'Spell', exact: true}).click();
  await map.getByRole('button', {name: /Afferra.*Catena del Predatore/}).click();
  await aimAtReceiver();
  await tray.getByRole('button', {name: 'Tira i dadi'}).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('spinbutton').first().fill('999');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toHaveCount(0);
  await map.getByRole('button', {name: /Bomba Scasso/}).click();
  await map.getByRole('button', {name: /Scegli casella sulla mappa/}).press('Enter');
  const cursor = map.getByRole('button', {name: /^Scegli casella \(/});
  await expect(cursor).toBeFocused();
  for (let i = 0; i < 6; i++) await cursor.press('ArrowUp');
  await cursor.press('Enter');
  await expect(tray.getByRole('heading')).toHaveText('Bomba Scasso');
  await tray.getByRole('button', {name: 'Tira i dadi'}).press('Enter');
  await map.getByRole('button', {name: /Tiro di danno · Bomba Scasso/}).click();
  await tray.getByRole('button', {name: 'Tira i dadi'}).click();
  await expect(tray.locator('.gc-dice-faces li')).toHaveCount(3);
  const events = (await journal.get()).docs.map(doc => doc.data());
  const spell = events.find(event => event.action.name === 'Bomba Scasso');
  assert.deepEqual(spell.point, {col: 22, row: 7});
  assert.deepEqual(spell.damageRoll.rolls.map(die => die.sides), [10, 10, 10]);
  const granted = events.find(event => event.action.name === 'Afferra');
  assert.equal(granted.action.id, 'item:weaponOff:Afferra');
  assert.equal(granted.targets[0].outcome, 'resisted');
  assert.ok(!granted.targets[0].pendingDamage);
});
