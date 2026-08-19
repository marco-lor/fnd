const RENDER_SCHEDULER_DRAIN_TIMEOUT_MS = 2_000;

const schedulerContext = ({ cycle, route }) => ({
  cycle: Number.isInteger(cycle) && cycle > 0 ? cycle : null,
  route: typeof route === 'string' && route ? route : 'unknown-route',
});

const schedulerFailure = (reason, snapshot, context) => new Error(
  `Task 07 render scheduler ${reason}: ${JSON.stringify({
    ...schedulerContext(context),
    snapshot,
  })}`
);

const validateRenderSchedulerSnapshot = (snapshot, context = {}) => {
  if (
    snapshot?.visibilityState !== 'visible'
    || snapshot?.hasFocus !== true
  ) {
    throw schedulerFailure('has invalid foreground state', snapshot, context);
  }
  if (snapshot?.state !== 'settled' || snapshot?.frameCount !== 2) {
    throw schedulerFailure('did not settle', snapshot, context);
  }
  if (snapshot?.stageCount !== 0 || snapshot?.containerCount !== 0) {
    throw schedulerFailure('retained a Konva stage or container', snapshot, context);
  }
  return snapshot;
};

const drainRouteRenderScheduler = async (page, {
  cycle,
  route,
  timeoutMs = RENDER_SCHEDULER_DRAIN_TIMEOUT_MS,
} = {}) => {
  await page.bringToFront();
  const snapshot = await page.evaluate(({ ownedRoute, ownedTimeoutMs }) => new Promise((resolve) => {
    let finished = false;
    let frameCount = 0;
    let frameHandle = null;
    let timeoutId = null;
    const startedAt = performance.now();
    const collectSnapshot = (state) => {
      const performanceSnapshot = window.__FND_PERF__?.snapshot?.() || {};
      const routePrefix = `${ownedRoute}::`;
      return {
        containerCount: document.querySelectorAll('.konvajs-content').length,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        frameCount,
        hasFocus: document.hasFocus(),
        routeActiveResources: Object.fromEntries(
          Object.entries(performanceSnapshot.activeResources || {})
            .filter(([key]) => key.startsWith(routePrefix))
            .slice(0, 20)
        ),
        routeDiagnostics: (performanceSnapshot.activeResourceDiagnostics || [])
          .filter((resource) => resource.ownerRoute === ownedRoute)
          .slice(0, 10)
          .map((resource) => ({
            attribution: resource.attribution,
            callback: typeof resource.callback === 'string'
              ? resource.callback.slice(0, 160)
              : undefined,
            delayMs: resource.delayMs,
            ownerRoute: resource.ownerRoute,
            type: resource.type,
          })),
        stageCount: Array.isArray(window.Konva?.stages) ? window.Konva.stages.length : 0,
        state,
        visibilityState: document.visibilityState,
      };
    };
    const finish = (state) => {
      if (finished) return;
      finished = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      resolve(collectSnapshot(state));
    };
    const onFrame = () => {
      if (finished) return;
      frameHandle = null;
      frameCount += 1;
      if (frameCount < 2) {
        frameHandle = window.requestAnimationFrame(onFrame);
        return;
      }
      finish('settled');
    };
    timeoutId = window.setTimeout(() => finish('timeout'), ownedTimeoutMs);
    frameHandle = window.requestAnimationFrame(onFrame);
  }), {
    ownedRoute: route,
    ownedTimeoutMs: timeoutMs,
  });
  return validateRenderSchedulerSnapshot(snapshot, { cycle, route });
};

module.exports = {
  RENDER_SCHEDULER_DRAIN_TIMEOUT_MS,
  drainRouteRenderScheduler,
  validateRenderSchedulerSnapshot,
};
