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
        pendingKinds: { 'late-listener': 1 },
      });

      complete();
      flushFrames();
      expect(window.__FND_PERF__.snapshot().routeState).toMatchObject({
        dataReady: true,
        interactive: true,
        pending: 0,
        pendingKinds: {},
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

  test('propagates Firestore transport ownership through timer callbacks without hiding route timeouts', async () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-timer-test', actorRole: 'dm' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/grigliata', 'dm');
    let transportTimeout;
    await new Promise((resolve) => {
      runtime.withAsyncResourceOwner('firestore-transport', () => {
        window.setTimeout(() => {
          transportTimeout = window.setTimeout(() => {}, 60_000);
          resolve();
        }, 0);
      });
    });
    class PinnedDelayedOperationShape {
      handleDelayElapsed() {}

      schedule() {
        return window.setTimeout(() => this.handleDelayElapsed(), 60_000);
      }
    }
    const delayedOperationTimeout = new PinnedDelayedOperationShape().schedule();
    const minifiedWebChannelWatchdog = new Function(
      'e',
      'return function(){e()}'
    )(() => {});
    runtime.withAsyncResourceOwner('firestore-transport', () => {});
    const webChannelWatchdogTimeout = window.setTimeout(
      minifiedWebChannelWatchdog,
      45_000
    );
    const webChannelForwardRequestTimeout = window.setTimeout(
      minifiedWebChannelWatchdog,
      310_875
    );
    const webChannelForwardRequestLowerBound = window.setTimeout(
      minifiedWebChannelWatchdog,
      300_000
    );
    const webChannelForwardRequestUpperBound = window.setTimeout(
      minifiedWebChannelWatchdog,
      600_000
    );
    const routeTimeout = window.setTimeout(() => {}, 45_000);

    const snapshot = window.__FND_PERF__.snapshot();
    expect(snapshot.activeResources).toEqual({
      'firestore-transport::timeout': 6,
      '/grigliata::timeout': 1,
    });
    expect(snapshot.activeResourceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerRoute: 'firestore-transport', type: 'timeout', delayMs: 60_000 }),
      expect.objectContaining({ ownerRoute: 'firestore-transport', type: 'timeout', delayMs: 45_000, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: 'firestore-transport', type: 'timeout', delayMs: 310_875, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: 'firestore-transport', type: 'timeout', delayMs: 300_000, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: 'firestore-transport', type: 'timeout', delayMs: 600_000, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: '/grigliata', type: 'timeout', delayMs: 45_000, callback: '() => {}' }),
    ]));
    expect(snapshot.activeResourceDiagnostics.every(({ callback = '' }) => callback.length <= 240)).toBe(true);

    window.clearTimeout(transportTimeout);
    window.clearTimeout(delayedOperationTimeout);
    window.clearTimeout(webChannelWatchdogTimeout);
    window.clearTimeout(webChannelForwardRequestTimeout);
    window.clearTimeout(webChannelForwardRequestLowerBound);
    window.clearTimeout(webChannelForwardRequestUpperBound);
    window.clearTimeout(routeTimeout);
    expect(window.__FND_PERF__.snapshot().activeResources).toEqual({});
    runtime.teardownPerformanceRuntimeForTests();
  });

  test('keeps callback-text collisions route-owned without Firestore transport provenance', () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-collision-test', actorRole: 'dm' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/grigliata', 'dm');
    const minifiedApplicationCallback = new Function(
      'e',
      'return function(){e()}'
    )(() => {});
    const watchdogCollision = window.setTimeout(minifiedApplicationCallback, 45_000);
    const forwardRequestCollision = window.setTimeout(minifiedApplicationCallback, 310_875);
    const applicationDelayedOperation = { handleDelayElapsed: jest.fn() };
    const delayedOperationCollision = window.setTimeout(
      () => {
        applicationDelayedOperation.handleDelayElapsed();
      },
      60_000
    );

    expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
      '/grigliata::timeout': 3,
    });

    window.clearTimeout(watchdogCollision);
    window.clearTimeout(forwardRequestCollision);
    window.clearTimeout(delayedOperationCollision);
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
