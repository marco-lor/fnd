import { XhrIo as FirestoreWebChannelXhrIo } from '@firebase/webchannel-wrapper/webchannel-blob';

const PERFORMANCE_ENABLED = process.env.REACT_APP_FND_PERF === '1';
const EVENT_SCHEMA_VERSION = 1;
const MAX_EVENTS = 50000;
const FIRESTORE_WEBCHANNEL_CALLBACK_SOURCE = 'function(){e()}';
const FIRESTORE_EMULATOR_ORIGIN = 'http://127.0.0.1:8080';
const FIRESTORE_EMULATOR_DATABASE = 'projects/demo-fnd-perf/databases/(default)';
const SAFE_METADATA_KEYS = new Set([
  'runId',
  'routeId',
  'actorRole',
  'release',
  'browserProfile',
  'connectionProfile',
  'scenarioId',
  'fixtureVersion',
]);

let events = [];
let metadata = {};
let activeListeners = new Map();
let routeState = null;
let longTaskObserver = null;
let konvaInstalled = false;
let originalXhrOpen = null;
let asyncResourceSequence = 0;
let activeAsyncResources = new Map();
let originalTimers = null;
let observerPatches = [];
const observerResourceKeys = new WeakMap();
let asyncResourceOwnerOverride = null;
let asyncResourceOwnerLeases = [];
let originalFetch = null;
let originalWebChannelInternalSend = null;
let originalWebChannelPublicSend = null;
let firestoreWebChannelResponseCallbacks = new Map();
let pendingWebChannelTimerTurn = null;
let pendingFirestoreWatchdogReplacementTurn = null;

const redactString = (value) => {
  const text = String(value ?? '').slice(0, 160);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return '[redacted-email]';
  if (/^(https?:|blob:|data:)/i.test(text)) return '[redacted-url]';
  if (/^(?=.*\d)[A-Za-z0-9_-]{24,}$/.test(text)) return '[redacted-identifier]';
  return text;
};

const sanitizePrimitive = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value == null) return null;
  return redactString(value);
};

const sanitizeTags = (tags = {}) => Object.fromEntries(
  Object.entries(tags)
    .slice(0, 24)
    .map(([key, value]) => [redactString(key), sanitizePrimitive(value)])
);

const currentRouteId = () => (
  metadata.routeId
  || routeState?.routeId
  || (typeof window !== 'undefined' ? window.location.pathname : 'unknown')
);

const registerAsyncResource = (type, ownerOverride, diagnostics = null) => {
  const ownerRoute = ownerOverride
    || asyncResourceOwnerOverride
    || asyncResourceOwnerLeases[asyncResourceOwnerLeases.length - 1]?.owner
    || (routeState ? redactString(routeState.routeId) : 'shell');
  const key = `${ownerRoute}::${type}::${++asyncResourceSequence}`;
  const resource = {
    key,
    diagnostics,
    type,
    ownerRoute,
    closed: false,
    close() {
      if (resource.closed) return;
      resource.closed = true;
      activeAsyncResources.delete(key);
    },
  };
  activeAsyncResources.set(key, resource);
  return resource;
};

const describeTimerCallback = (callback) => {
  if (typeof callback !== 'function') return { callback: typeof callback };
  try {
    return {
      callback: Function.prototype.toString.call(callback).replace(/\s+/g, ' ').slice(0, 240),
    };
  } catch (_error) {
    return { callback: 'unavailable' };
  }
};

const isFirestoreTransportDelayedOperation = (callback, delay) => {
  if (typeof callback !== 'function' || Number(delay) < 1_000) return false;
  try {
    const source = Function.prototype.toString.call(callback).replace(/\s+/g, '');
    // Firestore's pinned SDK schedules persistent listen/write stream idle work
    // through DelayedOperation callbacks with this method name. These timers
    // survive route listener cleanup because they belong to the shared client
    // transport, not the route that happened to initiate the stream.
    return source === '()=>this.handleDelayElapsed()';
  } catch (_error) {
    return false;
  }
};

const isFirestoreWebChannelDelay = (delay) => {
  const normalizedDelay = Number(delay);
  return normalizedDelay === 45_000
    || (normalizedDelay >= 300_000 && normalizedDelay <= 600_000);
};

const requestMethod = (input, init, fallbackMethod = 'GET') => String(
  init?.method || input?.method || fallbackMethod
).toUpperCase();

const isDemoFirestoreWebChannelRequest = (
  input,
  init,
  fallbackMethod = 'GET'
) => {
  const rawUrl = typeof input === 'string' ? input : input?.url;
  if (!rawUrl) return false;
  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.href : undefined;
    const parsed = new URL(String(rawUrl), baseUrl);
    const method = requestMethod(input, init, fallbackMethod);
    return parsed.origin === FIRESTORE_EMULATOR_ORIGIN
      && /\/google\.firestore\.v1\.Firestore\/(?:Listen|Write)\/channel\/?$/.test(parsed.pathname)
      && parsed.searchParams.get('database') === FIRESTORE_EMULATOR_DATABASE
      && (method === 'GET' || method === 'POST');
  } catch (_error) {
    return false;
  }
};

const recordAmbiguousWebChannelTimer = (resource) => {
  let turn = pendingWebChannelTimerTurn;
  if (!turn) {
    turn = { candidates: [] };
    pendingWebChannelTimerTurn = turn;
    const expire = () => {
      if (pendingWebChannelTimerTurn === turn) pendingWebChannelTimerTurn = null;
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(expire);
    else Promise.resolve().then(expire);
  }
  turn.candidates.push(resource);
};

const claimNewestFirestoreWebChannelTimer = () => {
  const turn = pendingWebChannelTimerTurn;
  pendingWebChannelTimerTurn = null;
  if (!turn) return false;
  for (let index = turn.candidates.length - 1; index >= 0; index -= 1) {
    const candidate = turn.candidates[index];
    if (candidate.closed || candidate.ownerRoute === 'firestore-transport') continue;
    candidate.ownerRoute = 'firestore-transport';
    candidate.diagnostics = {
      ...(candidate.diagnostics || {}),
      attribution: 'firestore-webchannel-request',
    };
    return true;
  }
  return false;
};

const recordFirestoreWatchdogReplacementTurn = () => {
  const turn = {};
  pendingFirestoreWatchdogReplacementTurn = turn;
  const expire = () => {
    if (pendingFirestoreWatchdogReplacementTurn === turn) {
      pendingFirestoreWatchdogReplacementTurn = null;
    }
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(expire);
  else Promise.resolve().then(expire);
};

const claimFirestoreWatchdogReplacement = (resource) => {
  if (
    !pendingFirestoreWatchdogReplacementTurn
    || resource.closed
    || resource.diagnostics?.callback !== FIRESTORE_WEBCHANNEL_CALLBACK_SOURCE
    || resource.diagnostics?.delayMs !== 45_000
  ) {
    return false;
  }
  pendingFirestoreWatchdogReplacementTurn = null;
  if (resource.ownerRoute !== 'firestore-transport') {
    resource.ownerRoute = 'firestore-transport';
  }
  resource.diagnostics = {
    ...(resource.diagnostics || {}),
    attribution: 'firestore-webchannel-watchdog-replacement',
  };
  return true;
};

const wrapFirestoreWebChannelResponseCallback = (xhr) => {
  const callback = xhr?.onreadystatechange;
  if (typeof callback !== 'function' || firestoreWebChannelResponseCallbacks.has(xhr)) return;
  const wrapped = function firestoreOwnedReadyStateChange(...callbackArgs) {
    try {
      return withAsyncResourceOwner(
        'firestore-transport',
        () => callback.apply(this, callbackArgs)
      );
    } finally {
      if (xhr.readyState === 4) firestoreWebChannelResponseCallbacks.delete(xhr);
    }
  };
  firestoreWebChannelResponseCallbacks.set(xhr, { callback, wrapped });
  xhr.onreadystatechange = wrapped;
};

export const isPerformanceEnabled = () => PERFORMANCE_ENABLED;

export const withAsyncResourceOwner = (owner, callback) => {
  if (!PERFORMANCE_ENABLED) return callback();
  const previousOwner = asyncResourceOwnerOverride;
  asyncResourceOwnerOverride = redactString(owner || 'shell');
  try {
    return callback();
  } finally {
    asyncResourceOwnerOverride = previousOwner;
  }
};

export const beginAsyncResourceOwner = (owner = 'shell') => {
  if (!PERFORMANCE_ENABLED) return () => {};
  const lease = { owner: redactString(owner) };
  asyncResourceOwnerLeases.push(lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    asyncResourceOwnerLeases = asyncResourceOwnerLeases.filter((candidate) => candidate !== lease);
  };
};

export const recordPerfEvent = ({
  category,
  metric,
  value = 1,
  unit = 'count',
  tags = {},
}) => {
  if (!PERFORMANCE_ENABLED || events.length >= MAX_EVENTS) return;
  events.push({
    schemaVersion: EVENT_SCHEMA_VERSION,
    runId: redactString(metadata.runId || 'unassigned'),
    routeId: redactString(currentRouteId()),
    actorRole: redactString(metadata.actorRole || 'unknown'),
    category: redactString(category),
    metric: redactString(metric),
    value: sanitizePrimitive(value),
    unit: redactString(unit),
    timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    tags: sanitizeTags(tags),
  });
};

const markReadyIfSettled = () => {
  const state = routeState;
  if (!PERFORMANCE_ENABLED || !state || state.dataReady || !state.shellVisible || !state.effectsMounted || state.pending > 0) return;
  requestAnimationFrame(() => {
    if (routeState !== state || state.pending > 0 || state.dataReady || !state.effectsMounted) return;
    state.dataReady = true;
    recordPerfEvent({ category: 'route', metric: 'data-ready', tags: { phase: 'data-ready' } });
    requestAnimationFrame(() => {
      if (routeState !== state || state.pending > 0 || !state.dataReady || state.interactive) return;
      state.interactive = true;
      recordPerfEvent({ category: 'route', metric: 'interactive', tags: { phase: 'interactive' } });
    });
  });
};

export const startRouteMeasurement = (routeId, actorRole = 'unknown') => {
  if (!PERFORMANCE_ENABLED) return;
  if (routeState?.routeId === routeId) {
    metadata = { ...metadata, actorRole: redactString(actorRole) };
    return;
  }
  metadata = { ...metadata, routeId: redactString(routeId), actorRole: redactString(actorRole) };
  routeState = {
    routeId: redactString(routeId),
    shellVisible: false,
    effectsMounted: false,
    dataReady: false,
    interactive: false,
    pending: 0,
    pendingKinds: {},
  };
  recordPerfEvent({ category: 'route', metric: 'start' });
};

export const markRouteShellVisible = () => {
  if (!PERFORMANCE_ENABLED || !routeState) return;
  routeState.shellVisible = true;
  recordPerfEvent({ category: 'route', metric: 'shell-visible', tags: { phase: 'shell-visible' } });
  markReadyIfSettled();
};

export const markRouteEffectsMounted = () => {
  if (!PERFORMANCE_ENABLED || !routeState) return;
  routeState.effectsMounted = true;
  markReadyIfSettled();
};

export const beginRouteAsyncWork = (kind = 'data') => {
  if (!PERFORMANCE_ENABLED || !routeState) return () => {};
  const owner = routeState;
  const safeKind = redactString(kind);
  owner.dataReady = false;
  owner.interactive = false;
  owner.pending += 1;
  owner.pendingKinds[safeKind] = (owner.pendingKinds[safeKind] || 0) + 1;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    owner.pending = Math.max(0, owner.pending - 1);
    const remainingKindCount = Math.max(0, (owner.pendingKinds[safeKind] || 1) - 1);
    if (remainingKindCount) owner.pendingKinds[safeKind] = remainingKindCount;
    else delete owner.pendingKinds[safeKind];
    recordPerfEvent({ category: 'route', metric: 'async-complete', tags: { kind: safeKind } });
    if (routeState === owner) markReadyIfSettled();
  };
};

export const registerActiveListener = (metricKey, ownership = 'route') => {
  if (!PERFORMANCE_ENABLED) return () => {};
  const ownerRoute = ownership === 'shell' ? 'shell' : redactString(currentRouteId());
  const target = redactString(metricKey);
  const key = `${ownerRoute}::${target}`;
  activeListeners.set(key, (activeListeners.get(key) || 0) + 1);
  recordPerfEvent({ category: 'firestore', metric: 'listener-open', tags: { target, ownerRoute } });
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const remaining = Math.max(0, (activeListeners.get(key) || 1) - 1);
    if (remaining) activeListeners.set(key, remaining);
    else activeListeners.delete(key);
    recordPerfEvent({ category: 'firestore', metric: 'listener-close', tags: { target, ownerRoute } });
  };
};

export const measureNormalization = (metricKey, input, normalize) => {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const output = normalize(input);
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  recordPerfEvent({
    category: 'normalization',
    metric: redactString(metricKey),
    value: end - start,
    unit: 'ms',
    tags: {
      inputCount: Array.isArray(input) ? input.length : Number(input?.size) || 0,
      outputCount: Array.isArray(output) ? output.length : Number(output?.size) || 0,
    },
  });
  return output;
};

export const recordReactProfilerCommit = (id, phase, actualDuration, baseDuration) => {
  recordPerfEvent({
    category: 'react',
    metric: 'commit',
    value: actualDuration,
    unit: 'ms',
    tags: { id, phase, baseDuration },
  });
};

export const installKonvaInstrumentation = (Konva) => {
  if (!PERFORMANCE_ENABLED || konvaInstalled || !Konva?.Layer?.prototype) return;
  konvaInstalled = true;
  const prototype = Konva.Layer.prototype;
  const originalDraw = prototype.draw;
  const originalBatchDraw = prototype.batchDraw;
  prototype.draw = function instrumentedDraw(...args) {
    recordPerfEvent({ category: 'konva', metric: 'draw', tags: { layer: this.name?.() || this.id?.() || 'unnamed' } });
    return originalDraw.apply(this, args);
  };
  prototype.batchDraw = function instrumentedBatchDraw(...args) {
    recordPerfEvent({ category: 'konva', metric: 'batch-draw-scheduled', tags: { layer: this.name?.() || this.id?.() || 'unnamed' } });
    return originalBatchDraw.apply(this, args);
  };
};

const aggregateResources = () => {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return {};
  return performance.getEntriesByType('resource').reduce((result, entry) => {
    const type = redactString(entry.initiatorType || 'other');
    result[type] ||= { count: 0, transferBytes: 0, encodedBytes: 0, decodedBytes: 0 };
    result[type].count += 1;
    result[type].transferBytes += Number(entry.transferSize) || 0;
    result[type].encodedBytes += Number(entry.encodedBodySize) || 0;
    result[type].decodedBytes += Number(entry.decodedBodySize) || 0;
    return result;
  }, {});
};

const runtimeSnapshot = () => ({
  schemaVersion: EVENT_SCHEMA_VERSION,
  metadata: { ...metadata },
  events: events.map((event) => ({ ...event, tags: { ...event.tags } })),
  activeListeners: Object.fromEntries(activeListeners),
  activeResources: Object.fromEntries(
    Array.from(activeAsyncResources.values()).reduce((counts, resource) => {
      const key = `${resource.ownerRoute}::${resource.type}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map())
  ),
  activeResourceDiagnostics: Array.from(activeAsyncResources.values()).map((resource) => ({
    ownerRoute: resource.ownerRoute,
    type: resource.type,
    ...(resource.diagnostics || {}),
  })),
  media: typeof document !== 'undefined'
    ? {
      elements: document.querySelectorAll('audio,video').length,
      activeSources: Array.from(document.querySelectorAll('audio,video'))
        .filter((element) => Boolean(element.currentSrc || element.getAttribute('src'))).length,
    }
    : { elements: 0, activeSources: 0 },
  routeState: routeState ? {
    ...routeState,
    pendingKinds: { ...routeState.pendingKinds },
  } : null,
  resources: aggregateResources(),
  heap: typeof performance !== 'undefined' && performance.memory
    ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    }
    : null,
});

export const installPerformanceRuntime = () => {
  if (!PERFORMANCE_ENABLED || typeof window === 'undefined') return;
  const bootstrap = window.__FND_PERF_BOOTSTRAP__ || {};
  metadata = Object.fromEntries(
    Object.entries(bootstrap)
      .filter(([key]) => SAFE_METADATA_KEYS.has(key))
      .map(([key, value]) => [key, sanitizePrimitive(value)])
  );

  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTaskObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => recordPerfEvent({
        category: 'runtime',
        metric: 'long-task',
        value: entry.duration,
        unit: 'ms',
      }));
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  }

  if (typeof XMLHttpRequest !== 'undefined' && !originalXhrOpen) {
    originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function instrumentedOpen(method, url, async = true, ...args) {
      if (async === false) {
        recordPerfEvent({
          category: 'runtime',
          metric: 'synchronous-network-call',
          tags: { method: String(method || 'GET').toUpperCase() },
        });
      }
      return originalXhrOpen.call(this, method, url, async, ...args);
    };
  }

  if (typeof window.fetch === 'function' && !originalFetch) {
    originalFetch = window.fetch;
    window.fetch = function instrumentedFetch(input, ...args) {
      const isFirestoreWebChannel = isDemoFirestoreWebChannelRequest(input, args[0]);
      const result = originalFetch.call(this, input, ...args);
      if (isFirestoreWebChannel) claimNewestFirestoreWebChannelTimer();
      return result;
    };
  }

  const webChannelPrototype = FirestoreWebChannelXhrIo?.prototype;
  if (
    webChannelPrototype?.ea
    && webChannelPrototype.send === webChannelPrototype.ea
    && !originalWebChannelInternalSend
  ) {
    originalWebChannelInternalSend = webChannelPrototype.ea;
    originalWebChannelPublicSend = webChannelPrototype.send;
    const instrumentedWebChannelSend = function instrumentedWebChannelSend(
      url,
      method,
      ...args
    ) {
      const isFirestoreWebChannel = isDemoFirestoreWebChannelRequest(
        String(url),
        { method },
        method
      );
      const result = isFirestoreWebChannel
        ? withAsyncResourceOwner(
          'firestore-transport',
          () => originalWebChannelInternalSend.call(this, url, method, ...args)
        )
        : originalWebChannelInternalSend.call(this, url, method, ...args);
      if (isFirestoreWebChannel) {
        wrapFirestoreWebChannelResponseCallback(this.g);
        claimNewestFirestoreWebChannelTimer();
      }
      return result;
    };
    webChannelPrototype.ea = instrumentedWebChannelSend;
    webChannelPrototype.send = instrumentedWebChannelSend;
  }

  if (!originalTimers) {
    originalTimers = {
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    };
    const timeouts = new Map();
    const intervals = new Map();
    const frames = new Map();
    window.setTimeout = (callback, delay, ...args) => {
      const resource = registerAsyncResource(
        'timeout',
        isFirestoreTransportDelayedOperation(callback, delay)
          ? 'firestore-transport'
          : undefined,
        {
          ...describeTimerCallback(callback),
          delayMs: Number(delay) || 0,
        }
      );
      let id;
      try {
        id = originalTimers.setTimeout((...callbackArgs) => {
          resource.close();
          timeouts.delete(id);
          withAsyncResourceOwner(resource.ownerRoute, () => callback(...callbackArgs));
        }, delay, ...args);
      } catch (error) {
        resource.close();
        throw error;
      }
      timeouts.set(id, resource);
      if (claimFirestoreWatchdogReplacement(resource)) {
        return id;
      }
      if (
        resource.ownerRoute !== 'firestore-transport'
        && resource.diagnostics?.callback === FIRESTORE_WEBCHANNEL_CALLBACK_SOURCE
        && isFirestoreWebChannelDelay(resource.diagnostics?.delayMs)
      ) {
        recordAmbiguousWebChannelTimer(resource);
      }
      return id;
    };
    window.clearTimeout = (id) => {
      const resource = timeouts.get(id);
      const isFirestoreWatchdog = resource?.ownerRoute === 'firestore-transport'
        && resource.diagnostics?.callback === FIRESTORE_WEBCHANNEL_CALLBACK_SOURCE
        && resource.diagnostics?.delayMs === 45_000;
      resource?.close();
      timeouts.delete(id);
      const result = originalTimers.clearTimeout(id);
      if (isFirestoreWatchdog) recordFirestoreWatchdogReplacementTurn();
      return result;
    };
    window.setInterval = (callback, delay, ...args) => {
      const resource = registerAsyncResource('interval', undefined, {
        ...describeTimerCallback(callback),
        delayMs: Number(delay) || 0,
      });
      const id = originalTimers.setInterval(
        (...callbackArgs) => withAsyncResourceOwner(
          resource.ownerRoute,
          () => callback(...callbackArgs)
        ),
        delay,
        ...args
      );
      intervals.set(id, resource);
      return id;
    };
    window.clearInterval = (id) => {
      intervals.get(id)?.close();
      intervals.delete(id);
      return originalTimers.clearInterval(id);
    };
    window.requestAnimationFrame = (callback) => {
      const resource = registerAsyncResource('animation-frame');
      const id = originalTimers.requestAnimationFrame((timestamp) => {
        resource.close();
        frames.delete(id);
        withAsyncResourceOwner(resource.ownerRoute, () => callback(timestamp));
      });
      frames.set(id, resource);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.get(id)?.close();
      frames.delete(id);
      return originalTimers.cancelAnimationFrame(id);
    };
  }

  ['ResizeObserver', 'IntersectionObserver', 'MutationObserver'].forEach((name) => {
    const ObserverType = window[name];
    if (!ObserverType?.prototype?.observe || !ObserverType.prototype.disconnect) return;
    const originalObserve = ObserverType.prototype.observe;
    const originalDisconnect = ObserverType.prototype.disconnect;
      ObserverType.prototype.observe = function instrumentedObserve(...args) {
        const target = args[0];
        const shellTarget = target === document
          || target === document.documentElement
          || target === document.body
          || target === document.getElementById('root');
        if (!observerResourceKeys.has(this)) {
          observerResourceKeys.set(this, registerAsyncResource(name, shellTarget ? 'shell' : undefined));
        }
        return originalObserve.apply(this, args);
      };
    ObserverType.prototype.disconnect = function instrumentedDisconnect(...args) {
      observerResourceKeys.get(this)?.close();
      observerResourceKeys.delete(this);
      return originalDisconnect.apply(this, args);
    };
    observerPatches.push({ prototype: ObserverType.prototype, originalObserve, originalDisconnect });
  });

  window.__FND_PERF__ = {
    reset(nextMetadata = {}) {
      events = [];
      metadata = Object.fromEntries(
        Object.entries(nextMetadata)
          .filter(([key]) => SAFE_METADATA_KEYS.has(key))
          .map(([key, value]) => [key, sanitizePrimitive(value)])
      );
      routeState = null;
      performance.clearMarks?.();
      performance.clearMeasures?.();
    },
    mark(name, tags = {}) {
      recordPerfEvent({ category: 'custom', metric: name, tags });
    },
    markRouteReady(phase) {
      recordPerfEvent({ category: 'route', metric: phase, tags: { phase } });
    },
    snapshot: runtimeSnapshot,
    flush: runtimeSnapshot,
  };
};

export const teardownPerformanceRuntimeForTests = () => {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  events = [];
  metadata = {};
  activeListeners = new Map();
  activeAsyncResources = new Map();
  asyncResourceOwnerOverride = null;
  asyncResourceOwnerLeases = [];
  pendingWebChannelTimerTurn = null;
  pendingFirestoreWatchdogReplacementTurn = null;
  asyncResourceSequence = 0;
  routeState = null;
  if (originalXhrOpen && typeof XMLHttpRequest !== 'undefined') {
    XMLHttpRequest.prototype.open = originalXhrOpen;
    originalXhrOpen = null;
  }
  if (originalFetch && typeof window !== 'undefined') {
    window.fetch = originalFetch;
    originalFetch = null;
  }
  firestoreWebChannelResponseCallbacks.forEach(({ callback, wrapped }, xhr) => {
    if (xhr.onreadystatechange === wrapped) xhr.onreadystatechange = callback;
  });
  firestoreWebChannelResponseCallbacks = new Map();
  if (originalWebChannelInternalSend) {
    const webChannelPrototype = FirestoreWebChannelXhrIo?.prototype;
    if (webChannelPrototype) {
      webChannelPrototype.ea = originalWebChannelInternalSend;
      webChannelPrototype.send = originalWebChannelPublicSend;
    }
    originalWebChannelInternalSend = null;
    originalWebChannelPublicSend = null;
  }
  if (originalTimers && typeof window !== 'undefined') {
    Object.assign(window, originalTimers);
    originalTimers = null;
  }
  observerPatches.forEach(({ prototype, originalObserve, originalDisconnect }) => {
    prototype.observe = originalObserve;
    prototype.disconnect = originalDisconnect;
  });
  observerPatches = [];
};
