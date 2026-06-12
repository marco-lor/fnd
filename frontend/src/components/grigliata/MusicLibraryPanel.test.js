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
  onUploadTrackFiles: jest.fn(),
  onSharedVolumeChange: jest.fn(),
  onSharedVolumeCommit: jest.fn(),
  onPlayTrack: jest.fn(),
  onPlayTrackInLoop: jest.fn(),
  onPauseTrack: jest.fn(),
  onResumeTrack: jest.fn(),
  onSeekTrack: jest.fn(),
  onStopTrack: jest.fn(),
  onDeleteTrack: jest.fn(),
  onDeleteTracks: jest.fn(),
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

  test('uses a compact upload toolbar and uploads multiple files', () => {
    const onUploadTrackFiles = jest.fn();
    const file = new File(['audio-one'], 'battle-theme.mp3', { type: 'audio/mpeg' });
    const secondFile = new File(['audio-two'], 'cavern-drone.ogg', { type: 'audio/ogg' });
    const { container } = render(
      <MusicLibraryPanel
        {...buildProps({
          onUploadTrackFiles,
        })}
      />
    );

    expect(screen.queryByLabelText('Music track name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add track/i })).not.toBeInTheDocument();

    const uploadInput = container.querySelector('input[type="file"]');
    expect(uploadInput).toHaveAttribute('accept', 'audio/*');
    expect(uploadInput).toHaveAttribute('multiple');

    fireEvent.change(uploadInput, {
      target: { files: [file, secondFile] },
    });

    expect(screen.getByRole('button', { name: 'Upload music tracks' })).toBeInTheDocument();
    expect(onUploadTrackFiles).toHaveBeenCalledWith([file, secondFile]);
    expect(uploadInput.value).toBe('');
  });

  test('shows a loading icon while music tracks are uploading', () => {
    render(<MusicLibraryPanel {...buildProps({ isUploading: true })} />);

    const uploadButton = screen.getByRole('button', { name: 'Uploading music tracks' });

    expect(uploadButton).toBeDisabled();
    expect(uploadButton).toHaveAttribute('aria-busy', 'true');
    expect(uploadButton.querySelector('svg')).toHaveClass('animate-spin');
  });

  test('opens the music organizer and creates, renames, deletes, and moves tracks', () => {
    const onCreateMusicFolder = jest.fn();
    const onRenameMusicFolder = jest.fn();
    const onDeleteMusicFolder = jest.fn();
    const onMoveTrackToFolder = jest.fn();
    const onDeleteTrack = jest.fn();
    render(
      <MusicLibraryPanel
        {...buildProps({
          onCreateMusicFolder,
          onRenameMusicFolder,
          onDeleteMusicFolder,
          onMoveTrackToFolder,
          onDeleteTrack,
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Battle Theme track' }));
    expect(onDeleteTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));
  });

  test('selects tracks and moves or deletes them together from the organizer', () => {
    const onMoveTrackToFolder = jest.fn();
    const onDeleteTracks = jest.fn();
    render(
      <MusicLibraryPanel
        {...buildProps({
          onMoveTrackToFolder,
          onDeleteTracks,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Organize Music' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all tracks' }));
    fireEvent.change(screen.getByLabelText('Move selected tracks to folder'), {
      target: { value: 'folder-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected tracks' }));

    expect(onMoveTrackToFolder).toHaveBeenCalledWith('track-1', 'folder-b');
    expect(onMoveTrackToFolder).toHaveBeenCalledWith('track-2', 'folder-b');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Cavern Drone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected tracks' }));

    expect(onDeleteTracks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'track-2' }),
    ]);
  });

  test('opens a local audio preview without starting shared playback', () => {
    const onPlayTrack = jest.fn();
    const onPlayTrackInLoop = jest.fn();
    render(
      <MusicLibraryPanel
        {...buildProps({
          onPlayTrack,
          onPlayTrackInLoop,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview Battle Theme' }));

    expect(onPlayTrack).not.toHaveBeenCalled();
    expect(onPlayTrackInLoop).not.toHaveBeenCalled();

    const previewOverlay = screen.getByTestId('music-library-preview-overlay');
    expect(previewOverlay.parentElement).toBe(document.body);

    const previewDialog = screen.getByRole('dialog', { name: 'Preview Battle Theme' });
    const previewAudio = within(previewDialog).getByLabelText('Battle Theme preview');
    expect(previewAudio).toHaveAttribute('src', tracks[0].audioUrl);

    fireEvent.click(within(previewDialog).getByRole('button', { name: 'Close preview' }));

    expect(screen.queryByRole('dialog', { name: 'Preview Battle Theme' })).not.toBeInTheDocument();
  });

  test('lets the track list fill the available desktop sidebar height', () => {
    render(<MusicLibraryPanel {...buildProps()} />);

    const trackList = screen.getByTestId('music-library-scroll-list');

    expect(trackList).toHaveClass('xl:flex-1');
    expect(trackList).toHaveClass('xl:min-h-0');
    expect(trackList).toHaveClass('xl:max-h-none');
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
