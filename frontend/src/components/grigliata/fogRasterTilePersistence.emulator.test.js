/**
 * @jest-environment ./src/components/grigliata/fogEmulatorTestEnvironment.js
 */
// Two-client fog memory persistence against a LOCAL Firestore emulator and
// the repository's firestore.rules, using the real persistence functions.
//
// Run with: node scripts/grigliata/run-fog-emulator-tests.js
// (starts a demo-project Firestore emulator via `firebase emulators:exec`).
// Under a plain `react-scripts test` run this suite is skipped. When enabled
// it refuses any non-local emulator host or non-demo project, so it can never
// reach live Firebase.
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  setDoc,
} from '../../performance/firestore';
import {
  buildFogRasterDiscoveryDeltaMask,
  persistFogBrushQueueEntry,
  persistFogRasterDiscoveryTiles,
} from './fogRasterTilePersistence';
import {
  buildFogRasterTilePayload,
  countFogRasterMaskBits,
  GRIGLIATA_FOG_MEMORY_TILES_COLLECTION,
  maskContainsFogRasterBits,
  mergeFogRasterTileMasks,
  normalizeFogRasterMemoryTileDoc,
  rasterizeFogPolygonsToTiles,
} from './fogRasterMemory';

const EMULATOR_TEST_FLAG = 'FND_FOG_EMULATOR_TEST';
const LOCAL_EMULATOR_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const resolveEmulatorTarget = () => {
  if (process.env[EMULATOR_TEST_FLAG] !== '1') {
    return null;
  }

  const hostSetting = String(process.env.FIRESTORE_EMULATOR_HOST || '');
  const separatorIndex = hostSetting.lastIndexOf(':');
  const host = separatorIndex > 0 ? hostSetting.slice(0, separatorIndex) : '';
  const port = Number(hostSetting.slice(separatorIndex + 1));
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.FND_PERF_PROJECT_ID || '');
  if (!LOCAL_EMULATOR_HOSTS.has(host) || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      `${EMULATOR_TEST_FLAG}=1 requires FIRESTORE_EMULATOR_HOST on a local host; got "${hostSetting}".`
    );
  }
  if (!projectId.startsWith('demo-')) {
    throw new Error(`${EMULATOR_TEST_FLAG}=1 refuses non-demo Firebase project "${projectId}".`);
  }
  return { host: host.replace(/^\[|\]$/g, ''), port, projectId };
};

const emulatorTarget = resolveEmulatorTarget();
const describeWithEmulator = emulatorTarget ? describe : describe.skip;

const runId = randomUUID();
const DM = `fog-emulator-dm-${runId}`;
const PLAYER = `fog-emulator-player-${runId}`;
const OTHER_PLAYER = `fog-emulator-other-player-${runId}`;
const fixturePaths = new Set();
const GRID = { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 };

const cellPolygon = (col, row, grid = GRID) => [[
  { x: grid.offsetXPx + (col * grid.cellSizePx), y: grid.offsetYPx + (row * grid.cellSizePx) },
  { x: grid.offsetXPx + ((col + 1) * grid.cellSizePx), y: grid.offsetYPx + (row * grid.cellSizePx) },
  { x: grid.offsetXPx + ((col + 1) * grid.cellSizePx), y: grid.offsetYPx + ((row + 1) * grid.cellSizePx) },
  { x: grid.offsetXPx + (col * grid.cellSizePx), y: grid.offsetYPx + ((row + 1) * grid.cellSizePx) },
]];

// Every scenario works inside raster tile 0:0 (cells 0..7) of its own map.
const rasterTile = ({ backgroundId, cells, ownerUid = PLAYER, grid = GRID }) => {
  const tiles = rasterizeFogPolygonsToTiles({
    backgroundId,
    ownerUid,
    grid,
    polygons: cells.map(([col, row]) => cellPolygon(col, row, grid)),
  });
  expect(tiles).toHaveLength(1);
  fixturePaths.add(`${GRIGLIATA_FOG_MEMORY_TILES_COLLECTION}/${tiles[0].id}`);
  return tiles[0];
};
const withMask = (tile, maskBytes) => ({ ...tile, maskBytes });
const sameMask = (left, right) => Buffer.from(left).equals(Buffer.from(right));

// Lets the test hold a transaction between its reads and its commit. Only the
// first attempt waits; SDK retries after a conflict pass straight through.
const createCommitGate = () => {
  let release;
  let markArrived;
  const released = new Promise((resolve) => { release = resolve; });
  const arrived = new Promise((resolve) => { markArrived = resolve; });
  let attempts = 0;
  return {
    arrived,
    release: () => release(),
    attempts: () => attempts,
    runTransaction: (db, updateFunction) => runTransaction(db, async (transaction) => {
      attempts += 1;
      const attempt = attempts;
      const result = await updateFunction(transaction);
      if (attempt === 1) {
        markArrived();
        await released;
      }
      return result;
    }),
  };
};

describeWithEmulator('fog memory persistence on the local Firestore emulator (two clients)', () => {
  let environment;
  let backgroundSequence = 0;
  jest.setTimeout(60000);

  const nextBackgroundId = (label) => {
    backgroundSequence += 1;
    return `fog-emulator-${label}-${runId}-${backgroundSequence}`;
  };
  const playerClient = () => environment.authenticatedContext(PLAYER).firestore();
  const managerClient = () => environment.authenticatedContext(DM).firestore();
  const seedAsAdmin = (documentPath, data) => {
    fixturePaths.add(documentPath);
    return environment.withSecurityRulesDisabled(
      (context) => setDoc(doc(context.firestore(), documentPath), data)
    );
  };
  // Clean re-read: a brand-new client, read straight from the emulator server.
  const rereadTile = async (tileId) => {
    let stored = null;
    await environment.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDocFromServer(
        doc(context.firestore(), GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, tileId)
      );
      stored = snapshot.exists()
        ? normalizeFogRasterMemoryTileDoc({ id: snapshot.id, ...snapshot.data() })
        : null;
    });
    return stored;
  };
  const rereadMask = async (tileId) => (await rereadTile(tileId))?.maskBytes || null;
  const seedBackground = (backgroundId, grid = GRID) => seedAsAdmin(`grigliata_backgrounds/${backgroundId}`, {
    name: backgroundId,
    grid,
  });
  const persistAsPlayer = (db, tiles, options = {}) => persistFogRasterDiscoveryTiles({
    db,
    tiles,
    updatedBy: PLAYER,
    ...options,
  });
  const hideAsManager = (db, { backgroundId, cells }, options = {}) => persistFogBrushQueueEntry({
    db,
    entry: {
      backgroundId,
      ownerUids: [PLAYER],
      mode: 'hide',
      ...GRID,
      updatedBy: DM,
      brushPolygons: cells.map(([col, row]) => cellPolygon(col, row)),
    },
    ...options,
  });
  // The pre-fix protocol: non-transactional read, merge, full-mask write.
  const legacyReadMergeWrite = async (db, tile, beforeWrite = async () => {}) => {
    const tileRef = doc(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, tile.id);
    const snapshot = await getDoc(tileRef);
    const existing = snapshot.exists()
      ? normalizeFogRasterMemoryTileDoc({ id: snapshot.id, ...snapshot.data() })
      : null;
    await beforeWrite();
    await setDoc(tileRef, buildFogRasterTilePayload({
      ...tile,
      grid: GRID,
      maskBytes: mergeFogRasterTileMasks(existing?.maskBytes, tile.maskBytes),
      updatedAt: serverTimestamp(),
      updatedBy: PLAYER,
    }), { merge: true });
  };

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: emulatorTarget.projectId,
      firestore: {
        host: emulatorTarget.host,
        port: emulatorTarget.port,
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      },
    });
    await seedAsAdmin(`users/${DM}`, { role: 'dm' });
    await seedAsAdmin(`users/${PLAYER}`, { role: 'player' });
    await seedAsAdmin(`users/${OTHER_PLAYER}`, { role: 'player' });
  });

  afterAll(async () => {
    if (!environment) return;
    try {
      await environment.withSecurityRulesDisabled((context) => {
        const db = context.firestore();
        return Promise.all([...fixturePaths].map((documentPath) => deleteDoc(doc(db, documentPath))));
      });
    } finally {
      await environment.cleanup();
    }
  });

  test('two same-owner clients discovering different bits from the same stale tile keep both', async () => {
    const backgroundId = nextBackgroundId('player-player');
    const base = rasterTile({ backgroundId, cells: [[1, 1]] });
    const first = rasterTile({ backgroundId, cells: [[3, 0]] });
    const second = rasterTile({ backgroundId, cells: [[5, 2]] });
    await persistAsPlayer(playerClient(), [base]);

    // Both clients know only `base`; each queues its own new bits.
    const firstGate = createCommitGate();
    const secondGate = createCommitGate();
    const firstWrite = persistAsPlayer(playerClient(), [
      withMask(first, buildFogRasterDiscoveryDeltaMask(first.maskBytes, base.maskBytes)),
    ], { runTransaction: firstGate.runTransaction });
    const secondWrite = persistAsPlayer(playerClient(), [
      withMask(second, buildFogRasterDiscoveryDeltaMask(second.maskBytes, base.maskBytes)),
    ], { runTransaction: secondGate.runTransaction });
    await Promise.all([firstGate.arrived, secondGate.arrived]);
    firstGate.release();
    secondGate.release();
    const [firstResults, secondResults] = await Promise.all([firstWrite, secondWrite]);

    expect(firstResults.map(({ status }) => status)).toEqual(['written']);
    expect(secondResults.map(({ status }) => status)).toEqual(['written']);
    // One commit lost the race and was re-read and re-merged by the SDK.
    expect(firstGate.attempts() + secondGate.attempts()).toBe(3);
    const stored = await rereadMask(base.id);
    expect(sameMask(stored, mergeFogRasterTileMasks(
      mergeFogRasterTileMasks(base.maskBytes, first.maskBytes),
      second.maskBytes
    ))).toBe(true);
  });

  test('control: the pre-fix read/merge/write protocol loses one of the two discoveries', async () => {
    const backgroundId = nextBackgroundId('legacy-player-player');
    const base = rasterTile({ backgroundId, cells: [[1, 1]] });
    const first = rasterTile({ backgroundId, cells: [[3, 0]] });
    const second = rasterTile({ backgroundId, cells: [[5, 2]] });
    await persistAsPlayer(playerClient(), [base]);

    let releaseWrites;
    const writesReleased = new Promise((resolve) => { releaseWrites = resolve; });
    let readCount = 0;
    let bothRead;
    const bothReadPromise = new Promise((resolve) => { bothRead = resolve; });
    const holdAfterRead = async () => {
      readCount += 1;
      if (readCount === 2) bothRead();
      await writesReleased;
    };
    const writes = [
      legacyReadMergeWrite(playerClient(), first, holdAfterRead),
      legacyReadMergeWrite(playerClient(), second, holdAfterRead),
    ];
    await bothReadPromise;
    releaseWrites();
    await Promise.all(writes);

    const stored = await rereadMask(base.id);
    expect(maskContainsFogRasterBits(stored, first.maskBytes)
      && maskContainsFogRasterBits(stored, second.maskBytes)).toBe(false);
  });

  test('manager hide commits first: a stale independent reveal cannot restore the hidden old bit', async () => {
    const backgroundId = nextBackgroundId('hide-then-reveal');
    const kept = rasterTile({ backgroundId, cells: [[1, 1]] });
    const hidden = rasterTile({ backgroundId, cells: [[0, 0]] });
    const fresh = rasterTile({ backgroundId, cells: [[3, 0]] });
    const known = mergeFogRasterTileMasks(kept.maskBytes, hidden.maskBytes);
    await persistAsPlayer(playerClient(), [withMask(kept, known)]);

    // The player still believes `hidden` is explored and now sees it plus a
    // new cell. Only the new bits are queued.
    const sight = mergeFogRasterTileMasks(hidden.maskBytes, fresh.maskBytes);
    const delta = buildFogRasterDiscoveryDeltaMask(sight, known);
    expect(sameMask(delta, fresh.maskBytes)).toBe(true);

    const playerGate = createCommitGate();
    const reveal = persistAsPlayer(playerClient(), [withMask(fresh, delta)], {
      runTransaction: playerGate.runTransaction,
    });
    await playerGate.arrived; // the player's transaction has read kept+hidden
    const hideResult = await hideAsManager(managerClient(), { backgroundId, cells: [[0, 0]] });
    expect(hideResult.failedOwnerUids).toEqual([]);
    expect(hideResult.didWrite).toBe(true);
    playerGate.release();
    const [revealResult] = await reveal;

    expect(revealResult.status).toBe('written');
    expect(playerGate.attempts()).toBe(2);
    const stored = await rereadMask(kept.id);
    expect(sameMask(stored, mergeFogRasterTileMasks(kept.maskBytes, fresh.maskBytes))).toBe(true);
    expect(countFogRasterMaskBits(mergeFogRasterTileMasks(stored, hidden.maskBytes)))
      .toBe(countFogRasterMaskBits(stored) + countFogRasterMaskBits(hidden.maskBytes));
  });

  test('control: the pre-fix full-mask write after a manager hide resurrects the hidden bit', async () => {
    const backgroundId = nextBackgroundId('legacy-hide-then-reveal');
    const kept = rasterTile({ backgroundId, cells: [[1, 1]] });
    const hidden = rasterTile({ backgroundId, cells: [[0, 0]] });
    const fresh = rasterTile({ backgroundId, cells: [[3, 0]] });
    await persistAsPlayer(playerClient(), [
      withMask(kept, mergeFogRasterTileMasks(kept.maskBytes, hidden.maskBytes)),
    ]);

    await legacyReadMergeWrite(
      playerClient(),
      withMask(fresh, fresh.maskBytes),
      () => hideAsManager(managerClient(), { backgroundId, cells: [[0, 0]] })
    );

    const stored = await rereadMask(kept.id);
    expect(maskContainsFogRasterBits(stored, hidden.maskBytes)).toBe(true);
  });

  test('player reveal commits first: the manager hide re-reads and still removes only the old bit', async () => {
    const backgroundId = nextBackgroundId('reveal-then-hide');
    const kept = rasterTile({ backgroundId, cells: [[1, 1]] });
    const hidden = rasterTile({ backgroundId, cells: [[0, 0]] });
    const fresh = rasterTile({ backgroundId, cells: [[3, 0]] });
    const known = mergeFogRasterTileMasks(kept.maskBytes, hidden.maskBytes);
    await persistAsPlayer(playerClient(), [withMask(kept, known)]);

    const managerGate = createCommitGate();
    const hide = hideAsManager(managerClient(), { backgroundId, cells: [[0, 0]] }, {
      runTransaction: managerGate.runTransaction,
    });
    await managerGate.arrived; // the manager's transaction has read kept+hidden
    const [revealResult] = await persistAsPlayer(playerClient(), [
      withMask(fresh, buildFogRasterDiscoveryDeltaMask(fresh.maskBytes, known)),
    ]);
    expect(revealResult.status).toBe('written');
    managerGate.release();
    const hideResult = await hide;

    expect(hideResult.failedOwnerUids).toEqual([]);
    expect(managerGate.attempts()).toBe(2);
    const stored = await rereadMask(kept.id);
    expect(sameMask(stored, mergeFogRasterTileMasks(kept.maskBytes, fresh.maskBytes))).toBe(true);
  });

  test('a hidden bit returns only through fresh discovery after the player re-reads memory', async () => {
    const backgroundId = nextBackgroundId('fresh-discovery');
    const kept = rasterTile({ backgroundId, cells: [[1, 1]] });
    const hidden = rasterTile({ backgroundId, cells: [[0, 0]] });
    await persistAsPlayer(playerClient(), [
      withMask(kept, mergeFogRasterTileMasks(kept.maskBytes, hidden.maskBytes)),
    ]);
    await hideAsManager(managerClient(), { backgroundId, cells: [[0, 0]] });

    // Reload: the player's known memory now comes from a clean re-read.
    const reloadedKnown = await rereadMask(kept.id);
    expect(maskContainsFogRasterBits(reloadedKnown, hidden.maskBytes)).toBe(false);
    const delta = buildFogRasterDiscoveryDeltaMask(hidden.maskBytes, reloadedKnown);
    const [result] = await persistAsPlayer(playerClient(), [withMask(hidden, delta)]);

    expect(result.status).toBe('written');
    expect(maskContainsFogRasterBits(await rereadMask(kept.id), hidden.maskBytes)).toBe(true);
  });

  test('a rules-denied tile fails alone without losing the rest of the batch', async () => {
    const backgroundId = nextBackgroundId('partial-failure');
    const own = rasterTile({ backgroundId, cells: [[2, 2]] });
    const foreign = rasterTile({ backgroundId, cells: [[2, 2]], ownerUid: OTHER_PLAYER });

    const results = await persistAsPlayer(playerClient(), [own, foreign]);

    expect(results.map(({ status }) => status)).toEqual(['written', 'failed']);
    expect(results[1].error.code).toBe('permission-denied');
    expect(sameMask(await rereadMask(own.id), own.maskBytes)).toBe(true);
    expect(await rereadTile(foreign.id)).toBeNull();
  });

  test('a delta queued on an outdated grid is discarded instead of overwriting the newer grid tile', async () => {
    const backgroundId = nextBackgroundId('stale-grid');
    const realignedGrid = { ...GRID, offsetXPx: 8 };
    await seedBackground(backgroundId, realignedGrid);
    const newer = rasterTile({ backgroundId, cells: [[0, 0], [1, 1], [2, 2]], grid: realignedGrid });
    await persistAsPlayer(playerClient(), [newer]);
    const staleDelta = rasterTile({ backgroundId, cells: [[4, 4]] });
    expect(staleDelta.id).toBe(newer.id);

    const [result] = await persistAsPlayer(playerClient(), [staleDelta]);

    expect(result.status).toBe('stale-grid');
    const stored = await rereadTile(newer.id);
    expect(stored.offsetXPx).toBe(8);
    expect(sameMask(stored.maskBytes, newer.maskBytes)).toBe(true);
  });

  test('a current-grid delta replaces a tile left from an earlier grid instead of merging', async () => {
    const backgroundId = nextBackgroundId('replace-old-grid');
    const oldGrid = { ...GRID, offsetXPx: 8 };
    await seedBackground(backgroundId, GRID);
    const oldGridTile = rasterTile({ backgroundId, cells: [[0, 0], [1, 1]], grid: oldGrid });
    await seedAsAdmin(`${GRIGLIATA_FOG_MEMORY_TILES_COLLECTION}/${oldGridTile.id}`, buildFogRasterTilePayload({
      ...oldGridTile,
      grid: oldGrid,
      updatedAt: serverTimestamp(),
      updatedBy: PLAYER,
    }));
    const current = rasterTile({ backgroundId, cells: [[4, 4]] });

    const [result] = await persistAsPlayer(playerClient(), [current]);

    expect(result.status).toBe('written');
    const stored = await rereadTile(current.id);
    expect(stored.offsetXPx).toBe(0);
    expect(sameMask(stored.maskBytes, current.maskBytes)).toBe(true);
  });
});
