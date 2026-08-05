import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {
  buildTask07MusicProjection,
  nextTask07MusicStreamWrite,
  TASK07_MUSIC_STREAM_QUERY_LIMIT,
  task07MusicProjectionTrackIds,
} from "./grigliataMusicStreamCore";
import {normalizeTask07MediaControl} from "./task07MediaControl";

const PLAYBACK_PATH = "grigliata_music_playback/current";
const SESSION_COLLECTION = "grigliata_music_playback_sessions";
const STREAM_PATH = "grigliata_music_stream/current";
const TRACK_COLLECTION = "grigliata_music_tracks";

const PROJECTION_OPTIONS = {
  region: "europe-west8",
  cpu: 1,
  concurrency: 1,
  maxInstances: 1,
  memory: "256MiB" as const,
  retry: true,
};

interface ProjectionWriteResult {
  diagnosticCode: string | null;
  revision: number | null;
  sourceCount: number;
  written: boolean;
}

export const rebuildTask07GrigliataMusicStream = async ():
Promise<ProjectionWriteResult> => {
  const db = admin.firestore();
  const controlRef = db.doc("utils/task07_media");
  const playbackRef = db.doc(PLAYBACK_PATH);
  const streamRef = db.doc(STREAM_PATH);
  const activeSessionsQuery = db.collection(SESSION_COLLECTION)
    .where("status", "in", ["playing", "paused"])
    .limit(TASK07_MUSIC_STREAM_QUERY_LIMIT);

  return db.runTransaction(async (transaction) => {
    const controlSnapshot = await transaction.get(controlRef);
    const control = normalizeTask07MediaControl(
      controlSnapshot.exists ? controlSnapshot.data() : null
    );
    if (control.mode === "legacy") {
      return {
        diagnosticCode: null,
        revision: null,
        sourceCount: 0,
        written: false,
      };
    }
    const playbackSnapshot = await transaction.get(playbackRef);
    const sessionsSnapshot = await transaction.get(activeSessionsQuery);
    const sessionSources = sessionsSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data(),
    }));
    const trackIds = task07MusicProjectionTrackIds({
      playback: playbackSnapshot.exists ? playbackSnapshot.data() : null,
      sessions: sessionSources,
    });
    const trackSnapshots = await Promise.all(trackIds.map((trackId) =>
      transaction.get(db.doc(`${TRACK_COLLECTION}/${trackId}`))
    ));
    const streamSnapshot = await transaction.get(streamRef);
    const result = buildTask07MusicProjection({
      controlMode: control.mode,
      playback: playbackSnapshot.exists ? playbackSnapshot.data() : null,
      sessions: sessionSources,
      tracks: trackSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({id: snapshot.id, data: snapshot.data()})),
    });
    const next = nextTask07MusicStreamWrite(
      streamSnapshot.exists ? streamSnapshot.data() : null,
      result.projection
    );
    if (next) {
      transaction.set(streamRef, {
        ...next,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      diagnosticCode: result.diagnosticCode,
      revision: next?.revision ?? null,
      sourceCount: result.sourceCount,
      written: Boolean(next),
    };
  });
};

const projectMusicStream = async (): Promise<void> => {
  const result = await rebuildTask07GrigliataMusicStream();
  if (result.diagnosticCode) {
    console.error("Task07 music projection rejected source state", {
      code: result.diagnosticCode,
      sourceCount: result.sourceCount,
    });
  }
};

export const syncTask07MusicStreamFromPlayback = onDocumentWritten(
  {
    ...PROJECTION_OPTIONS,
    document: PLAYBACK_PATH,
  },
  projectMusicStream
);

export const syncTask07MusicStreamFromSession = onDocumentWritten(
  {
    ...PROJECTION_OPTIONS,
    document: `${SESSION_COLLECTION}/{sessionId}`,
  },
  projectMusicStream
);

export const syncTask07MusicStreamFromTrack = onDocumentWritten(
  {
    ...PROJECTION_OPTIONS,
    document: `${TRACK_COLLECTION}/{trackId}`,
  },
  projectMusicStream
);

export const syncTask07MusicStreamFromControl = onDocumentWritten(
  {
    ...PROJECTION_OPTIONS,
    document: "utils/task07_media",
  },
  async (event) => {
    const control = normalizeTask07MediaControl(
      event.data?.after.exists ? event.data.after.data() : null
    );
    if (control.mode === "legacy") return;
    await projectMusicStream();
  }
);
