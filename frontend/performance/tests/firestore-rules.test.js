const fs = require('fs');
const path = require('path');
const { after, before, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, updateDoc } = require('firebase/firestore');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-fnd-perf',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.resolve(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
    },
  });
});

after(async () => environment?.cleanup());

test('anonymous, player, DM, and webmaster rules match their intended boundaries', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();

  await assertFails(getDoc(doc(anonymous, 'users/perf-player')));
  await assertSucceeds(getDoc(doc(anonymous, 'items/item-0000')));
  await assertSucceeds(getDoc(doc(player, 'users/perf-player')));
  await assertFails(getDoc(doc(player, 'users/perf-peer-2')));
  await assertFails(getDoc(doc(player, 'foes/foe-0000')));
  await assertSucceeds(getDoc(doc(dm, 'foes/foe-0000')));
  await assertSucceeds(getDoc(doc(webmaster, 'users/perf-player')));
});

test('roles cannot be changed through a direct privileged client update', async () => {
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();
  await assertFails(updateDoc(doc(webmaster, 'users/perf-player'), { role: 'dm' }));
});
