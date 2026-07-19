import { filterFogVisibleTokens } from '../components/grigliata/fogVisibilityFiltering';
import { rasterizeFogPolygonsToTiles } from '../components/grigliata/fogRasterMemory';
import { recordPerfEvent } from './runtime';

const WARMUP_ITERATIONS = 5;
const MEASURED_ITERATIONS = 30;

const percentile = (values, quantile) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
};

const runTimed = (name, operation, dimensions) => {
  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) operation();
  const heapBefore = performance.memory?.usedJSHeapSize ?? null;
  const durations = [];
  let outputCount = 0;
  for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
    const start = performance.now();
    const output = operation();
    durations.push(performance.now() - start);
    outputCount = Array.isArray(output) ? output.length : 0;
  }
  const heapAfter = performance.memory?.usedJSHeapSize ?? null;
  const result = {
    name,
    warmups: WARMUP_ITERATIONS,
    iterations: MEASURED_ITERATIONS,
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    allocationDeltaBytes: heapBefore === null || heapAfter === null ? null : Math.max(0, heapAfter - heapBefore),
    outputCount,
    dimensions,
  };
  recordPerfEvent({ category: 'microbenchmark', metric: `${name}.median`, value: result.medianMs, unit: 'ms', tags: dimensions });
  recordPerfEvent({ category: 'microbenchmark', metric: `${name}.p95`, value: result.p95Ms, unit: 'ms', tags: dimensions });
  if (result.allocationDeltaBytes !== null) {
    recordPerfEvent({ category: 'microbenchmark', metric: `${name}.allocations`, value: result.allocationDeltaBytes, unit: 'bytes', tags: dimensions });
  }
  return result;
};

const visibilityFixture = () => {
  const grid = { cellSizePx: 50, offsetXPx: 0, offsetYPx: 0 };
  const tokens = Array.from({ length: 200 }, (_, index) => ({
    id: `token-${index}`,
    tokenId: `token-${index}`,
    ownerUid: index === 0 ? 'perf-player' : `perf-user-${index}`,
    col: index % 20,
    row: Math.floor(index / 20),
    sizeSquares: 1,
  }));
  const fogOfWar = {
    currentVisiblePolygons: [[[
      { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 },
    ]]],
    currentCells: [],
  };
  return { grid, tokens, fogOfWar };
};

const fogFixture = () => ({
  backgroundId: 'perf-map',
  ownerUid: 'perf-player',
  grid: { cellSizePx: 50, offsetXPx: 0, offsetYPx: 0 },
  polygons: [[[
    { x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 1600 }, { x: 0, y: 1600 },
  ]]],
});

export const runGrigliataMicrobenchmarks = () => {
  const visibility = visibilityFixture();
  const fog = fogFixture();
  return {
    visibility: runTimed(
      'visibility',
      () => filterFogVisibleTokens({ ...visibility, currentUserId: 'perf-player', isManager: false }),
      { tokenCount: visibility.tokens.length, polygonCount: 1 }
    ),
    fog: runTimed(
      'fog-raster',
      () => rasterizeFogPolygonsToTiles(fog),
      { mapCellsWide: 32, mapCellsHigh: 32, expectedTileCount: 16 }
    ),
  };
};

export const installGrigliataBenchmarkBridge = () => {
  const bridge = { runAll: runGrigliataMicrobenchmarks };
  window.__FND_PERF_BENCHMARKS__ = bridge;
  return () => {
    if (window.__FND_PERF_BENCHMARKS__ === bridge) delete window.__FND_PERF_BENCHMARKS__;
  };
};
