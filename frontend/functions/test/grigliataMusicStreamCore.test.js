const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");

const {
  buildTask07MusicProjection,
  nextTask07MusicStreamWrite,
  task07MusicProjectionTrackIds,
  TASK07_MUSIC_STREAM_DEFAULT_VOLUME,
  TASK07_MUSIC_STREAM_MAX_SESSIONS,
  TASK07_MUSIC_STREAM_QUERY_LIMIT,
  TASK07_MUSIC_STREAM_SCHEMA_VERSION,
} = require("../lib/grigliataMusicStreamCore");

const assetIdFor = (id) => `m_${createHash("sha256")
  .update(id).digest("hex").slice(0, 40)}`;

const makeTrack = (id, overrides = {}) => {
  const assetId = assetIdFor(id);
  const ownerUid = "music-owner";
  const durationMs = overrides.durationMs ?? 120000;
  const media = {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: "music",
    state: "ready",
    generation: "7",
    audience: "signed-in",
    ownerUid,
    original: {
      path: `media_assets/v1/signed-in/${ownerUid}/${assetId}/7/original`,
      contentType: "audio/mpeg",
      bytes: 4096,
      durationMs,
      width: 0,
      height: 0,
      generation: "9",
    },
  };
  return {
    id,
    data: {
      name: `Canonical ${id}`,
      durationMs,
      media,
      ...overrides,
      ...(overrides.media ? {media: overrides.media} : {}),
    },
  };
};

const makeSession = (id, overrides = {}) => ({
  id,
  data: {
    status: "playing",
    trackId: id,
    trackName: `Legacy ${id}`,
    audioUrl: `https://legacy.example/audio/${id}.mp3`,
    mediaAssetId: assetIdFor(id),
    durationMs: 120000,
    offsetMs: 2000,
    loop: false,
    startedAtMs: 9000,
    updatedAt: {toMillis: () => 10000},
    ...overrides,
  },
});

const buildProjection = ({playback, sessions, tracks}) => {
  const exactIds = task07MusicProjectionTrackIds({playback, sessions});
  return buildTask07MusicProjection({
    controlMode: "canonical-only",
    playback,
    sessions,
    tracks: tracks ?? exactIds.map((id) => makeTrack(id)),
  });
};

test("projects only bounded canonical descriptors without legacy URLs", () => {
  const later = makeSession("track-b", {
    status: "paused",
    startedAtMs: 0,
    updatedAt: {toMillis: () => 20000},
  });
  const earlier = makeSession("track-a");
  const first = buildProjection({
    playback: {volume: 0.4},
    sessions: [earlier, later],
  });
  const reordered = buildProjection({
    playback: {volume: 0.4},
    sessions: [later, earlier],
  });

  assert.equal(first.diagnosticCode, null);
  assert.equal(first.projection.schemaVersion, 2);
  assert.equal(first.projection.controlMode, "canonical-only");
  assert.deepEqual(first.projection.sessions.map(({id}) => id), [
    "track-b",
    "track-a",
  ]);
  assert.equal(first.projection.sourceHash, reordered.projection.sourceHash);
  assert.match(first.projection.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal("audioUrl" in first.projection.sessions[0], false);
  assert.equal(first.projection.sessions[0].trackName, "Canonical track-b");
  assert.equal(first.projection.sessions[0].mediaAssetId, assetIdFor("track-b"));
  assert.equal(
    first.projection.sessions[0].media.original.path,
    `media_assets/v1/signed-in/music-owner/${assetIdFor("track-b")}/7/original`
  );
});

test("derives at most four exact track document IDs", () => {
  assert.deepEqual(task07MusicProjectionTrackIds({
    playback: null,
    sessions: [makeSession("b"), makeSession("a")],
  }), ["a", "b"]);
  assert.deepEqual(task07MusicProjectionTrackIds({
    playback: {status: "playing", trackId: "fallback"},
    sessions: [],
  }), ["fallback"]);
  assert.deepEqual(task07MusicProjectionTrackIds({
    playback: null,
    sessions: Array.from(
      {length: TASK07_MUSIC_STREAM_QUERY_LIMIT + 1},
      (_, index) => makeSession(`track-${index}`)
    ),
  }), []);
});

test("uses canonical track data for the legacy singleton fallback", () => {
  const playback = {
    status: "playing",
    trackId: "legacy-track",
    trackName: "Legacy track",
    audioUrl: "https://legacy.example/audio/legacy.mp3",
    durationMs: 120000,
    offsetMs: 3000,
    volume: 0.5,
    startedAt: {toMillis: () => 8000},
    updatedAt: {toMillis: () => 9000},
  };
  const result = buildProjection({playback, sessions: []});
  assert.equal(result.diagnosticCode, null);
  assert.equal(result.projection.sessions[0].trackName, "Canonical legacy-track");
  assert.equal(result.projection.sessions[0].mediaAssetId, assetIdFor("legacy-track"));
  assert.equal("audioUrl" in result.projection.sessions[0], false);
});

test("fails closed on malformed sessions and over-cap source state", () => {
  const malformedCases = [
    makeSession("mismatch", {trackId: "other"}),
    makeSession("asset", {mediaAssetId: "legacy-id"}),
    makeSession("duration", {durationMs: 3600001}),
    makeSession("paused", {status: "paused", startedAtMs: 1}),
  ];
  malformedCases.forEach((session) => {
    const result = buildProjection({
      playback: {volume: 0.65},
      sessions: [session],
    });
    assert.equal(result.diagnosticCode, "invalid-session");
    assert.deepEqual(result.projection.sessions, []);
  });

  const overCap = buildProjection({
    playback: {volume: 0.65},
    sessions: Array.from(
      {length: TASK07_MUSIC_STREAM_QUERY_LIMIT},
      (_, index) => makeSession(`track-${index}`)
    ),
    tracks: [],
  });
  assert.equal(TASK07_MUSIC_STREAM_QUERY_LIMIT,
    TASK07_MUSIC_STREAM_MAX_SESSIONS + 1);
  assert.equal(overCap.diagnosticCode, "over-cap");
});

test("fails closed on missing, malformed, and mismatched tracks", () => {
  const session = makeSession("track");
  assert.equal(buildProjection({
    playback: {volume: 0.65},
    sessions: [session],
    tracks: [],
  }).diagnosticCode, "missing-track");

  const malformed = makeTrack("track");
  malformed.data.media = {
    ...malformed.data.media,
    original: {
      ...malformed.data.media.original,
      path: "grigliata/music/legacy.mp3",
    },
  };
  assert.equal(buildProjection({
    playback: {volume: 0.65},
    sessions: [session],
    tracks: [malformed],
  }).diagnosticCode, "invalid-track");

  assert.equal(buildProjection({
    playback: {volume: 0.65},
    sessions: [makeSession("track", {mediaAssetId: assetIdFor("other")})],
    tracks: [makeTrack("track")],
  }).diagnosticCode, "session-track-mismatch");
});

test("rejects invalid volume and replaces stale v1 projections", () => {
  const invalid = buildProjection({
    playback: {volume: "0.5"},
    sessions: [makeSession("active")],
  });
  assert.equal(invalid.diagnosticCode, "invalid-volume");
  assert.equal(invalid.projection.volume, TASK07_MUSIC_STREAM_DEFAULT_VOLUME);

  const projection = buildProjection({
    playback: {volume: 0.65},
    sessions: [makeSession("active")],
  }).projection;
  const first = nextTask07MusicStreamWrite(null, projection);
  assert.equal(first.revision, 1);
  assert.equal(TASK07_MUSIC_STREAM_SCHEMA_VERSION, 2);
  assert.equal(nextTask07MusicStreamWrite(first, projection), null);
  assert.equal(nextTask07MusicStreamWrite({
    ...first,
    schemaVersion: 1,
  }, projection).revision, 2);

  const changedMode = buildTask07MusicProjection({
    controlMode: "v1-write",
    playback: {volume: 0.65},
    sessions: [makeSession("active")],
    tracks: [makeTrack("active")],
  }).projection;
  assert.notEqual(changedMode.sourceHash, projection.sourceHash);
  assert.equal(nextTask07MusicStreamWrite(first, changedMode).revision, 2);
});
