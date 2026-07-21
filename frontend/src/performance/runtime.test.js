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

  test('revokes premature readiness when route work begins and settles on painted frames', () => {
    const originalAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const frames = [];
    window.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    window.cancelAnimationFrame = jest.fn();
    const flushFrames = () => {
      while (frames.length) frames.shift()(performance.now());
    };
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'readiness-test', actorRole: 'player' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/codex', 'player');
      runtime.markRouteShellVisible();
      runtime.markRouteEffectsMounted();
      flushFrames();

      expect(window.__FND_PERF__.snapshot().routeState).toMatchObject({
        dataReady: true,
        interactive: true,
        pending: 0,
      });

      const complete = runtime.beginRouteAsyncWork('late-listener');
      expect(window.__FND_PERF__.snapshot().routeState).toMatchObject({
        dataReady: false,
        interactive: false,
        pending: 1,
      });

      complete();
      flushFrames();
      expect(window.__FND_PERF__.snapshot().routeState).toMatchObject({
        dataReady: true,
        interactive: true,
        pending: 0,
      });
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
      window.requestAnimationFrame = originalAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
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

  test('can assign persistent shell resources independently of route timing', () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'shell-owner-test', actorRole: 'anonymous' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/', 'anonymous');
    let interval;

    runtime.withAsyncResourceOwner('shell', () => {
      interval = window.setInterval(() => {}, 60_000);
    });

    expect(window.__FND_PERF__.snapshot().activeResources).toEqual({ 'shell::interval': 1 });
    window.clearInterval(interval);
    runtime.teardownPerformanceRuntimeForTests();
  });

  test('keeps asynchronously-created startup resources under a leased shell owner', () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'shell-lease-test', actorRole: 'anonymous' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/', 'anonymous');
    const release = runtime.beginAsyncResourceOwner('shell');
    const shellInterval = window.setInterval(() => {}, 60_000);
    release();
    const routeInterval = window.setInterval(() => {}, 60_000);

    expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
      'shell::interval': 1,
      '/::interval': 1,
    });
    window.clearInterval(shellInterval);
    window.clearInterval(routeInterval);
    runtime.teardownPerformanceRuntimeForTests();
  });
});
