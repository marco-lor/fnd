import React, { useEffect, useMemo, useState } from 'react';
import { FiDownload, FiFolder, FiPause, FiPlay, FiRepeat, FiSquare, FiTrash2 } from 'react-icons/fi';
import MediaFolderFilterButton from './MediaFolderFilterButton';
import MediaFolderOrganizerOverlay from './MediaFolderOrganizerOverlay';
import {
  computeGrigliataMusicPlaybackOffsetMs,
  GRIGLIATA_MUSIC_PLAYBACK_STATUSES,
  normalizeGrigliataMusicVolume,
} from './music';
import {
  buildMusicFolderOptions,
  getMusicFolderDisplayName,
  getResolvedMusicFolderId,
  getWritableMusicFolderId,
  UNFILED_MUSIC_FOLDER_ID,
} from './musicFolders';

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
const toSeekOffsetMs = (value, durationMs) => {
  const numericValue = Number(value || 0);
  const numericDuration = Math.max(0, Number(durationMs || 0));

  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(numericDuration, Math.max(0, Math.round(numericValue)));
};
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

const MUSIC_ACTION_BASE_CLASS_NAME = 'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const MUSIC_ACTION_ICON_CLASS_NAME = 'h-4 w-4';

const getMusicActionClassName = (toneClassName) => (
  `${MUSIC_ACTION_BASE_CLASS_NAME} ${toneClassName}`
);

const buildTrackActionLabel = (actionLabel, trackName) => `${actionLabel} ${trackName}`;

const getSessionProgressMs = (session, now) => {
  if (!session) return 0;
  return computeGrigliataMusicPlaybackOffsetMs(session, now);
};

export default function MusicLibraryPanel({
  tracks,
  musicFolders = [],
  selectedFolderId = UNFILED_MUSIC_FOLDER_ID,
  activePlaybackState,
  activePlaybackSessions = [],
  uploadName,
  selectedFileName,
  uploadError,
  isUploading,
  deletingTrackId,
  playbackActionTrackId,
  playbackActionType,
  folderMutationId = '',
  movingTrackFolderId = '',
  onSelectedFolderIdChange,
  onCreateMusicFolder,
  onRenameMusicFolder,
  onDeleteMusicFolder,
  onMoveTrackToFolder,
  onUploadNameChange,
  onUploadFileChange,
  onUploadTrack,
  onSharedVolumeChange,
  onSharedVolumeCommit,
  onPlayTrack,
  onPlayTrackInLoop,
  onPauseTrack,
  onResumeTrack,
  onSeekTrack,
  onStopTrack,
  onDeleteTrack,
}) {
  const isPlaybackActionPending = !!playbackActionTrackId;
  const [sharedVolumePercent, setSharedVolumePercent] = useState(() => toVolumePercent(activePlaybackState?.volume));
  const [playbackClockMs, setPlaybackClockMs] = useState(() => Date.now());
  const [seekDraftOffsetsByTrackId, setSeekDraftOffsetsByTrackId] = useState({});
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false);
  const [folderMenuTrackId, setFolderMenuTrackId] = useState('');
  const folderOptions = useMemo(() => buildMusicFolderOptions(musicFolders), [musicFolders]);
  const playbackSessionsByTrackId = useMemo(() => {
    const nextMap = new Map();

    (Array.isArray(activePlaybackSessions) ? activePlaybackSessions : []).forEach((session) => {
      if (session?.trackId) {
        nextMap.set(session.trackId, session);
      }
    });

    return nextMap;
  }, [activePlaybackSessions]);
  const loadedTrackIds = useMemo(() => (
    new Set((tracks || []).map((track) => track?.id).filter(Boolean))
  ), [tracks]);
  const outsideSelectedFolderSessions = useMemo(() => (
    (activePlaybackSessions || [])
      .filter((session) => session?.trackId && !loadedTrackIds.has(session.trackId))
  ), [activePlaybackSessions, loadedTrackIds]);

  useEffect(() => {
    setSharedVolumePercent(toVolumePercent(activePlaybackState?.volume));
  }, [activePlaybackState?.volume]);

  useEffect(() => {
    if (!activePlaybackSessions.some((session) => session?.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING)) {
      setPlaybackClockMs(Date.now());
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setPlaybackClockMs(Date.now());
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [activePlaybackSessions]);

  useEffect(() => {
    setSeekDraftOffsetsByTrackId((currentDrafts) => {
      const activeTrackIds = new Set(activePlaybackSessions.map((session) => session?.trackId).filter(Boolean));
      const nextDrafts = Object.fromEntries(
        Object.entries(currentDrafts).filter(([trackId]) => activeTrackIds.has(trackId))
      );

      return Object.keys(nextDrafts).length === Object.keys(currentDrafts).length
        ? currentDrafts
        : nextDrafts;
    });
  }, [activePlaybackSessions]);

  const commitSharedVolume = (nextPercent) => {
    onSharedVolumeCommit?.(toVolumeValue(nextPercent));
  };

  const commitTrackSeek = (track, session, nextOffsetMs) => {
    if (!track?.id || !session) return;
    onSeekTrack?.(track, session, nextOffsetMs);
    setSeekDraftOffsetsByTrackId((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[track.id];
      return nextDrafts;
    });
  };

  const buildTrackFromSession = (session = {}) => ({
    id: session.trackId || session.id || '',
    name: session.trackName || 'Untitled Track',
    fileName: '',
    audioUrl: session.audioUrl || '',
    audioPath: '',
    contentType: '',
    sizeBytes: 0,
    durationMs: Math.max(0, Math.round(Number(session.durationMs || 0))),
  });

  const renderActiveSessionControls = (session) => {
    const track = buildTrackFromSession(session);
    const trackName = track.name || 'Untitled Track';
    const activeStatus = session?.status || GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED;
    const isPlaying = activeStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING;
    const isPaused = activeStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED;
    const isActionPending = playbackActionTrackId === track.id;
    const durationMs = Math.max(0, Math.round(Number(session?.durationMs || 0)));
    const progressMs = durationMs > 0 ? getSessionProgressMs(session, playbackClockMs) : 0;
    const hasSeekDraft = Object.prototype.hasOwnProperty.call(seekDraftOffsetsByTrackId, track.id);
    const seekOffsetMs = hasSeekDraft ? seekDraftOffsetsByTrackId[track.id] : progressMs;

    return (
      <div key={track.id} className="px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-100 truncate">{trackName}</p>
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
              {session?.loop === true && (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                  Loop
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">Playing outside the selected folder</p>
          </div>
        </div>

        {durationMs > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-slate-500">
              <span>{formatDurationMs(seekOffsetMs)}</span>
              <span>{formatDurationMs(durationMs)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={durationMs}
              step="250"
              value={seekOffsetMs}
              disabled={isPlaybackActionPending}
              aria-label={buildTrackActionLabel('Seek', trackName)}
              onChange={(event) => {
                const nextOffsetMs = toSeekOffsetMs(event.target.value, durationMs);
                setSeekDraftOffsetsByTrackId((currentDrafts) => ({
                  ...currentDrafts,
                  [track.id]: nextOffsetMs,
                }));
              }}
              onMouseUp={(event) => commitTrackSeek(track, session, toSeekOffsetMs(event.currentTarget.value, durationMs))}
              onTouchEnd={(event) => commitTrackSeek(track, session, toSeekOffsetMs(event.currentTarget.value, durationMs))}
              onBlur={(event) => {
                if (hasSeekDraft) {
                  commitTrackSeek(track, session, toSeekOffsetMs(event.currentTarget.value, durationMs));
                }
              }}
              onKeyUp={(event) => {
                if (VOLUME_COMMIT_KEYS.has(event.key)) {
                  commitTrackSeek(track, session, toSeekOffsetMs(event.currentTarget.value, durationMs));
                }
              }}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {isPlaying && (
            <button
              type="button"
              onClick={() => onPauseTrack(track, session)}
              disabled={isPlaybackActionPending}
              aria-label={buildTrackActionLabel('Pause', trackName)}
              title={isActionPending && playbackActionType === 'pause' ? `Pausing ${trackName}` : buildTrackActionLabel('Pause', trackName)}
              aria-busy={isActionPending && playbackActionType === 'pause' ? true : undefined}
              className={getMusicActionClassName('border-amber-500/40 text-amber-200 hover:bg-amber-500/10')}
            >
              <FiPause className={MUSIC_ACTION_ICON_CLASS_NAME} />
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              onClick={() => onResumeTrack(track, session)}
              disabled={isPlaybackActionPending}
              aria-label={buildTrackActionLabel('Resume', trackName)}
              title={isActionPending && playbackActionType === 'resume' ? `Resuming ${trackName}` : buildTrackActionLabel('Resume', trackName)}
              aria-busy={isActionPending && playbackActionType === 'resume' ? true : undefined}
              className={getMusicActionClassName('border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10')}
            >
              <FiPlay className={MUSIC_ACTION_ICON_CLASS_NAME} />
            </button>
          )}

          <button
            type="button"
            onClick={() => onStopTrack(track, session)}
            disabled={isPlaybackActionPending}
            aria-label={buildTrackActionLabel('Stop', trackName)}
            title={isActionPending && playbackActionType === 'stop' ? `Stopping ${trackName}` : buildTrackActionLabel('Stop', trackName)}
            aria-busy={isActionPending && playbackActionType === 'stop' ? true : undefined}
            className={getMusicActionClassName('border-rose-500/40 text-rose-200 hover:bg-rose-500/10')}
          >
            <FiSquare className={MUSIC_ACTION_ICON_CLASS_NAME} />
          </button>
        </div>
      </div>
    );
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
          <div className="space-y-3 px-3 py-3 border-b border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Library</p>
              <button
                type="button"
                aria-label="Organize Music"
                onClick={() => setIsOrganizerOpen(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-violet-500/40 px-2.5 py-1.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/10"
              >
                <FiFolder className="h-3.5 w-3.5" aria-hidden="true" />
                Organize
              </button>
            </div>

            <MediaFolderFilterButton
              folders={musicFolders}
              selectedFolderId={selectedFolderId}
              onSelectedFolderIdChange={onSelectedFolderIdChange}
              buttonLabel="Filter Music by folder"
              listboxLabel="Filter Music by folder options"
              tone="violet"
              onBeforeOpen={() => setFolderMenuTrackId('')}
            />
          </div>

          {outsideSelectedFolderSessions.length > 0 && (
            <div className="border-b border-slate-800">
              <div className="border-b border-slate-800 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Active Tracks</p>
              </div>
              <div className="divide-y divide-slate-800">
                {outsideSelectedFolderSessions.map(renderActiveSessionControls)}
              </div>
            </div>
          )}

          <div className="max-h-[30rem] overflow-y-auto custom-scroll divide-y divide-slate-800">
            {tracks.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">
                No tracks in this folder.
              </div>
            ) : (
              tracks.map((track) => {
                const trackName = track.name || 'Untitled Track';
                const activeSession = playbackSessionsByTrackId.get(track.id) || null;
                const activeStatus = activeSession?.status || GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED;
                const isActiveTrack = !!activeSession;
                const isPlaying = isActiveTrack && activeStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING;
                const isPaused = isActiveTrack && activeStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED;
                const isDeleting = deletingTrackId === track.id;
                const isActionPending = playbackActionTrackId === track.id;
                const durationMs = Math.max(0, Math.round(Number(activeSession?.durationMs || track.durationMs || 0)));
                const progressMs = durationMs > 0
                  ? getSessionProgressMs(activeSession, playbackClockMs)
                  : 0;
                const hasSeekDraft = Object.prototype.hasOwnProperty.call(seekDraftOffsetsByTrackId, track.id);
                const seekOffsetMs = hasSeekDraft
                  ? seekDraftOffsetsByTrackId[track.id]
                  : progressMs;

                return (
                  <div key={track.id} data-testid={`music-library-row-${track.id}`} className="px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-100 truncate">{trackName}</p>
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
                          {isActiveTrack && activeSession?.loop === true && (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                              Loop
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-xs text-slate-400 truncate">
                          {track.fileName || 'Unknown file'}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDurationMs(track.durationMs)} | {formatSizeBytes(track.sizeBytes)}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-violet-200/80">
                          Folder: {getMusicFolderDisplayName(track, musicFolders)}
                        </p>
                      </div>
                    </div>

                    {isActiveTrack && durationMs > 0 && (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                          <span>{formatDurationMs(seekOffsetMs)}</span>
                          <span>{formatDurationMs(durationMs)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={durationMs}
                          step="250"
                          value={seekOffsetMs}
                          disabled={isPlaybackActionPending || isDeleting}
                          aria-label={buildTrackActionLabel('Seek', trackName)}
                          onChange={(event) => {
                            const nextOffsetMs = toSeekOffsetMs(event.target.value, durationMs);
                            setSeekDraftOffsetsByTrackId((currentDrafts) => ({
                              ...currentDrafts,
                              [track.id]: nextOffsetMs,
                            }));
                          }}
                          onMouseUp={(event) => commitTrackSeek(track, activeSession, toSeekOffsetMs(event.currentTarget.value, durationMs))}
                          onTouchEnd={(event) => commitTrackSeek(track, activeSession, toSeekOffsetMs(event.currentTarget.value, durationMs))}
                          onBlur={(event) => {
                            if (hasSeekDraft) {
                              commitTrackSeek(track, activeSession, toSeekOffsetMs(event.currentTarget.value, durationMs));
                            }
                          }}
                          onKeyUp={(event) => {
                            if (VOLUME_COMMIT_KEYS.has(event.key)) {
                              commitTrackSeek(track, activeSession, toSeekOffsetMs(event.currentTarget.value, durationMs));
                            }
                          }}
                          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-label={buildTrackActionLabel('Move', `${trackName} to folder`)}
                        title={buildTrackActionLabel('Move', `${trackName} to folder`)}
                        onClick={() => setFolderMenuTrackId((currentId) => (
                          currentId === track.id ? '' : track.id
                        ))}
                        disabled={movingTrackFolderId === track.id}
                        className={getMusicActionClassName('border-violet-500/40 text-violet-200 hover:bg-violet-500/10')}
                      >
                        <FiFolder className={MUSIC_ACTION_ICON_CLASS_NAME} />
                      </button>

                      {!isActiveTrack && (
                        <>
                          <button
                            type="button"
                            onClick={() => onPlayTrack(track)}
                            disabled={isPlaybackActionPending || isDeleting}
                            aria-label={buildTrackActionLabel('Play', trackName)}
                            title={isActionPending && playbackActionType === 'play' ? `Starting ${trackName}` : buildTrackActionLabel('Play', trackName)}
                            aria-busy={isActionPending && playbackActionType === 'play' ? true : undefined}
                            className={getMusicActionClassName('border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10')}
                          >
                            <FiPlay className={MUSIC_ACTION_ICON_CLASS_NAME} />
                          </button>

                          <button
                            type="button"
                            onClick={() => onPlayTrackInLoop(track)}
                            disabled={isPlaybackActionPending || isDeleting}
                            aria-label={buildTrackActionLabel('Play in loop', trackName)}
                            title={isActionPending && playbackActionType === 'loop' ? `Starting ${trackName} in loop` : buildTrackActionLabel('Play in loop', trackName)}
                            aria-busy={isActionPending && playbackActionType === 'loop' ? true : undefined}
                            className={getMusicActionClassName('border-sky-500/40 text-sky-200 hover:bg-sky-500/10')}
                          >
                            <FiRepeat className={MUSIC_ACTION_ICON_CLASS_NAME} />
                          </button>
                        </>
                      )}

                      {isPlaying && (
                        <button
                          type="button"
                          onClick={() => onPauseTrack(track, activeSession)}
                          disabled={isPlaybackActionPending || isDeleting}
                          aria-label={buildTrackActionLabel('Pause', trackName)}
                          title={isActionPending && playbackActionType === 'pause' ? `Pausing ${trackName}` : buildTrackActionLabel('Pause', trackName)}
                          aria-busy={isActionPending && playbackActionType === 'pause' ? true : undefined}
                          className={getMusicActionClassName('border-amber-500/40 text-amber-200 hover:bg-amber-500/10')}
                        >
                          <FiPause className={MUSIC_ACTION_ICON_CLASS_NAME} />
                        </button>
                      )}

                      {isPaused && (
                        <button
                          type="button"
                          onClick={() => onResumeTrack(track, activeSession)}
                          disabled={isPlaybackActionPending || isDeleting}
                          aria-label={buildTrackActionLabel('Resume', trackName)}
                          title={isActionPending && playbackActionType === 'resume' ? `Resuming ${trackName}` : buildTrackActionLabel('Resume', trackName)}
                          aria-busy={isActionPending && playbackActionType === 'resume' ? true : undefined}
                          className={getMusicActionClassName('border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10')}
                        >
                          <FiPlay className={MUSIC_ACTION_ICON_CLASS_NAME} />
                        </button>
                      )}

                      {isActiveTrack && (
                        <button
                          type="button"
                          onClick={() => onStopTrack(track, activeSession)}
                          disabled={isPlaybackActionPending || isDeleting}
                          aria-label={buildTrackActionLabel('Stop', trackName)}
                          title={isActionPending && playbackActionType === 'stop' ? `Stopping ${trackName}` : buildTrackActionLabel('Stop', trackName)}
                          aria-busy={isActionPending && playbackActionType === 'stop' ? true : undefined}
                          className={getMusicActionClassName('border-rose-500/40 text-rose-200 hover:bg-rose-500/10')}
                        >
                          <FiSquare className={MUSIC_ACTION_ICON_CLASS_NAME} />
                        </button>
                      )}

                      <a
                        href={track.audioUrl}
                        download={track.fileName || `${track.name || 'track'}.mp3`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={buildTrackActionLabel('Download', trackName)}
                        title={buildTrackActionLabel('Download', trackName)}
                        className={getMusicActionClassName('border-sky-500/40 text-sky-200 hover:bg-sky-500/10')}
                      >
                        <FiDownload className={MUSIC_ACTION_ICON_CLASS_NAME} />
                      </a>

                      <button
                        type="button"
                        onClick={() => onDeleteTrack(track)}
                        disabled={isDeleting || isPlaybackActionPending}
                        aria-label={buildTrackActionLabel('Delete', trackName)}
                        title={isDeleting ? `Deleting ${trackName}` : buildTrackActionLabel('Delete', trackName)}
                        aria-busy={isDeleting ? true : undefined}
                        className={getMusicActionClassName('border-red-500/40 text-red-200 hover:bg-red-500/10')}
                      >
                        <FiTrash2 className={MUSIC_ACTION_ICON_CLASS_NAME} />
                      </button>
                    </div>

                    {folderMenuTrackId === track.id && (
                      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/90 p-1.5 shadow-inner shadow-black/30">
                        <div className="grid grid-cols-1 gap-1">
                          {folderOptions.map((folder) => {
                            const targetFolderId = getWritableMusicFolderId(folder.id);
                            const isCurrentFolder = getResolvedMusicFolderId(track, musicFolders) === folder.id;

                            return (
                              <button
                                key={folder.id}
                                type="button"
                                onClick={() => {
                                  onMoveTrackToFolder?.(track.id, targetFolderId);
                                  setFolderMenuTrackId('');
                                }}
                                disabled={isCurrentFolder || movingTrackFolderId === track.id}
                                className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                <span className="truncate">Move to {folder.name}</span>
                                {isCurrentFolder && (
                                  <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-violet-300">Current</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <MediaFolderOrganizerOverlay
        isOpen={isOrganizerOpen}
        title="Organize Music"
        subtitle="Move tracks between shared folders without changing the uploaded files."
        folders={musicFolders}
        items={tracks}
        selectedFolderId={selectedFolderId}
        itemNounPlural="tracks"
        emptyMessage="Drop tracks here or use a row folder control to move tracks into this folder."
        folderMutationId={folderMutationId}
        movingItemId={movingTrackFolderId}
        tone="violet"
        onClose={() => setIsOrganizerOpen(false)}
        onSelectedFolderIdChange={onSelectedFolderIdChange}
        onCreateFolder={onCreateMusicFolder}
        onRenameFolder={onRenameMusicFolder}
        onDeleteFolder={onDeleteMusicFolder}
        onMoveItemToFolder={onMoveTrackToFolder}
        getItemId={(track) => track?.id || ''}
        renderItem={({ item: track, itemId, moving, dragProps }) => {
          const resolvedFolderId = getResolvedMusicFolderId(track, musicFolders);
          const selectValue = getWritableMusicFolderId(resolvedFolderId);

          return (
            <article
              key={itemId}
              data-testid={`music-organizer-track-${itemId}`}
              {...dragProps}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
            >
              <p className="truncate text-sm font-semibold text-slate-100">{track.name || 'Untitled Track'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {track.fileName || 'Unknown file'} | {formatDurationMs(track.durationMs)}
              </p>
              <select
                aria-label={`Move ${track.name || 'Untitled Track'} to folder`}
                value={selectValue}
                onChange={(event) => onMoveTrackToFolder?.(itemId, event.target.value)}
                disabled={moving}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-violet-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {folderOptions.map((folder) => (
                  <option
                    key={folder.id}
                    value={getWritableMusicFolderId(folder.id)}
                  >
                    {folder.name}
                  </option>
                ))}
              </select>
            </article>
          );
        }}
      />
    </section>
  );
}
