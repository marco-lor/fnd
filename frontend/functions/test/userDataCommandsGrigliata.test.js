const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeGrigliataTurnTransition,
  normalizeHiddenPlacementMutation,
} = require('../lib/userDataCommands');

const expectInvalidArgument = (value) => {
  assert.throws(
    () => normalizeHiddenPlacementMutation(value),
    (error) => error?.code === 'invalid-argument'
  );
};

test('hidden-placement mutations require the exact reviewed payload', () => {
  assert.deepEqual(normalizeHiddenPlacementMutation({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: true,
    includeLegacyFallback: false,
  }), {
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: true,
    includeLegacyFallback: false,
  });
  assert.equal(normalizeHiddenPlacementMutation(undefined), null);

  expectInvalidArgument({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: true,
  });
  expectInvalidArgument({
    backgroundId: 'maps/one',
    tokenId: 'token-1',
    isHidden: true,
    includeLegacyFallback: false,
  });
  expectInvalidArgument({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: 'yes',
    includeLegacyFallback: false,
  });
  expectInvalidArgument({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: true,
    includeLegacyFallback: false,
    unexpected: true,
  });
});

test('hidden-placement mutations validate atomic placement upserts and deletes', () => {
  const upsert = normalizeHiddenPlacementMutation({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: true,
    includeLegacyFallback: false,
    placementMutation: {
      action: 'upsert',
      deleteFoeTokenProfile: false,
      placement: {
        label: ' Hero ',
        imageUrl: ' https://example.test/hero.png ',
        col: 2,
        row: 3,
        sizeSquares: 2,
        isVisibleToPlayers: false,
        isDead: false,
        statuses: [' burning '],
        visionEnabled: true,
        visionRadiusSquares: 6,
      },
    },
  });
  assert.deepEqual(upsert, {
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: true,
    includeLegacyFallback: false,
    placementMutation: {
      action: 'upsert',
      deleteFoeTokenProfile: false,
      placement: {
        label: 'Hero',
        imageUrl: 'https://example.test/hero.png',
        col: 2,
        row: 3,
        sizeSquares: 2,
        isVisibleToPlayers: false,
        isDead: false,
        statuses: ['burning'],
        visionEnabled: true,
        visionRadiusSquares: 6,
      },
    },
  });
  assert.deepEqual(normalizeHiddenPlacementMutation({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: false,
    includeLegacyFallback: true,
    placementMutation: {
      action: 'delete',
      deleteFoeTokenProfile: true,
    },
  }), {
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: false,
    includeLegacyFallback: true,
    placementMutation: {
      action: 'delete',
      deleteFoeTokenProfile: true,
    },
  });

  expectInvalidArgument({
    ...upsert,
    placementMutation: {
      ...upsert.placementMutation,
      placement: {
        ...upsert.placementMutation.placement,
        updatedBy: 'dm-1',
      },
    },
  });
  expectInvalidArgument({
    backgroundId: 'map-1',
    tokenId: 'token-1',
    isHidden: false,
    includeLegacyFallback: false,
    placementMutation: {
      action: 'delete',
      deleteFoeTokenProfile: false,
      placement: upsert.placementMutation.placement,
    },
  });
});

test('Grigliata turn transitions require the exact stale-state preconditions', () => {
  assert.deepEqual(normalizeGrigliataTurnTransition({
    backgroundId: 'map-1',
    tokenId: 'player-1',
    expectedPreviousActiveTokenId: 'player-2',
    expectedTurnCounter: 3,
    preserveStartedAt: true,
  }), {
    backgroundId: 'map-1',
    tokenId: 'player-1',
    expectedPreviousActiveTokenId: 'player-2',
    expectedTurnCounter: 3,
    preserveStartedAt: true,
  });
  assert.equal(normalizeGrigliataTurnTransition(undefined), null);

  [
    {
      backgroundId: 'map-1',
      tokenId: 'player-1',
      expectedPreviousActiveTokenId: 'player-2',
      expectedTurnCounter: 0,
      preserveStartedAt: true,
    },
    {
      backgroundId: 'maps/one',
      tokenId: 'player-1',
      expectedPreviousActiveTokenId: '',
      expectedTurnCounter: 1,
      preserveStartedAt: false,
    },
    {
      backgroundId: 'map-1',
      tokenId: 'player-1',
      expectedPreviousActiveTokenId: '',
      expectedTurnCounter: 1,
      preserveStartedAt: false,
      unexpected: true,
    },
  ].forEach((value) => {
    assert.throws(
      () => normalizeGrigliataTurnTransition(value),
      (error) => error?.code === 'invalid-argument'
    );
  });
});

test('settings callable owns canonical and rollout-gated legacy array sentinels', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'userDataCommands.ts'),
    'utf8'
  ).replace(/\r\n?/g, '\n');
  const start = source.indexOf('export const task05UpdateSettings');
  const end = source.indexOf('export const task05UpdateProfileContent', start);
  const callable = source.slice(start, end);
  assert.ok(start >= 0 && end > start);

  assert.match(
    source,
    /users\/\$\{access\.targetUid\}\/state\/settings/
  );
  assert.match(source, /FieldValue\.arrayUnion\(hiddenPlacement\.tokenId\)/);
  assert.match(source, /FieldValue\.arrayRemove\(hiddenPlacement\.tokenId\)/);
  assert.match(
    source,
    /if \(context\.writeLegacy\) \{[\s\S]*?hiddenPlacementSettings/
  );
  assert.match(
    source,
    /access\.targetUid !== context\.actorUid[\s\S]*?access\.actorRole !== "dm"/
  );
  assert.match(callable, /runIdempotent\([\s\S]*?"update-settings"/);
  assert.match(
    callable,
    /context\.transaction\.getAll\([\s\S]*?backgroundRef[\s\S]*?placementRef[\s\S]*?tokenRef/
  );
  assert.match(
    callable,
    /mutation\.placement\.isVisibleToPlayers === hiddenPlacement\.isHidden/
  );
  assert.match(
    callable,
    /context\.transaction\.set\(settingsRef[\s\S]*?context\.transaction\.set\(placementState\.placementRef/
  );
  assert.match(
    callable,
    /context\.transaction\.delete\(placementState\.placementRef\)[\s\S]*?context\.transaction\.delete\(placementState\.tokenRef\)/
  );
});

test('turn consumption owns the reviewed board transition in one idempotent transaction', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'userDataCommands.ts'),
    'utf8'
  ).replace(/\r\n?/g, '\n');
  const start = source.indexOf('export const task05ConsumeTurnEffects');
  const end = source.indexOf('export const task05PurchaseItem', start);
  const callable = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(callable, /runIdempotent\([\s\S]*?"consume-turn-effects"/);
  assert.match(callable, /access\.actorRole !== "dm"/);
  assert.match(callable, /placementOwnerUid !== access\.targetUid/);
  assert.match(
    callable,
    /grigliataTransition\.tokenId !== access\.targetUid/
  );
  assert.match(callable, /token\.exists && \(/);
  assert.match(
    callable,
    /currentActiveTokenId !==[\s\S]*?expectedPreviousActiveTokenId/
  );
  assert.match(
    callable,
    /currentTurnCounter \+ 1 !== grigliataTransition\.expectedTurnCounter/
  );
  assert.match(
    callable,
    /const currentShieldEffect = currentShieldEffects\.length === 1 \?[\s\S]*?currentShieldEffects\[0\] : null/
  );
  assert.match(
    callable,
    /const activeTurnEffectsSource = context\.rolloutStage === "new-only" \?\s*canonicalActiveTurnEffects\s*:\s*canonicalActiveTurnEffects \?\? access\.targetSnapshot\.get\("active_turn_effect"\)/
  );
  assert.match(
    callable,
    /resourceShield\.totalTurns !== transitionState\.currentShieldEffect\.totalTurns \|\|[\s\S]*?resourceShield\.remainingTurns !== transitionState\.currentShieldEffect\.remainingTurns/
  );
  assert.match(
    callable,
    /const barrierExpired = transitionState \?\s*transitionState\.expiredShield\s*:\s*consumption\.barrierExpired/
  );
  assert.match(
    callable,
    /active_turn_effect: synchronizedEffects/
  );
  assert.match(
    callable,
    /context\.transaction\.set\(resourcesRef[\s\S]*?context\.transaction\.set\(transitionState\.backgroundRef[\s\S]*?context\.transaction\.set\(transitionState\.placementRef/
  );
});
