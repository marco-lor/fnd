import {
  DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
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

  test('limits players to their own visible main token vision source', () => {
    const sources = resolveViewerTokenVisionSources({
      currentUserId: 'user-1',
      isManager: false,
      cellSizePx: 70,
      tokens: [
        { tokenId: 'user-1', ownerUid: 'user-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'custom-1', ownerUid: 'user-1', placed: true, isVisibleToPlayers: true },
        { tokenId: 'user-2', ownerUid: 'user-2', placed: true, isVisibleToPlayers: true },
        { tokenId: 'user-3', ownerUid: 'user-3', placed: true, isVisibleToPlayers: false },
      ],
    });

    expect(sources.map((source) => source.tokenId)).toEqual(['user-1']);
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
});
