const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTask07MusicProjection,
  nextTask07MusicStreamWrite,
  TASK07_MUSIC_STREAM_DEFAULT_VOLUME,
  TASK07_MUSIC_STREAM_MAX_SESSIONS,
  TASK07_MUSIC_STREAM_QUERY_LIMIT,
} = require("../lib/grigliataMusicStreamCore");

const makeSession = (id, overrides = {}) => ({
  id,
  data: {
    status: "playing",
    trackId: id,
    trackName: `Track ${id}`,
    audioUrl: `https://example.test/audio/${id}.mp3`,
    durationMs: 120000,
    offsetMs: 2000,
    loop: false,
    startedAtMs: 9000,
    updatedAt: {toMillis: () => 10000},
    commandId: "private-command",
    updatedBy: "private-actor",
    ...overrides,
  },
});

test("builds a deterministic bounded projection without control metadata", () => {
  const later = makeSession("track-b", {
    status: "paused",
    startedAtMs: 0,
    updatedAt: {toMillis: () => 20000},
  });
  const earlier = makeSession("track-a");
  const first = buildTask07MusicProjection({
    playback: {volume: 0.4, updatedBy: "private-actor"},
    sessions: [earlier, later],
  });
  const reordered = buildTask07MusicProjection({
    playback: {volume: 0.4},
    sessions: [later, earlier],
  });

  assert.equal(first.diagnosticCode, null);
  assert.equal(first.projection.volume, 0.4);
  assert.deepEqual(
    first.projection.sessions.map(({id}) => id),
    ["track-b", "track-a"]
  );
  assert.equal(first.projection.sourceHash, reordered.projection.sourceHash);
  assert.match(first.projection.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal("commandId" in first.projection.sessions[0], false);
  assert.equal("updatedBy" in first.projection.sessions[0], false);
});

test("ignores stopped history and defaults volume only when state is absent", () => {
  const result = buildTask07MusicProjection({
    playback: null,
    sessions: [
      makeSession("stopped", {status: "stopped"}),
      makeSession("active"),
    ],
  });
  assert.equal(result.diagnosticCode, null);
  assert.equal(result.projection.volume, TASK07_MUSIC_STREAM_DEFAULT_VOLUME);
  assert.deepEqual(
    result.projection.sessions.map(({id}) => id),
    ["active"]
  );
});

test("uses active sessions before the legacy playback-state fallback", () => {
  const playback = {
    status: "playing",
    trackId: "legacy-track",
    trackName: "Legacy track",
    audioUrl: "https://example.test/audio/legacy.mp3",
    durationMs: 60000,
    offsetMs: 3000,
    volume: 0.5,
    startedAt: {toMillis: () => 8000},
    updatedAt: {toMillis: () => 9000},
  };
  const fallback = buildTask07MusicProjection({
    playback,
    sessions: [],
  });
  assert.equal(fallback.diagnosticCode, null);
  assert.deepEqual(fallback.projection.sessions, [{
    id: "legacy-current",
    status: "playing",
    trackId: "legacy-track",
    trackName: "Legacy track",
    audioUrl: "https://example.test/audio/legacy.mp3",
    durationMs: 60000,
    offsetMs: 3000,
    loop: false,
    startedAtMs: 8000,
    updatedAtMs: 9000,
  }]);

  const sessionWins = buildTask07MusicProjection({
    playback,
    sessions: [makeSession("session-track")],
  });
  assert.deepEqual(
    sessionWins.projection.sessions.map(({id}) => id),
    ["session-track"]
  );
});

test("fails closed on malformed, duplicate, and over-cap active sessions", () => {
  const malformedCases = [
    makeSession("mismatch", {trackId: "other"}),
    makeSession("insecure", {audioUrl: "http://example.test/audio.mp3"}),
    makeSession("duration", {durationMs: 3600001}),
    makeSession("paused", {status: "paused", startedAtMs: 1}),
  ];
  malformedCases.forEach((session) => {
    const result = buildTask07MusicProjection({
      playback: {volume: 0.65},
      sessions: [session],
    });
    assert.equal(result.diagnosticCode, "invalid-session");
    assert.deepEqual(result.projection.sessions, []);
  });

  const duplicate = buildTask07MusicProjection({
    playback: {volume: 0.65},
    sessions: [makeSession("same"), makeSession("same")],
  });
  assert.equal(duplicate.diagnosticCode, "duplicate-session");
  assert.deepEqual(duplicate.projection.sessions, []);

  const overCap = buildTask07MusicProjection({
    playback: {volume: 0.65},
    sessions: Array.from(
      {length: TASK07_MUSIC_STREAM_QUERY_LIMIT},
      (_, index) => makeSession(`track-${index}`)
    ),
  });
  assert.equal(TASK07_MUSIC_STREAM_QUERY_LIMIT,
    TASK07_MUSIC_STREAM_MAX_SESSIONS + 1);
  assert.equal(overCap.diagnosticCode, "over-cap");
  assert.deepEqual(overCap.projection.sessions, []);
});

test("fails closed on malformed shared volume", () => {
  for (const volume of [-0.1, 1.1, "0.5", Number.NaN]) {
    const result = buildTask07MusicProjection({
      playback: {volume},
      sessions: [makeSession("active")],
    });
    assert.equal(result.diagnosticCode, "invalid-volume");
    assert.equal(result.projection.volume,
      TASK07_MUSIC_STREAM_DEFAULT_VOLUME);
    assert.deepEqual(result.projection.sessions, []);
  }
});

test("increments revisions only when the safe source hash changes", () => {
  const projection = buildTask07MusicProjection({
    playback: {volume: 0.65},
    sessions: [makeSession("active")],
  }).projection;
  const first = nextTask07MusicStreamWrite(null, projection);
  assert.equal(first.revision, 1);
  assert.equal(nextTask07MusicStreamWrite(first, projection), null);

  const changed = buildTask07MusicProjection({
    playback: {volume: 0.4},
    sessions: [makeSession("active")],
  }).projection;
  assert.equal(nextTask07MusicStreamWrite(first, changed).revision, 2);
});
