import { getCodexCategories, getCodexControl, invalidateCodex } from './codexRepository';
import { __resetRepositoryRuntimeForTests, setRepositoryActor } from './repositoryRuntime';
import { getDoc } from '../performance/firestore';

jest.mock('../components/firebaseConfig', () => ({ db: {} }));
jest.mock('./functions/callableRegistry', () => ({ getCallable: jest.fn() }));
jest.mock('../performance/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  getDoc: jest.fn(),
  labelFirestoreTarget: target => target,
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const snapshot = data => ({ exists: () => data !== null, data: () => data });
const controlledRead = () => ({ started: deferred(), result: deferred() });

beforeEach(() => {
  __resetRepositoryRuntimeForTests();
  jest.resetAllMocks();
  setRepositoryActor('account-a');
});
afterEach(() => __resetRepositoryRuntimeForTests());

test.each([
  ['account change', 'success', 'repository-session-changed'],
  ['account change', 'failure', 'repository-session-changed'],
  ['explicit invalidation', 'success', 'repository-invalidated'],
  ['explicit invalidation', 'failure', 'unavailable'],
])('late %s %s cleanup preserves the replacement category acquisition', async (transition, settlement, code) => {
  const oldRead = controlledRead();
  const newRead = controlledRead();
  const reads = [oldRead, newRead];
  getDoc.mockImplementation(({ path }) => {
    if (path === 'utils/codex_control') {
      const pending = reads.shift();
      if (!pending) return Promise.resolve(snapshot(null));
      pending.started.resolve();
      return pending.result.promise;
    }
    if (path === 'utils/codex') return Promise.resolve(snapshot({ Razze: { Human: 'current option' } }));
    throw new Error(`Unexpected document: ${path}`);
  });

  const oldAcquisition = getCodexCategories(['Razze']);
  const oldResult = oldAcquisition.catch(error => error);
  await oldRead.started.promise;
  if (transition === 'account change') setRepositoryActor('account-b');
  else invalidateCodex();
  const replacement = getCodexCategories(['Razze']);
  const replacementResult = replacement.catch(error => error);
  await newRead.started.promise;

  if (settlement === 'success') oldRead.result.resolve(snapshot(null));
  else oldRead.result.reject(Object.assign(new Error('old read failed'), { code: 'unavailable' }));
  const oldError = await oldResult;
  expect(oldError).toMatchObject({ code });
  expect(oldError.retryableTransition).toBe(transition === 'account change' ? false : undefined);
  newRead.result.resolve(snapshot(null));
  expect(await replacementResult).toEqual({ Razze: { Human: 'current option' } });
});

test('concurrent control reads deduplicate and the next acquisition reads fresh control', async () => {
  const pending = controlledRead();
  getDoc.mockImplementationOnce(() => {
    pending.started.resolve();
    return pending.result.promise;
  }).mockResolvedValue(snapshot({ schemaVersion: 2, mode: 'v2', epoch: 2,
    generation: 'new-generation', metadataRevision: 1, collationLocale: 'en-US' }));

  const first = getCodexControl();
  const concurrent = getCodexControl();
  await pending.started.promise;
  expect(getDoc).toHaveBeenCalledTimes(1);
  pending.result.resolve(snapshot(null));
  await expect(first).resolves.toMatchObject({ source: 'legacy' });
  await expect(concurrent).resolves.toMatchObject({ source: 'legacy' });
  await expect(getCodexControl()).resolves.toMatchObject({ source: 'v2', epoch: 2, generation: 'new-generation' });
  expect(getDoc).toHaveBeenCalledTimes(2);
});
