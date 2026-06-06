import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import MusicLibraryPanel from './MusicLibraryPanel';

const tracks = [{
  id: 'track-1',
  name: 'Battle Theme',
  fileName: 'battle-theme.mp3',
  audioUrl: 'https://example.com/audio/battle-theme.mp3',
  audioPath: 'grigliata/music/user-1/battle-theme.mp3',
  contentType: 'audio/mpeg',
  sizeBytes: 2048,
  durationMs: 120000,
  musicFolderId: 'folder-a',
}, {
  id: 'track-2',
  name: 'Cavern Drone',
  fileName: 'cavern-drone.mp3',
  audioUrl: 'https://example.com/audio/cavern-drone.mp3',
  audioPath: 'grigliata/music/user-1/cavern-drone.mp3',
  contentType: 'audio/mpeg',
  sizeBytes: 4096,
  durationMs: 240000,
}];

const musicFolders = [{
  id: 'folder-a',
  name: 'Combat',
}, {
  id: 'folder-b',
  name: 'Ambience',
}];

const buildProps = (overrides = {}) => ({
  tracks,
  musicFolders,
  selectedFolderId: '__unfiled__',
  activePlaybackState: {
    status: 'stopped',
    volume: 0.65,
  },
  activePlaybackSessions: [],
  uploadName: '',
  selectedFileName: '',
  uploadError: '',
  isUploading: false,
  deletingTrackId: '',
  playbackActionTrackId: '',
  playbackActionType: '',
  folderMutationId: '',
  movingTrackFolderId: '',
  onSelectedFolderIdChange: jest.fn(),
  onCreateMusicFolder: jest.fn(),
  onRenameMusicFolder: jest.fn(),
  onDeleteMusicFolder: jest.fn(),
  onMoveTrackToFolder: jest.fn(),
  onUploadNameChange: jest.fn(),
  onUploadFileChange: jest.fn(),
  onUploadTrack: jest.fn(),
  onSharedVolumeChange: jest.fn(),
  onSharedVolumeCommit: jest.fn(),
  onPlayTrack: jest.fn(),
  onPlayTrackInLoop: jest.fn(),
  onPauseTrack: jest.fn(),
  onResumeTrack: jest.fn(),
  onSeekTrack: jest.fn(),
  onStopTrack: jest.fn(),
  onDeleteTrack: jest.fn(),
  ...overrides,
});

describe('MusicLibraryPanel', () => {
  test('uses a selected-folder filter without an all-folders option', () => {
    const onSelectedFolderIdChange = jest.fn();
    render(<MusicLibraryPanel {...buildProps({ onSelectedFolderIdChange })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Filter Music by folder' }));

    expect(screen.queryByRole('option', { name: 'All folders' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unfiled' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('option', { name: 'Combat' }));

    expect(onSelectedFolderIdChange).toHaveBeenCalledWith('folder-a');
  });

  test('opens the music organizer and creates, renames, deletes, and moves tracks', () => {
    const onCreateMusicFolder = jest.fn();
    const onRenameMusicFolder = jest.fn();
    const onDeleteMusicFolder = jest.fn();
    const onMoveTrackToFolder = jest.fn();
    render(
      <MusicLibraryPanel
        {...buildProps({
          onCreateMusicFolder,
          onRenameMusicFolder,
          onDeleteMusicFolder,
          onMoveTrackToFolder,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Battle Theme to folder' }));
    fireEvent.click(within(screen.getByTestId('music-library-row-track-1')).getByRole('button', { name: 'Move to Ambience' }));
    expect(onMoveTrackToFolder).toHaveBeenCalledWith('track-1', 'folder-b');

    fireEvent.click(screen.getByRole('button', { name: 'Organize Music' }));
    expect(screen.getByRole('dialog', { name: 'Organize Music' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New folder name'), {
      target: { value: 'Boss Themes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Folder' }));
    expect(onCreateMusicFolder).toHaveBeenCalledWith('Boss Themes');

    fireEvent.click(screen.getByRole('button', { name: 'Rename Combat' }));
    fireEvent.change(screen.getByLabelText('Rename Combat'), {
      target: { value: 'Battle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Combat' }));
    expect(onRenameMusicFolder).toHaveBeenCalledWith('folder-a', 'Battle');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Ambience' }));
    expect(onDeleteMusicFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'folder-b' }));
  });

  test('keeps controls for active playback sessions outside the selected folder', () => {
    const onStopTrack = jest.fn();
    render(
      <MusicLibraryPanel
        {...buildProps({
          tracks: [],
          activePlaybackSessions: [{
            id: 'track-outside',
            status: 'playing',
            trackId: 'track-outside',
            trackName: 'Hidden Boss Loop',
            audioUrl: 'https://example.com/audio/hidden-boss-loop.mp3',
            durationMs: 90000,
            offsetMs: 0,
            loop: true,
          }],
          onStopTrack,
        })}
      />
    );

    expect(screen.getByText('Hidden Boss Loop')).toBeInTheDocument();
    expect(screen.getByText('No tracks in this folder.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^stop hidden boss loop$/i }));

    expect(onStopTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'track-outside', name: 'Hidden Boss Loop' }),
      expect.objectContaining({ trackId: 'track-outside' })
    );
  });
});
