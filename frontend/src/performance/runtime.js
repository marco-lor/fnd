const PERFORMANCE_ENABLED = process.env.REACT_APP_FND_PERF === '1';
const EVENT_SCHEMA_VERSION = 1;
const MAX_EVENTS = 50000;
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

const registerAsyncResource = (type, ownerOverride) => {
  const ownerRoute = ownerOverride
    || asyncResourceOwnerOverride
    || asyncResourceOwnerLeases[asyncResourceOwnerLeases.length - 1]?.owner
    || (routeState ? redactString(routeState.routeId) : 'shell');
  const key = `${ownerRoute}::${type}::${++asyncResourceSequence}`;
  activeAsyncResources.set(key, { type, ownerRoute });
  let closed = false;
  return { key, close: () => {
    if (closed) return;
    closed = true;
    activeAsyncResources.delete(key);
  } };
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
  queueMicrotask(() => {
    if (routeState !== state || state.pending > 0 || state.dataReady) return;
    state.dataReady = true;
    recordPerfEvent({ category: 'route', metric: 'data-ready', tags: { phase: 'data-ready' } });
    requestAnimationFrame(() => {
      if (routeState !== state || state.interactive) return;
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
  owner.pending += 1;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    owner.pending = Math.max(0, owner.pending - 1);
    recordPerfEvent({ category: 'route', metric: 'async-complete', tags: { kind } });
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
  media: typeof document !== 'undefined'
    ? {
      elements: document.querySelectorAll('audio,video').length,
      activeSources: Array.from(document.querySelectorAll('audio,video'))
        .filter((element) => Boolean(element.currentSrc || element.getAttribute('src'))).length,
    }
    : { elements: 0, activeSources: 0 },
  routeState: routeState ? { ...routeState } : null,
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
      const resource = registerAsyncResource('timeout');
      const id = originalTimers.setTimeout((...callbackArgs) => {
        resource.close();
        timeouts.delete(id);
        callback(...callbackArgs);
      }, delay, ...args);
      timeouts.set(id, resource);
      return id;
    };
    window.clearTimeout = (id) => {
      timeouts.get(id)?.close();
      timeouts.delete(id);
      return originalTimers.clearTimeout(id);
    };
    window.setInterval = (callback, delay, ...args) => {
      const resource = registerAsyncResource('interval');
      const id = originalTimers.setInterval(callback, delay, ...args);
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
        callback(timestamp);
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
  asyncResourceSequence = 0;
  routeState = null;
  if (originalXhrOpen && typeof XMLHttpRequest !== 'undefined') {
    XMLHttpRequest.prototype.open = originalXhrOpen;
    originalXhrOpen = null;
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
