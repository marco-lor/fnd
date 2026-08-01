const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const createFirebaseCliAdminCredential = async ({
  projectId,
  cwd = process.cwd(),
  authModule = null,
  requireAuthFunction = null,
} = {}) => {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('A Firebase project ID is required for Firebase CLI authentication.');
  }

  const auth = authModule || require('firebase-tools/lib/auth');
  const requireAuth = requireAuthFunction || require('firebase-tools/lib/requireAuth').requireAuth;
  const options = {
    cwd,
    project: projectId.trim(),
  };
  const account = auth.selectAccount(undefined, cwd);
  if (!account) {
    throw new Error('No Firebase CLI account is logged in. Run firebase login first.');
  }

  auth.setActiveAccount(options, account);
  await requireAuth(options, true);

  return {
    getAccessToken: async () => {
      const tokens = await auth.getAccessToken(
        options.tokens?.refresh_token || account.tokens?.refresh_token,
        options.authScopes
      );
      if (!tokens?.access_token) {
        throw new Error('Firebase CLI did not return an access token.');
      }
      const expiresAt = Number(tokens.expires_at) || (Date.now() + 60 * 60 * 1000);
      return {
        access_token: tokens.access_token,
        expires_in: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
      };
    },
  };
};

const createFirebaseCliAdcFile = async ({
  projectId,
  cwd = process.cwd(),
  tempDirectory = os.tmpdir(),
  authModule = null,
  apiModule = null,
  requireAuthFunction = null,
} = {}) => {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('A Firebase project ID is required for Firebase CLI authentication.');
  }
  const auth = authModule || require('firebase-tools/lib/auth');
  const api = apiModule || require('firebase-tools/lib/api');
  const requireAuth = requireAuthFunction || require('firebase-tools/lib/requireAuth').requireAuth;
  const options = {cwd, project: projectId.trim()};
  const account = auth.selectAccount(undefined, cwd);
  if (!account) {
    throw new Error('No Firebase CLI account is logged in. Run firebase login first.');
  }
  auth.setActiveAccount(options, account);
  await requireAuth(options, true);
  const refreshToken = options.tokens?.refresh_token || account.tokens?.refresh_token;
  if (!refreshToken) throw new Error('Firebase CLI account has no refresh token.');

  const directory = fs.mkdtempSync(path.join(tempDirectory, 'fatin-test-firebase-cli-adc-'));
  const filePath = path.join(directory, 'application-default-credentials.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    type: 'authorized_user',
    client_id: api.clientId(),
    client_secret: api.clientSecret(),
    refresh_token: refreshToken,
  })}\n`, {encoding: 'utf8', mode: 0o600});
  let cleaned = false;
  return {
    filePath,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      fs.rmSync(directory, {recursive: true, force: true});
    },
  };
};

module.exports = {
  createFirebaseCliAdcFile,
  createFirebaseCliAdminCredential,
};
