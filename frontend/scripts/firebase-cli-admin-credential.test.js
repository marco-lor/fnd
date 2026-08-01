const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createFirebaseCliAdcFile,
  createFirebaseCliAdminCredential,
} = require('./firebase-cli-admin-credential');

test('Firebase CLI credential requires an explicit project and signed-in account', async () => {
  await assert.rejects(
    createFirebaseCliAdminCredential(),
    /project ID is required/
  );
  await assert.rejects(createFirebaseCliAdminCredential({
    projectId: 'fatin-test',
    authModule: {
      selectAccount: () => null,
    },
    requireAuthFunction: async () => {},
  }), /No Firebase CLI account is logged in/);
});

test('Firebase CLI credential refreshes a token without persisting or logging it', async () => {
  const calls = [];
  const account = {
    user: {email: 'operator@example.test'},
    tokens: {refresh_token: 'refresh-private'},
  };
  const credential = await createFirebaseCliAdminCredential({
    projectId: 'fatin-test',
    cwd: 'isolated-test-root',
    authModule: {
      selectAccount: (_email, cwd) => {
        calls.push(['select', cwd]);
        return account;
      },
      setActiveAccount: (options, selected) => {
        calls.push(['active', options.project, selected.user.email]);
        options.tokens = selected.tokens;
        options.authScopes = ['scope'];
      },
      getAccessToken: async (refreshToken, scopes) => {
        calls.push(['token', refreshToken, scopes]);
        return {
          access_token: 'access-private',
          expires_at: Date.now() + 30 * 60 * 1000,
        };
      },
    },
    requireAuthFunction: async (options, skipAutoAuth) => {
      calls.push(['require', options.project, skipAutoAuth]);
    },
  });

  const token = await credential.getAccessToken();
  assert.equal(token.access_token, 'access-private');
  assert.ok(token.expires_in > 0);
  assert.deepEqual(calls[0], ['select', 'isolated-test-root']);
  assert.deepEqual(calls[1], ['active', 'fatin-test', 'operator@example.test']);
  assert.deepEqual(calls[2], ['require', 'fatin-test', true]);
  assert.deepEqual(calls[3], ['token', 'refresh-private', ['scope']]);
});

test('temporary ADC contains authorized-user fields and cleanup removes it', async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-cli-adc-test-'));
  t.after(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}));
  const account = {
    user: {email: 'operator@example.test'},
    tokens: {refresh_token: 'refresh-private'},
  };
  const adc = await createFirebaseCliAdcFile({
    projectId: 'fatin-test',
    cwd: 'isolated-test-root',
    tempDirectory: temporaryRoot,
    authModule: {
      selectAccount: () => account,
      setActiveAccount: (options, selected) => {
        options.tokens = selected.tokens;
      },
    },
    apiModule: {
      clientId: () => 'public-client-id',
      clientSecret: () => 'public-client-secret',
    },
    requireAuthFunction: async () => {},
  });

  assert.deepEqual(JSON.parse(fs.readFileSync(adc.filePath, 'utf8')), {
    type: 'authorized_user',
    client_id: 'public-client-id',
    client_secret: 'public-client-secret',
    refresh_token: 'refresh-private',
  });
  assert.equal(fs.existsSync(adc.filePath), true);
  adc.cleanup();
  assert.equal(fs.existsSync(adc.filePath), false);
  assert.doesNotThrow(() => adc.cleanup());
});
