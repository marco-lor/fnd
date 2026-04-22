import {onDocumentDeleted} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {getStorage} from "firebase-admin/storage";
import {randomUUID} from "crypto";

const DEFAULT_GRIGLIATA_MUSIC_VOLUME = 0.65;

const clampMusicVolume = (volume: unknown) => {
  if (typeof volume !== "number" || !Number.isFinite(volume)) {
    return DEFAULT_GRIGLIATA_MUSIC_VOLUME;
  }

  return Math.min(1, Math.max(0, volume));
};

const STOPPED_PLAYBACK_STATE = (updatedBy: string | null, volume: number) => ({
  status: "stopped",
  trackId: "",
  trackName: "",
  audioUrl: "",
  durationMs: 0,
  offsetMs: 0,
  volume,
  startedAt: null,
  commandId: `music_${randomUUID()}`,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedBy,
});

export const cleanupGrigliataMusicTrack = onDocumentDeleted(
  {
    document: "grigliata_music_tracks/{trackId}",
    region: "europe-west1",
  },
  async (event) => {
    const deletedTrack = event.data?.data();
    if (!deletedTrack) {
      return;
    }

    const audioPath = typeof deletedTrack.audioPath === "string" ? deletedTrack.audioPath.trim() : "";
    if (audioPath) {
      try {
        await getStorage().bucket().file(audioPath).delete({ignoreNotFound: true});
      } catch (error) {
        console.error("cleanupGrigliataMusicTrack: Failed to delete storage object", {
          audioPath,
          error,
        });
      }
    }

    const playbackRef = admin.firestore().doc("grigliata_music_playback/current");
    const playbackSnap = await playbackRef.get();
    if (!playbackSnap.exists) {
      return;
    }

    const playbackData = playbackSnap.data() || {};
    if (playbackData.trackId !== event.params.trackId) {
      return;
    }

    const volume = clampMusicVolume(playbackData.volume);

    const updatedBy = typeof deletedTrack.updatedBy === "string" && deletedTrack.updatedBy.trim()
      ? deletedTrack.updatedBy.trim()
      : typeof deletedTrack.createdBy === "string" && deletedTrack.createdBy.trim()
        ? deletedTrack.createdBy.trim()
        : null;

    await playbackRef.set(STOPPED_PLAYBACK_STATE(updatedBy, volume));
  }
);
