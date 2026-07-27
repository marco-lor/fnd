const TASK07_SOAK_DEFAULT_CYCLES = 3;
const TASK07_SOAK_MINIMUM_CYCLES = 3;
const TASK07_SOAK_MAXIMUM_CYCLES = 5;
const TASK07_SOAK_DEFAULT_DURATION_MS = 10 * 60 * 1000;
const TASK07_SOAK_MINIMUM_DURATION_MS = 10 * 60 * 1000;
const TASK07_SOAK_MAXIMUM_DURATION_MS = 60 * 60 * 1000;
const TASK07_SOAK_SMOKE_DEFAULT_DURATION_MS = 60 * 1000;
const TASK07_SOAK_SMOKE_MINIMUM_DURATION_MS = 30 * 1000;
const TASK07_SOAK_SMOKE_MAXIMUM_DURATION_MS = 5 * 60 * 1000;
const TASK07_SOAK_TIMEOUT_BUFFER_MS = 5 * 60 * 1000;
const TASK07_SOAK_BACKGROUND_COUNT = 50;
const TASK07_SOAK_TOKEN_COUNT = 200;
const TASK07_SOAK_MAX_UPWARD_TREND = 0.05;
const MEBIBYTE = 1024 * 1024;
const TASK07_SOAK_DESKTOP_LIMITS = Object.freeze({
  maxConcurrentRequests: 4,
  maxDecodedBytes: 128 * MEBIBYTE,
  maxLowPriorityQueueSize: 32,
  maxRecords: 96,
  maxTotalDecodedBytes: 384 * MEBIBYTE,
});

const resolveTask07SoakCycles = (value) => {
  if (value === undefined || value === null || value === '') {
    return TASK07_SOAK_DEFAULT_CYCLES;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < TASK07_SOAK_MINIMUM_CYCLES
    || parsed > TASK07_SOAK_MAXIMUM_CYCLES
  ) {
    throw new Error(
      `FND_TASK07_SOAK_CYCLES must be an integer from ${TASK07_SOAK_MINIMUM_CYCLES}`
      + ` to ${TASK07_SOAK_MAXIMUM_CYCLES}.`
    );
  }
  return parsed;
};

const resolveTask07SoakSmokeMode = (value) => {
  if (value === undefined || value === null || value === '' || value === '0') {
    return false;
  }
  if (value === '1') return true;
  throw new Error('FND_TASK07_SOAK_SMOKE must be 1 when enabling the bounded smoke override.');
};

const resolveTask07SoakDuration = (value, { smoke = false } = {}) => {
  const minimum = smoke
    ? TASK07_SOAK_SMOKE_MINIMUM_DURATION_MS
    : TASK07_SOAK_MINIMUM_DURATION_MS;
  const maximum = smoke
    ? TASK07_SOAK_SMOKE_MAXIMUM_DURATION_MS
    : TASK07_SOAK_MAXIMUM_DURATION_MS;
  const fallback = smoke
    ? TASK07_SOAK_SMOKE_DEFAULT_DURATION_MS
    : TASK07_SOAK_DEFAULT_DURATION_MS;
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `FND_TASK07_SOAK_DURATION_MS must be an integer from ${minimum} to ${maximum}`
      + `${smoke ? ' while FND_TASK07_SOAK_SMOKE=1' : ''}.`
    );
  }
  return parsed;
};

const resolveTask07SoakRuntime = (env = process.env) => {
  const smoke = resolveTask07SoakSmokeMode(env?.FND_TASK07_SOAK_SMOKE);
  const minimumCycles = resolveTask07SoakCycles(env?.FND_TASK07_SOAK_CYCLES);
  const durationMs = resolveTask07SoakDuration(env?.FND_TASK07_SOAK_DURATION_MS, { smoke });
  return {
    durationMs,
    minimumCycles,
    smoke,
    timeoutMs: durationMs + TASK07_SOAK_TIMEOUT_BUFFER_MS,
  };
};

const finiteNonNegative = (value) => (
  Number.isFinite(Number(value)) && Number(value) >= 0
);

const upwardTrend = (first, last) => {
  if (first === 0) return last === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (last - first) / first;
};

const evaluateTask07RegistryPlateau = (samples, {
  maximumUpwardTrend = TASK07_SOAK_MAX_UPWARD_TREND,
} = {}) => {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error('Task 07 registry plateau requires at least three settled cycles.');
  }
  if (!Number.isFinite(maximumUpwardTrend) || maximumUpwardTrend < 0) {
    throw new Error('Task 07 registry plateau trend must be a non-negative finite ratio.');
  }

  const finalThree = samples.slice(-3);
  const failures = [];
  const trends = {};
  const metricContracts = [
    ['unpinnedRecordCount', 'maxRecords'],
    ['unpinnedDecodedBytes', 'maxDecodedBytes'],
    ['decodedBytes', 'maxTotalDecodedBytes'],
  ];

  finalThree.forEach((sample, finalCycleIndex) => {
    const cycle = samples.length - 2 + finalCycleIndex;
    const registry = sample?.registry || {};
    const limits = registry.limits || {};
    if (limits.profile !== 'desktop') {
      failures.push(`cycle ${cycle}: registry profile is ${limits.profile ?? 'missing'}, expected desktop`);
    }
    for (const [limitName, expected] of Object.entries(TASK07_SOAK_DESKTOP_LIMITS)) {
      if (Number(limits[limitName]) !== expected) {
        failures.push(
          `cycle ${cycle}: ${limitName} is ${limits[limitName] ?? 'missing'}, expected ${expected}`
        );
      }
    }
    if (sample?.backgroundsVisited !== TASK07_SOAK_BACKGROUND_COUNT) {
      failures.push(
        `cycle ${cycle}: visited ${sample?.backgroundsVisited ?? 'missing'}/`
        + `${TASK07_SOAK_BACKGROUND_COUNT} backgrounds`
      );
    }
    if (Number(sample?.tokenNodeCount) < TASK07_SOAK_TOKEN_COUNT) {
      failures.push(
        `cycle ${cycle}: rendered ${sample?.tokenNodeCount ?? 'missing'}/`
        + `${TASK07_SOAK_TOKEN_COUNT} token nodes`
      );
    }
    for (const [metric, limitName] of metricContracts) {
      const value = Number(registry[metric]);
      const limit = TASK07_SOAK_DESKTOP_LIMITS[limitName];
      if (!finiteNonNegative(value)) {
        failures.push(`cycle ${cycle}: ${metric} is missing or invalid`);
      } else if (value > limit) {
        failures.push(`cycle ${cycle}: ${metric} ${value} exceeds ${limitName} ${limit}`);
      }
    }
    for (const metric of [
      'activeRequestCount',
      'queuedRequestCount',
      'referencedRecordCount',
      'pinnedRecordCount',
    ]) {
      if (Number(registry[metric]) !== 0) {
        failures.push(`cycle ${cycle}: settled ${metric} is ${registry[metric] ?? 'missing'}, expected 0`);
      }
    }
  });

  for (const [metric] of metricContracts) {
    const first = Number(finalThree[0]?.registry?.[metric]);
    const last = Number(finalThree[2]?.registry?.[metric]);
    const ratio = finiteNonNegative(first) && finiteNonNegative(last)
      ? upwardTrend(first, last)
      : Number.POSITIVE_INFINITY;
    trends[metric] = ratio;
    if (ratio > maximumUpwardTrend) {
      failures.push(
        `${metric} rose by ${Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : 'an unbounded amount'}`
        + ` across the final three cycles (limit ${(maximumUpwardTrend * 100).toFixed(2)}%)`
      );
    }
  }

  return {
    status: failures.length ? 'fail' : 'pass',
    finalThree,
    trends,
    failures,
  };
};

module.exports = {
  TASK07_SOAK_BACKGROUND_COUNT,
  TASK07_SOAK_DEFAULT_CYCLES,
  TASK07_SOAK_DEFAULT_DURATION_MS,
  TASK07_SOAK_DESKTOP_LIMITS,
  TASK07_SOAK_MAXIMUM_CYCLES,
  TASK07_SOAK_MAXIMUM_DURATION_MS,
  TASK07_SOAK_MAX_UPWARD_TREND,
  TASK07_SOAK_MINIMUM_CYCLES,
  TASK07_SOAK_MINIMUM_DURATION_MS,
  TASK07_SOAK_SMOKE_DEFAULT_DURATION_MS,
  TASK07_SOAK_SMOKE_MAXIMUM_DURATION_MS,
  TASK07_SOAK_SMOKE_MINIMUM_DURATION_MS,
  TASK07_SOAK_TIMEOUT_BUFFER_MS,
  TASK07_SOAK_TOKEN_COUNT,
  evaluateTask07RegistryPlateau,
  resolveTask07SoakCycles,
  resolveTask07SoakDuration,
  resolveTask07SoakRuntime,
  resolveTask07SoakSmokeMode,
};
