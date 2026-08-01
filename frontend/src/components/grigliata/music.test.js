import {
  buildGrigliataMusicPlaybackSession,
  buildGrigliataMusicPlaybackState,
  GRIGLIATA_MUSIC_PLAYBACK_STATUSES,
  normalizeGrigliataMusicMedia,
  normalizeGrigliataMusicTrack,
} from './music';

const ASSET_ID = `m_${'a'.repeat(40)}`;
const OWNER_UID = 'music-owner';

const CANONICAL_MEDIA = Object.freeze({
  schemaVersion: 1,
  contractVersion: 1,
  assetId: ASSET_ID,
  kind: 'music',
  state: 'ready',
  generation: '3',
  audience: 'signed-in',
  ownerUid: OWNER_UID,
  original: {
    path: `media_assets/v1/signed-in/${OWNER_UID}/${ASSET_ID}/3/original`,
    generation: '3',
    bytes: 1234,
    contentType: 'audio/mpeg',
    width: null,
    height: null,
  },
});

const TRACK = Object.freeze({
  id: 'track-1',
  name: 'Test track',
  fileName: 'test.mp3',
  audioUrl: 'https://legacy.invalid/test.mp3',
  audioPath: 'grigliata/music/test.mp3',
  contentType: 'audio/mpeg',
  sizeBytes: 1234,
  durationMs: 9000,
  media: CANONICAL_MEDIA,
});

test('normalizes a canonical music binding and exposes its asset id on the track', () => {
  expect(normalizeGrigliataMusicMedia(CANONICAL_MEDIA)).toEqual(CANONICAL_MEDIA);
  expect(normalizeGrigliataMusicTrack(TRACK)).toEqual(expect.objectContaining({
    media: CANONICAL_MEDIA,
    mediaAssetId: ASSET_ID,
  }));
});

test('canonical-only playback writes the asset id without the legacy URL', () => {
  expect(buildGrigliataMusicPlaybackSession({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING,
    track: TRACK,
    canonicalOnly: true,
    commandId: 'session-command',
  })).toEqual(expect.objectContaining({
    trackId: TRACK.id,
    audioUrl: '',
    mediaAssetId: ASSET_ID,
  }));

  expect(buildGrigliataMusicPlaybackState({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED,
    track: TRACK,
    canonicalOnly: true,
    commandId: 'state-command',
  })).toEqual(expect.objectContaining({
    trackId: TRACK.id,
    audioUrl: '',
    mediaAssetId: ASSET_ID,
  }));
});

test('canonical-only active playback fails closed when the track has no canonical binding', () => {
  const legacyTrack = {...TRACK, media: null};
  expect(() => buildGrigliataMusicPlaybackSession({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING,
    track: legacyTrack,
    canonicalOnly: true,
  })).toThrow('Canonical music media is required for playback.');
  expect(() => buildGrigliataMusicPlaybackState({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED,
    track: legacyTrack,
    canonicalOnly: true,
  })).toThrow('Canonical music media is required for playback.');
});

test('legacy rollback retains the URL while carrying an available asset id', () => {
  expect(buildGrigliataMusicPlaybackSession({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING,
    track: TRACK,
    canonicalOnly: false,
  })).toEqual(expect.objectContaining({
    audioUrl: TRACK.audioUrl,
    mediaAssetId: ASSET_ID,
  }));
});

test('stopped playback uses the empty canonical and legacy source fields', () => {
  expect(buildGrigliataMusicPlaybackSession({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED,
    track: TRACK,
    canonicalOnly: true,
  })).toEqual(expect.objectContaining({
    audioUrl: '',
    mediaAssetId: '',
  }));
  expect(buildGrigliataMusicPlaybackState({
    status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED,
    track: TRACK,
    canonicalOnly: true,
  })).toEqual(expect.objectContaining({
    audioUrl: '',
    mediaAssetId: '',
  }));
});
