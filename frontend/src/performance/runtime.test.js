describe('performance runtime', () => {
  const loadRuntime = (enabled) => {
    jest.resetModules();
    process.env.REACT_APP_FND_PERF = enabled ? '1' : '0';
    return require('./runtime');
  };

  afterEach(() => {
    delete window.__FND_PERF__;
    delete window.__FND_PERF_BOOTSTRAP__;
  });

  test('is completely disabled for a normal production mode', () => {
    const runtime = loadRuntime(false);
    runtime.installPerformanceRuntime();
    expect(window.__FND_PERF__).toBeUndefined();
  });

  test('redacts sensitive strings and makes listener cleanup idempotent', () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'runtime-test', actorRole: 'player' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/home', 'player');
    const close = runtime.registerActiveListener('users/sensitive-uid-value-123456789');
    window.__FND_PERF__.mark('probe', {
      email: 'person@example.test',
      url: 'https://example.test/private?q=secret',
      uid: 'abcdefghijklmnopqrstuvwxyz123456',
    });
    runtime.recordPerfEvent({ category: 'firestore', metric: 'initial-documents-delivered' });
    close();
    close();
    const snapshot = window.__FND_PERF__.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain('person@example.test');
    expect(JSON.stringify(snapshot)).not.toContain('private?q=secret');
    expect(snapshot.events.filter((event) => event.metric === 'listener-close')).toHaveLength(1);
    expect(snapshot.events.some((event) => event.metric === 'initial-documents-delivered')).toBe(true);
    expect(snapshot.activeListeners).toEqual({});
    runtime.teardownPerformanceRuntimeForTests();
  });

  test('tracks and releases route-owned timers', () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'timer-test', actorRole: 'player' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/home', 'player');
    const interval = window.setInterval(() => {}, 60_000);
    expect(window.__FND_PERF__.snapshot().activeResources['/home::interval']).toBe(1);
    window.clearInterval(interval);
    expect(window.__FND_PERF__.snapshot().activeResources).toEqual({});
    runtime.teardownPerformanceRuntimeForTests();
  });
});
