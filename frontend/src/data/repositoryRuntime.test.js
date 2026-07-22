import {
  RepositorySessionChangedError,
  __getRepositoryRuntimeStateForTests,
  __resetRepositoryRuntimeForTests,
  applyDocChanges,
  getCached,
  invalidate,
  invalidatePrefix,
  setRepositoryActor,
  subscribeShared,
} from './repositoryRuntime';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.useRealTimers();
  __resetRepositoryRuntimeForTests();
});

afterEach(() => {
  __resetRepositoryRuntimeForTests();
});

test('identical reads share in-flight work and successful values until invalidation', async () => {
  const load = jest.fn(async () => ({ value: 1 }));
  const request = () => getCached({
    metricKey: 'config.varie.get.v1',
    instanceKey: 'config:varie',
    load,
  });

  const first = request();
  const second = request();
  expect(first).toBe(second);
  await expect(first).resolves.toEqual({ value: 1 });
  await expect(request()).resolves.toEqual({ value: 1 });
  expect(load).toHaveBeenCalledTimes(1);

  expect(invalidate('config:varie')).toBe(true);
  await expect(request()).resolves.toEqual({ value: 1 });
  expect(load).toHaveBeenCalledTimes(2);
  expect(invalidatePrefix('config:')).toBe(1);
});

test('failed reads share bounded retry windows and success resets retry state', async () => {
  jest.useFakeTimers();
  const failure = new Error('offline');
  const load = jest.fn()
    .mockRejectedValueOnce(failure)
    .mockRejectedValueOnce(failure)
    .mockResolvedValue({ recovered: true });
  const request = () => getCached({
    metricKey: 'config.schema.get.v1',
    instanceKey: 'config:schema_pg',
    load,
  });

  const first = request();
  await expect(first).rejects.toBe(failure);
  expect(request()).toBe(first);
  await expect(request()).rejects.toBe(failure);
  expect(load).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(250);
  const second = request();
  await expect(second).rejects.toBe(failure);
  expect(load).toHaveBeenCalledTimes(2);

  jest.advanceTimersByTime(999);
  expect(request()).toBe(second);
  jest.advanceTimersByTime(1);
  await expect(request()).resolves.toEqual({ recovered: true });
  expect(load).toHaveBeenCalledTimes(3);
});

test('actor changes clear resources and reject late results from the previous account', async () => {
  let resolveLoad;
  const pending = getCached({
    metricKey: 'config.varie.get.v1',
    instanceKey: 'config:varie',
    load: () => new Promise((resolve) => { resolveLoad = resolve; }),
  });
  await flushMicrotasks();
  setRepositoryActor('next-user');
  resolveLoad({ private: 'old-user' });
  await expect(pending).rejects.toMatchObject({
    code: 'repository-session-changed',
    retryableTransition: true,
  });
  expect(__getRepositoryRuntimeStateForTests()).toEqual(expect.objectContaining({
    actorUid: 'next-user',
    cacheCount: 0,
    sessionGeneration: 1,
  }));
});

test('real account changes reject stale reads as non-retryable without exposing either UID', async () => {
  setRepositoryActor('first-user');
  let resolveLoad;
  const pending = getCached({
    metricKey: 'config.varie.get.v1',
    instanceKey: 'config:varie',
    load: () => new Promise((resolve) => { resolveLoad = resolve; }),
  });
  await flushMicrotasks();
  setRepositoryActor('second-user');
  resolveLoad({ private: 'first-user-data' });

  const error = await pending.catch((caught) => caught);
  expect(error).toBeInstanceOf(RepositorySessionChangedError);
  expect(error.retryableTransition).toBe(false);
  expect(String(error)).not.toContain('first-user');
  expect(String(error)).not.toContain('second-user');
});

test('actor changes replace late failures from the previous account', async () => {
  let rejectLoad;
  const pending = getCached({
    metricKey: 'directory.users.list.v1',
    instanceKey: 'directory:users:page:first',
    load: () => new Promise((_resolve, reject) => { rejectLoad = reject; }),
  });
  await flushMicrotasks();
  setRepositoryActor('next-user');
  rejectLoad(new Error('old account permission failure'));

  await expect(pending).rejects.toBeInstanceOf(RepositorySessionChangedError);
  expect(__getRepositoryRuntimeStateForTests().cacheCount).toBe(0);
});

test('actor changes close shared listeners and suppress their late callbacks', () => {
  let physicalObserver;
  const physicalUnsubscribe = jest.fn();
  const next = jest.fn();
  subscribeShared({
    metricKey: 'directory.users.subscribe.v1',
    instanceKey: 'directory:users:role=player',
    listen: (observer) => {
      physicalObserver = observer;
      return physicalUnsubscribe;
    },
  }, next);

  setRepositoryActor('different-user');
  physicalObserver.next({ items: [{ id: 'old-account' }] });
  expect(next).not.toHaveBeenCalled();
  expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
  expect(__getRepositoryRuntimeStateForTests().subscriptionCount).toBe(0);
});

test('shared subscriptions replay, survive Strict Mode churn, and close once', async () => {
  let physicalObserver;
  const physicalUnsubscribe = jest.fn();
  const listen = jest.fn((observer) => {
    physicalObserver = observer;
    return physicalUnsubscribe;
  });
  const descriptor = {
    metricKey: 'codex.document.subscribe.v1',
    instanceKey: 'codex:document',
    listen,
  };
  const firstObserver = jest.fn();
  const cleanupFirst = subscribeShared(descriptor, firstObserver);
  physicalObserver.next({ revision: 1 });
  expect(firstObserver).toHaveBeenCalledWith({ revision: 1 });

  const lateObserver = jest.fn();
  const cleanupLate = subscribeShared(descriptor, lateObserver);
  expect(lateObserver).toHaveBeenCalledWith({ revision: 1 });
  expect(listen).toHaveBeenCalledTimes(1);

  cleanupFirst();
  cleanupLate();
  const remountedObserver = jest.fn();
  const cleanupRemounted = subscribeShared(descriptor, remountedObserver);
  await flushMicrotasks();
  expect(physicalUnsubscribe).not.toHaveBeenCalled();
  expect(listen).toHaveBeenCalledTimes(1);

  cleanupRemounted();
  cleanupRemounted();
  await flushMicrotasks();
  expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
});

test('subscription errors notify all consumers once and allow a new physical retry', () => {
  const observers = [];
  const listen = jest.fn((observer) => {
    observers.push(observer);
    return jest.fn();
  });
  const descriptor = {
    metricKey: 'codex.document.subscribe.v1',
    instanceKey: 'codex:document',
    listen,
  };
  const firstError = jest.fn();
  const secondError = jest.fn();
  subscribeShared(descriptor, { error: firstError });
  subscribeShared(descriptor, { error: secondError });
  const failure = new Error('permission denied');
  observers[0].error(failure);
  observers[0].error(failure);
  expect(firstError).toHaveBeenCalledTimes(1);
  expect(secondError).toHaveBeenCalledTimes(1);

  subscribeShared(descriptor, jest.fn());
  expect(listen).toHaveBeenCalledTimes(2);
});

test('one document change preserves every unrelated normalized identity', () => {
  const alpha = { id: 'alpha', label: 'Alpha' };
  const beta = { id: 'beta', label: 'Beta' };
  const previous = {
    byId: { alpha, beta },
    orderedIds: ['alpha', 'beta'],
    items: [alpha, beta],
    revision: 4,
  };
  const normalize = jest.fn((document) => ({ id: document.id, ...document.data() }));
  const snapshot = {
    docChanges: () => [{
      type: 'modified',
      doc: { id: 'beta', data: () => ({ label: 'Beta 2' }) },
      oldIndex: 1,
      newIndex: 1,
    }],
  };

  const next = applyDocChanges(previous, snapshot, normalize);
  expect(next).not.toBe(previous);
  expect(next.byId.alpha).toBe(alpha);
  expect(next.items[0]).toBe(alpha);
  expect(next.byId.beta).not.toBe(beta);
  expect(next.byId.beta.label).toBe('Beta 2');
  expect(next.revision).toBe(5);
  expect(normalize).toHaveBeenCalledTimes(1);
});
