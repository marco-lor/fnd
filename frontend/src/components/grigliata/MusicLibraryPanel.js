import React, { useEffect, useState } from 'react';
import {
  GRIGLIATA_MUSIC_PLAYBACK_STATUSES,
  normalizeGrigliataMusicVolume,
} from './music';

const formatDurationMs = (durationMs) => {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatSizeBytes = (sizeBytes) => {
  const normalizedBytes = Number(sizeBytes || 0);
  if (!Number.isFinite(normalizedBytes) || normalizedBytes <= 0) return '0 B';
  if (normalizedBytes >= 1024 * 1024) {
    return `${(normalizedBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (normalizedBytes >= 1024) {
    return `${Math.round(normalizedBytes / 1024)} KB`;
  }
  return `${Math.round(normalizedBytes)} B`;
};

const toVolumePercent = (volume) => Math.round(normalizeGrigliataMusicVolume(volume) * 100);
const toVolumeValue = (value) => normalizeGrigliataMusicVolume(Number(value || 0) / 100);
const VOLUME_COMMIT_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

export default function MusicLibraryPanel({
  tracks,
  activePlaybackState,
  uploadName,
  selectedFileName,
  uploadError,
  isUploading,
  deletingTrackId,
  playbackActionTrackId,
  playbackActionType,
  onUploadNameChange,
  onUploadFileChange,
  onUploadTrack,
  onSharedVolumeChange,
  onSharedVolumeCommit,
  onPlayTrack,
  onPauseTrack,
  onResumeTrack,
  onStopTrack,
  onDeleteTrack,
}) {
  const activeTrackId = activePlaybackState?.trackId || '';
  const activeStatus = activePlaybackState?.status || GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED;
  const isPlaybackActionPending = !!playbackActionTrackId;
  const [sharedVolumePercent, setSharedVolumePercent] = useState(() => toVolumePercent(activePlaybackState?.volume));

  useEffect(() => {
    setSharedVolumePercent(toVolumePercent(activePlaybackState?.volume));
  }, [activePlaybackState?.volume]);

  const commitSharedVolume = (nextPercent) => {
    onSharedVolumeCommit?.(toVolumeValue(nextPercent));
  };

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-300">Music</h2>
      </div>

      <div className="p-4 space-y-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Shared Volume</p>
              <p className="mt-1 text-xs text-slate-400">
                Adjust the Grigliata music level for everyone listening.
              </p>
            </div>

            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-200">
              {sharedVolumePercent}%
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={sharedVolumePercent}
            aria-label="Shared music volume"
            onChange={(event) => {
              const nextPercent = Number(event.target.value || 0);
              setSharedVolumePercent(nextPercent);
              onSharedVolumeChange?.(toVolumeValue(nextPercent));
            }}
            onMouseUp={(event) => commitSharedVolume(event.currentTarget.value)}
            onTouchEnd={(event) => commitSharedVolume(event.currentTarget.value)}
            onBlur={(event) => commitSharedVolume(event.currentTarget.value)}
            onKeyUp={(event) => {
              if (VOLUME_COMMIT_KEYS.has(event.key)) {
                commitSharedVolume(event.currentTarget.value);
              }
            }}
            className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-violet-400"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Upload Track</p>
          <div className="mt-3 space-y-3">
            <input
              type="text"
              value={uploadName}
              onChange={(event) => onUploadNameChange(event.target.value)}
              aria-label="Music track name"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-400 focus:outline-none"
              placeholder="Display name for this track"
            />

            <input
              type="file"
              accept="audio/*"
              onChange={onUploadFileChange}
              aria-label="Music track file"
              className="block w-full text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-700"
            />

            {selectedFileName && (
              <p className="text-xs text-slate-400 truncate">{selectedFileName}</p>
            )}

            {uploadError && (
              <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                {uploadError}
              </div>
            )}

            <button
              type="button"
              onClick={onUploadTrack}
              disabled={isUploading}
              className="w-full rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading...' : 'Add Track'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70">
          <div className="px-3 py-3 border-b border-slate-800">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Library</p>
          </div>

          <div className="max-h-[30rem] overflow-y-auto custom-scroll divide-y divide-slate-800">
            {tracks.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">
                No tracks uploaded yet.
              </div>
            ) : (
              tracks.map((track) => {
                const isActiveTrack = track.id === activeTrackId;
                const isPlaying = isActiveTrack && activeStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING;
                const isPaused = isActiveTrack && activeStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED;
                const isDeleting = deletingTrackId === track.id;
                const isActionPending = playbackActionTrackId === track.id;

                return (
                  <div key={track.id} className="px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-100 truncate">{track.name || 'Untitled Track'}</p>
                          {isPlaying && (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                              Playing
                            </span>
                          )}
                          {isPaused && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">
                              Paused
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-xs text-slate-400 truncate">
                          {track.fileName || 'Unknown file'}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDurationMs(track.durationMs)} | {formatSizeBytes(track.sizeBytes)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {!isActiveTrack && (
                        <button
                          type="button"
                          onClick={() => onPlayTrack(track)}
                          disabled={isPlaybackActionPending || isDeleting}
                          className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isActionPending && playbackActionType === 'play' ? 'Starting...' : 'Play'}
                        </button>
                      )}

                      {isPlaying && (
                        <button
                          type="button"
                          onClick={() => onPauseTrack(track)}
                          disabled={isPlaybackActionPending || isDeleting}
                          className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isActionPending && playbackActionType === 'pause' ? 'Pausing...' : 'Pause'}
                        </button>
                      )}

                      {isPaused && (
                        <button
                          type="button"
                          onClick={() => onResumeTrack(track)}
                          disabled={isPlaybackActionPending || isDeleting}
                          className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isActionPending && playbackActionType === 'resume' ? 'Resuming...' : 'Resume'}
                        </button>
                      )}

                      {isActiveTrack && (
                        <button
                          type="button"
                          onClick={() => onStopTrack(track)}
                          disabled={isPlaybackActionPending || isDeleting}
                          className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isActionPending && playbackActionType === 'stop' ? 'Stopping...' : 'Stop'}
                        </button>
                      )}

                      <a
                        href={track.audioUrl}
                        download={track.fileName || `${track.name || 'track'}.mp3`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/10"
                      >
                        Download
                      </a>

                      <button
                        type="button"
                        onClick={() => onDeleteTrack(track)}
                        disabled={isDeleting || isPlaybackActionPending}
                        className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
