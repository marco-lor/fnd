const mockWebChannelSend = function mockWebChannelSend() {
  this.g = {
    onreadystatechange: this.mockReadyStateChange || null,
    readyState: 1,
  };
  this.mockDuringSend?.();
  return 'sent';
};
function MockWebChannelXhrIo() {
  this.g = null;
  this.mockReadyStateChange = null;
  this.mockDuringSend = null;
}
MockWebChannelXhrIo.prototype.ea = mockWebChannelSend;
MockWebChannelXhrIo.prototype.send = mockWebChannelSend;

jest.mock('@firebase/webchannel-wrapper/webchannel-blob', () => ({
  XhrIo: MockWebChannelXhrIo,
}));

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
    const originalFetch = window.fetch;
    const originalRequest = window.Request;
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalWebChannelInternalSend = MockWebChannelXhrIo.prototype.ea;
    const originalWebChannelPublicSend = MockWebChannelXhrIo.prototype.send;
    const runtime = loadRuntime(false);
    runtime.installPerformanceRuntime();
    expect(window.__FND_PERF__).toBeUndefined();
    expect(window.fetch).toBe(originalFetch);
    expect(window.Request).toBe(originalRequest);
    expect(XMLHttpRequest.prototype.open).toBe(originalXhrOpen);
    expect(MockWebChannelXhrIo.prototype.ea).toBe(originalWebChannelInternalSend);
    expect(MockWebChannelXhrIo.prototype.send).toBe(originalWebChannelPublicSend);
    runtime.teardownPerformanceRuntimeForTests();
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

  test('propagates Firestore ownership without claiming an uncorrelated WebChannel-shaped timer', async () => {
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
    const webChannelWatchdogTimeout = window.setTimeout(
      minifiedWebChannelWatchdog,
      45_000
    );
    const webChannelForwardRequestTimeout = runtime.withAsyncResourceOwner(
      'firestore-transport',
      () => window.setTimeout(minifiedWebChannelWatchdog, 310_875)
    );
    const webChannelForwardRequestLowerBound = runtime.withAsyncResourceOwner(
      'firestore-transport',
      () => window.setTimeout(minifiedWebChannelWatchdog, 300_000)
    );
    const webChannelForwardRequestUpperBound = runtime.withAsyncResourceOwner(
      'firestore-transport',
      () => window.setTimeout(minifiedWebChannelWatchdog, 600_000)
    );
    const routeTimeout = window.setTimeout(() => {}, 45_000);

    const snapshot = window.__FND_PERF__.snapshot();
    expect(snapshot.activeResources).toEqual({
      'firestore-transport::timeout': 5,
      '/grigliata::timeout': 2,
    });
    expect(snapshot.activeResourceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerRoute: 'firestore-transport', type: 'timeout', delayMs: 60_000 }),
      expect.objectContaining({ ownerRoute: '/grigliata', type: 'timeout', delayMs: 45_000, callback: 'function(){e()}' }),
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

  test('keeps ambiguous WebChannel-shaped delays route-owned until a matching request is sent', () => {
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-collision-test', actorRole: 'dm' };
    runtime.installPerformanceRuntime();
    runtime.startRouteMeasurement('/grigliata', 'dm');
    const minifiedApplicationCallback = new Function(
      'e',
      'return function(){e()}'
    )(() => {});
    const exactWatchdog = window.setTimeout(minifiedApplicationCallback, 45_000);
    const exactForwardRequest = window.setTimeout(minifiedApplicationCallback, 310_875);
    const belowWatchdog = window.setTimeout(minifiedApplicationCallback, 44_999);
    const belowForwardRequest = window.setTimeout(minifiedApplicationCallback, 299_999);
    const aboveForwardRequest = window.setTimeout(minifiedApplicationCallback, 600_001);
    const routeTimeout = window.setTimeout(() => {}, 45_000);

    const snapshot = window.__FND_PERF__.snapshot();
    expect(snapshot.activeResources).toEqual({
      '/grigliata::timeout': 6,
    });
    expect(snapshot.activeResourceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerRoute: '/grigliata', delayMs: 45_000, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: '/grigliata', delayMs: 310_875, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: '/grigliata', delayMs: 44_999, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: '/grigliata', delayMs: 299_999, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: '/grigliata', delayMs: 600_001, callback: 'function(){e()}' }),
      expect.objectContaining({ ownerRoute: '/grigliata', delayMs: 45_000, callback: '() => {}' }),
    ]));

    window.clearTimeout(exactWatchdog);
    window.clearTimeout(exactForwardRequest);
    window.clearTimeout(belowWatchdog);
    window.clearTimeout(belowForwardRequest);
    window.clearTimeout(aboveForwardRequest);
    window.clearTimeout(routeTimeout);
    expect(window.__FND_PERF__.snapshot().activeResources).toEqual({});
    runtime.teardownPerformanceRuntimeForTests();
  });

  test('correlates only the newest same-turn watchdog with a sent demo Firestore channel request', async () => {
    const originalFetch = window.fetch;
    window.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-request-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const applicationCollision = window.setTimeout(minifiedCallback, 45_000);
      const firestoreWatchdog = window.setTimeout(minifiedCallback, 45_000);

      await window.fetch(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
          + '?VER=8&database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        { method: 'POST' }
      );
      const laterApplicationCollision = window.setTimeout(minifiedCallback, 45_000);

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        '/grigliata::timeout': 2,
        'firestore-transport::timeout': 1,
      });
      expect(window.__FND_PERF__.snapshot().activeResourceDiagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ ownerRoute: '/grigliata', callback: 'function(){e()}', delayMs: 45_000 }),
        expect.objectContaining({
          ownerRoute: 'firestore-transport',
          callback: 'function(){e()}',
          delayMs: 45_000,
          attribution: 'firestore-webchannel-request',
        }),
      ]));

      window.clearTimeout(applicationCollision);
      window.clearTimeout(firestoreWatchdog);
      window.clearTimeout(laterApplicationCollision);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
      window.fetch = originalFetch;
    }
  });

  test('does not correlate an expired-turn or wrong-project watchdog candidate', async () => {
    const originalFetch = window.fetch;
    window.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-negative-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const wrongProjectTimer = window.setTimeout(minifiedCallback, 45_000);
      await window.fetch(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
          + '?database=projects%2Fother-project%2Fdatabases%2F(default)',
        { method: 'POST' }
      );
      const expiredTimer = window.setTimeout(minifiedCallback, 45_000);
      await Promise.resolve();
      await window.fetch(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Write/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        { method: 'POST' }
      );

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        '/grigliata::timeout': 2,
      });
      window.clearTimeout(wrongProjectTimer);
      window.clearTimeout(expiredTimer);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
      window.fetch = originalFetch;
    }
  });

  test('does not claim on Request construction and claims only when that request is fetched', async () => {
    const originalFetch = window.fetch;
    const originalRequest = window.Request;
    class FakeRequest {
      constructor(input, init = {}) {
        this.url = String(input);
        this.method = init.method || 'GET';
      }
    }
    window.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    window.Request = FakeRequest;
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-request-constructor-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const firestoreWatchdog = window.setTimeout(minifiedCallback, 45_000);

      const request = new window.Request(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        { method: 'POST' }
      );

      expect(request).toBeInstanceOf(FakeRequest);
      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        '/grigliata::timeout': 1,
      });
      await window.fetch(request);
      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        'firestore-transport::timeout': 1,
      });
      window.clearTimeout(firestoreWatchdog);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
      window.fetch = originalFetch;
      window.Request = originalRequest;
    }
  });

  test('correlates a watchdog at the pinned WebChannel send boundary', () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-webchannel-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const firestoreWatchdog = window.setTimeout(minifiedCallback, 45_000);
      const channel = new MockWebChannelXhrIo();

      channel.ea(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Write/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        'POST'
      );
      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        'firestore-transport::timeout': 1,
      });
      window.clearTimeout(firestoreWatchdog);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('keeps a same-turn replacement of a correlated WebChannel watchdog transport-owned', async () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-webchannel-replacement-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const initialWatchdog = window.setTimeout(minifiedCallback, 45_000);
      const channel = new MockWebChannelXhrIo();

      channel.ea(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        'POST'
      );
      window.clearTimeout(initialWatchdog);
      const replacementWatchdog = window.setTimeout(minifiedCallback, 45_000);

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        'firestore-transport::timeout': 1,
      });
      expect(window.__FND_PERF__.snapshot().activeResourceDiagnostics).toEqual([
        expect.objectContaining({
          ownerRoute: 'firestore-transport',
          callback: 'function(){e()}',
          delayMs: 45_000,
          attribution: 'firestore-webchannel-watchdog-replacement',
        }),
      ]);

      window.clearTimeout(replacementWatchdog);
      await Promise.resolve();
      const laterApplicationCollision = window.setTimeout(minifiedCallback, 45_000);
      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        '/grigliata::timeout': 1,
      });
      window.clearTimeout(laterApplicationCollision);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('does not inherit transport ownership when a route watchdog-shaped timer is replaced', () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-webchannel-route-replacement-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const routeWatchdog = window.setTimeout(minifiedCallback, 45_000);

      window.clearTimeout(routeWatchdog);
      const replacement = window.setTimeout(minifiedCallback, 45_000);

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        '/grigliata::timeout': 1,
      });
      window.clearTimeout(replacement);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('consumes replacement correlation when the real watchdog is already transport-owned', () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-webchannel-owned-replacement-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const initialWatchdog = window.setTimeout(minifiedCallback, 45_000);
      const channel = new MockWebChannelXhrIo();

      channel.ea(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        'POST'
      );
      window.clearTimeout(initialWatchdog);
      const ownedReplacement = runtime.withAsyncResourceOwner(
        'firestore-transport',
        () => window.setTimeout(minifiedCallback, 45_000)
      );
      const routeLookalike = window.setTimeout(minifiedCallback, 45_000);

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        'firestore-transport::timeout': 1,
        '/grigliata::timeout': 1,
      });
      expect(window.__FND_PERF__.snapshot().activeResourceDiagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ownerRoute: 'firestore-transport',
          callback: 'function(){e()}',
          delayMs: 45_000,
          attribution: 'firestore-webchannel-watchdog-replacement',
        }),
        expect.objectContaining({
          ownerRoute: '/grigliata',
          callback: 'function(){e()}',
          delayMs: 45_000,
        }),
      ]));

      window.clearTimeout(ownedReplacement);
      window.clearTimeout(routeLookalike);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('owns every watchdog scheduled inside an exact demo WebChannel send', () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-webchannel-send-owner-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      const watchdogs = [];
      const channel = new MockWebChannelXhrIo();
      channel.mockDuringSend = () => {
        watchdogs.push(window.setTimeout(minifiedCallback, 45_000));
        watchdogs.push(window.setTimeout(minifiedCallback, 45_000));
      };

      channel.ea(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Write/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        'POST'
      );

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        'firestore-transport::timeout': 2,
      });
      watchdogs.forEach((watchdog) => window.clearTimeout(watchdog));
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('propagates transport ownership through an exact demo WebChannel response callback', () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-fetch-response-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      let resetWatchdog;
      const channel = new MockWebChannelXhrIo();
      channel.mockReadyStateChange = () => {
        resetWatchdog = window.setTimeout(minifiedCallback, 45_000);
      };
      channel.ea(
        'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
          + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
        'POST'
      );

      channel.g.onreadystatechange();

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        'firestore-transport::timeout': 1,
      });
      window.clearTimeout(resetWatchdog);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('keeps a non-demo WebChannel response callback route-owned', () => {
    const runtime = loadRuntime(true);
    try {
      window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-non-demo-response-test', actorRole: 'dm' };
      runtime.installPerformanceRuntime();
      runtime.startRouteMeasurement('/grigliata', 'dm');
      const minifiedCallback = new Function(
        'e',
        'return function(){e()}'
      )(() => {});
      let applicationTimer;
      const channel = new MockWebChannelXhrIo();
      channel.mockReadyStateChange = () => {
        applicationTimer = window.setTimeout(minifiedCallback, 45_000);
      };
      channel.ea(
        'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel'
          + '?database=projects%2Fproduction-project%2Fdatabases%2F(default)',
        'POST'
      );

      channel.g.onreadystatechange();

      expect(window.__FND_PERF__.snapshot().activeResources).toEqual({
        '/grigliata::timeout': 1,
      });
      window.clearTimeout(applicationTimer);
    } finally {
      runtime.teardownPerformanceRuntimeForTests();
    }
  });

  test('restores WebChannel hooks and any still-live response callback during teardown', () => {
    const originalInternalSend = MockWebChannelXhrIo.prototype.ea;
    const originalPublicSend = MockWebChannelXhrIo.prototype.send;
    const responseCallback = jest.fn();
    const runtime = loadRuntime(true);
    window.__FND_PERF_BOOTSTRAP__ = { runId: 'transport-teardown-test', actorRole: 'dm' };
    runtime.installPerformanceRuntime();
    const channel = new MockWebChannelXhrIo();
    channel.mockReadyStateChange = responseCallback;
    channel.ea(
      'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
        + '?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)',
      'POST'
    );
    const wrappedResponseCallback = channel.g.onreadystatechange;

    expect(MockWebChannelXhrIo.prototype.ea).not.toBe(originalInternalSend);
    expect(MockWebChannelXhrIo.prototype.send).not.toBe(originalPublicSend);
    expect(wrappedResponseCallback).not.toBe(responseCallback);

    runtime.teardownPerformanceRuntimeForTests();

    expect(MockWebChannelXhrIo.prototype.ea).toBe(originalInternalSend);
    expect(MockWebChannelXhrIo.prototype.send).toBe(originalPublicSend);
    expect(channel.g.onreadystatechange).toBe(responseCallback);
  });

  test('matches the pinned real WebChannel private send alias contract', () => {
    const actualWebChannel = jest.requireActual(
      '@firebase/webchannel-wrapper/webchannel-blob'
    );
    expect(typeof actualWebChannel.XhrIo.prototype.ea).toBe('function');
    expect(actualWebChannel.XhrIo.prototype.send).toBe(
      actualWebChannel.XhrIo.prototype.ea
    );
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
