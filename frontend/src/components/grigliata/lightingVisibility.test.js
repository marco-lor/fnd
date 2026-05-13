import {
  DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
  buildViewerTokenVisionEligibilityReport,
  normalizeTokenVisionSettings,
  resolveViewerTokenVisionSources,
} from './lightingVisibility';

describe('lightingVisibility', () => {
  test('defaults missing token vision settings to enabled twelve-square vision', () => {
    expect(normalizeTokenVisionSettings({ tokenId: 'user-1' })).toEqual({
      visionEnabled: true,
      visionRadiusSquares: DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    });
  });

  test('keeps explicit disabled and radius settings', () => {
    expect(normalizeTokenVisionSettings({
      tokenId: 'user-1',
      visionEnabled: false,
      visionRadiusSquares: 8,
    })).toEqual({
      visionEnabled: false,
      visionRadiusSquares: 8,
    });
  });

  test('falls back to twelve squares for invalid radius settings', () => {
    expect(normalizeTokenVisionSettings({
      tokenId: 'user-1',
      visionRadiusSquares: 'wide',
    })).toEqual({
      visionEnabled: true,
      visionRadiusSquares: DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    });
  });

  test('lets the DM preview all eligible non-dead token vision sources', () => {
    const sources = resolveViewerTokenVisionSources({
      currentUserId: 'dm-1',
      isManager: true,
      cellSizePx: 70,
      tokens: [
        { tokenId: 'user-1', ownerUid: 'user-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'user-2', ownerUid: 'user-2', placed: true, isVisibleToPlayers: false, visionRadiusSquares: 6 },
        { tokenId: 'user-3', ownerUid: 'user-3', placed: true, isDead: true },
        { tokenId: 'user-4', ownerUid: 'user-4', placed: true, visionEnabled: false },
      ],
    });

    expect(sources.map((source) => source.tokenId)).toEqual(['user-1', 'user-2']);
    expect(sources[0]).toEqual(expect.objectContaining({
      visionRadiusSquares: 12,
      visionRadiusPx: 840,
    }));
    expect(sources[1]).toEqual(expect.objectContaining({
      visionRadiusSquares: 6,
      visionRadiusPx: 420,
    }));
  });

  test('lets players use every eligible owned visible non-foe token as a vision source', () => {
    const sources = resolveViewerTokenVisionSources({
      currentUserId: 'user-1',
      isManager: false,
      cellSizePx: 70,
      tokens: [
        { tokenId: 'user-1', ownerUid: 'user-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'custom-1', ownerUid: 'user-1', tokenType: 'custom', placed: true, isVisibleToPlayers: true, visionRadiusSquares: 4 },
        { tokenId: 'user-2', ownerUid: 'user-2', placed: true, isVisibleToPlayers: true },
        { tokenId: 'foe-1', ownerUid: 'user-1', tokenType: 'foe', placed: true, isVisibleToPlayers: true },
        { tokenId: 'user-3', ownerUid: 'user-3', placed: true, isVisibleToPlayers: false },
      ],
    });

    expect(sources.map((source) => source.tokenId)).toEqual(['user-1', 'custom-1']);
    expect(sources[1]).toEqual(expect.objectContaining({
      visionRadiusSquares: 4,
      visionRadiusPx: 280,
    }));
  });

  test('excludes hidden and dead player tokens from player vision', () => {
    expect(resolveViewerTokenVisionSources({
      currentUserId: 'user-1',
      isManager: false,
      cellSizePx: 70,
      tokens: [
        { tokenId: 'user-1', ownerUid: 'user-1', placed: true, isVisibleToPlayers: false },
      ],
    })).toEqual([]);

    expect(resolveViewerTokenVisionSources({
      currentUserId: 'user-1',
      isManager: false,
      cellSizePx: 70,
      tokens: [
        { tokenId: 'user-1', ownerUid: 'user-1', placed: true, isVisibleToPlayers: true, isDead: true },
      ],
    })).toEqual([]);
  });

  test('reports contributing and skipped player vision source diagnostics', () => {
    const report = buildViewerTokenVisionEligibilityReport({
      currentUserId: 'user-1',
      isManager: false,
      cellSizePx: 70,
      backgroundId: 'map-1',
      tokens: [
        { tokenId: 'user-1', ownerUid: 'user-1', backgroundId: 'map-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'custom-1', ownerUid: 'user-1', backgroundId: 'map-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'map-2-token', ownerUid: 'user-1', backgroundId: 'map-2', placed: true, isVisibleToPlayers: true },
        { tokenId: 'hidden-1', ownerUid: 'user-1', backgroundId: 'map-1', placed: true, isVisibleToPlayers: false },
        { tokenId: 'dead-1', ownerUid: 'user-1', backgroundId: 'map-1', placed: true, isVisibleToPlayers: true, isDead: true },
        { tokenId: 'disabled-1', ownerUid: 'user-1', backgroundId: 'map-1', placed: true, isVisibleToPlayers: true, visionEnabled: false },
        { tokenId: 'foe-1', ownerUid: 'user-1', tokenType: 'foe', backgroundId: 'map-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'other-1', ownerUid: 'user-2', backgroundId: 'map-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'unplaced-1', ownerUid: 'user-1', backgroundId: 'map-1', placed: false, isVisibleToPlayers: true },
      ],
    });

    expect(report.sources.map((source) => source.tokenId)).toEqual(['user-1', 'custom-1']);
    expect(report.contributingTokenIds).toEqual(['user-1', 'custom-1']);
    expect(report.skippedTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ tokenId: 'map-2-token', reason: 'wrong-background' }),
      expect.objectContaining({ tokenId: 'hidden-1', reason: 'hidden' }),
      expect.objectContaining({ tokenId: 'dead-1', reason: 'dead' }),
      expect.objectContaining({ tokenId: 'disabled-1', reason: 'vision-disabled' }),
      expect.objectContaining({ tokenId: 'foe-1', reason: 'foe' }),
      expect.objectContaining({ tokenId: 'other-1', reason: 'not-owned' }),
      expect.objectContaining({ tokenId: 'unplaced-1', reason: 'unplaced' }),
    ]));
  });
});
