import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import BackgroundGalleryPanel from './BackgroundGalleryPanel';

const backgrounds = [{
  id: 'map-1',
  name: 'Sunken Ruins',
  imageUrl: 'https://example.com/map-1.png',
  imageWidth: 1280,
  imageHeight: 720,
  galleryFolderId: 'folder-a',
  grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
}, {
  id: 'map-2',
  name: 'Iron Keep',
  imageUrl: 'https://example.com/map-2.png',
  imageWidth: 1920,
  imageHeight: 1080,
  grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
}, {
  id: 'map-3',
  name: 'Frost Hall',
  imageUrl: 'https://example.com/map-3.png',
  imageWidth: 1600,
  imageHeight: 900,
  galleryFolderId: 'missing-folder',
  grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
}];

const galleryFolders = [{
  id: 'folder-a',
  name: 'Boss Arenas',
}, {
  id: 'folder-b',
  name: 'Cities',
}];

const buildProps = (overrides = {}) => ({
  backgrounds,
  galleryFolders,
  activeBackgroundId: 'map-1',
  presentationBackgroundId: '',
  selectedBackgroundId: 'map-1',
  uploadName: '',
  selectedFileName: '',
  uploadError: '',
  isUploading: false,
  activatingBackgroundId: '',
  narrationActionBackgroundId: '',
  isNarrationActionPending: false,
  isNarrationClosePending: false,
  deletingBackgroundId: '',
  clearingTokensBackgroundId: '',
  folderMutationId: '',
  movingBackgroundFolderId: '',
  isUseBackgroundDisabled: false,
  destructiveActionLockedBackgroundIds: [],
  onUploadNameChange: jest.fn(),
  onUploadFileChange: jest.fn(),
  onUploadBackground: jest.fn(),
  onSelectBackground: jest.fn(),
  onUseBackground: jest.fn(),
  onNarrateBackground: jest.fn(),
  onCloseNarration: jest.fn(),
  onClearTokensForBackground: jest.fn(),
  onDeleteBackground: jest.fn(),
  onCalibrateBackground: jest.fn(),
  onCreateGalleryFolder: jest.fn(),
  onRenameGalleryFolder: jest.fn(),
  onDeleteGalleryFolder: jest.fn(),
  onMoveBackgroundToFolder: jest.fn(),
  ...overrides,
});

describe('BackgroundGalleryPanel', () => {
  test('disables destructive actions only for locked backgrounds', () => {
    render(
      <BackgroundGalleryPanel
        {...buildProps({
          destructiveActionLockedBackgroundIds: ['map-1'],
        })}
      />
    );

    const clearButtons = screen.getAllByRole('button', { name: 'Clear Tokens' });
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });

    expect(clearButtons[0]).toBeDisabled();
    expect(deleteButtons[0]).toBeDisabled();
    expect(clearButtons[1]).toBeEnabled();
    expect(deleteButtons[1]).toBeEnabled();
    expect(clearButtons[2]).toBeEnabled();
    expect(deleteButtons[2]).toBeEnabled();
  });

  test('disables narration actions across every row while a narration write is pending', () => {
    render(
      <BackgroundGalleryPanel
        {...buildProps({
          presentationBackgroundId: 'map-2',
          narrationActionBackgroundId: 'map-2',
          isNarrationActionPending: true,
          isNarrationClosePending: true,
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Closing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Narrate' })).toBeDisabled();
  });

  test('shows the lighting indicator only for maps with imported lighting metadata', () => {
    render(
      <BackgroundGalleryPanel
        {...buildProps({
          backgrounds: [{
            ...backgrounds[0],
            lightingSummary: {
              sourceType: 'dungeon-alchemist-foundry',
              schemaVersion: 1,
              wallCount: 20,
              lightCount: 7,
              alignmentStatus: 'match',
            },
          }, backgrounds[1], backgrounds[2]],
        })}
      />
    );

    expect(screen.getAllByLabelText('Lighting metadata imported')).toHaveLength(1);
  });

  test('accepts MP4 uploads and renders video map thumbnails', () => {
    const { container } = render(
      <BackgroundGalleryPanel
        {...buildProps({
          backgrounds: [{
            id: 'map-video',
            name: 'Dungeon Alchemist Loop',
            imageUrl: 'https://example.com/map.mp4',
            imageWidth: 2040,
            imageHeight: 1620,
            assetType: 'video',
            grid: { cellSizePx: 60, offsetXPx: 0, offsetYPx: 0 },
          }],
        })}
      />
    );

    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/*,video/mp4');
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://example.com/map.mp4');
    expect(screen.getByText(/2040 x 1620 px \| Video/i)).toBeInTheDocument();
  });

  test('shows each map folder and falls invalid assignments back to Unfiled', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    expect(screen.getByText('Folder: Boss Arenas')).toBeInTheDocument();
    expect(screen.getAllByText('Folder: Unfiled')).toHaveLength(2);
  });

  test('moves a map from the row folder menu without hiding existing actions', () => {
    const onMoveBackgroundToFolder = jest.fn();
    render(<BackgroundGalleryPanel {...buildProps({ onMoveBackgroundToFolder })} />);

    const ironKeepRow = screen.getByTestId('background-gallery-row-map-2');
    fireEvent.click(within(ironKeepRow).getByRole('button', { name: 'Move Iron Keep to folder' }));
    fireEvent.click(within(ironKeepRow).getByRole('button', { name: 'Move to Boss Arenas' }));

    expect(onMoveBackgroundToFolder).toHaveBeenCalledWith('map-2', 'folder-a');
    expect(within(ironKeepRow).getByRole('button', { name: 'Use' })).toBeInTheDocument();
    expect(within(ironKeepRow).getByRole('button', { name: 'Narrate' })).toBeInTheDocument();
    expect(within(ironKeepRow).getByRole('button', { name: 'Calibrate' })).toBeInTheDocument();
  });

  test('renders the row folder menu inline inside the selected map row', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    const ironKeepRow = screen.getByTestId('background-gallery-row-map-2');
    fireEvent.click(within(ironKeepRow).getByRole('button', { name: 'Move Iron Keep to folder' }));

    expect(within(ironKeepRow).getByRole('button', { name: 'Move to Unfiled Current' })).toBeDisabled();
    expect(within(ironKeepRow).getByRole('button', { name: 'Move to Boss Arenas' })).toBeInTheDocument();
    expect(screen.getByTestId('background-gallery-row-map-3')).toBeInTheDocument();
  });

  test('filters available maps by the selected gallery folder', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    const folderFilter = screen.getByRole('button', { name: 'Filter DM Gallery by folder' });
    fireEvent.click(folderFilter);
    fireEvent.click(screen.getByRole('option', { name: 'Boss Arenas' }));

    expect(screen.getByTestId('background-gallery-row-map-1')).toBeInTheDocument();
    expect(screen.queryByTestId('background-gallery-row-map-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('background-gallery-row-map-3')).not.toBeInTheDocument();

    fireEvent.click(folderFilter);
    fireEvent.click(screen.getByRole('option', { name: 'Unfiled' }));

    expect(screen.queryByTestId('background-gallery-row-map-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('background-gallery-row-map-2')).toBeInTheDocument();
    expect(screen.getByTestId('background-gallery-row-map-3')).toBeInTheDocument();
  });

  test('opens the folder filter as a dark custom listbox', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    const folderFilter = screen.getByRole('button', { name: 'Filter DM Gallery by folder' });
    expect(screen.queryByRole('combobox', { name: 'Filter DM Gallery by folder' })).not.toBeInTheDocument();

    fireEvent.click(folderFilter);

    const folderListbox = screen.getByRole('listbox', { name: 'Filter DM Gallery by folder options' });
    expect(folderListbox).toHaveClass('bg-slate-950');
    expect(screen.getByRole('option', { name: 'All folders' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Unfiled' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Boss Arenas' })).toBeInTheDocument();
  });

  test('opens and closes the organizer overlay from the available maps header', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Organize DM Gallery' }));

    expect(screen.getByRole('dialog', { name: 'Organize DM Gallery' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close organizer' }));

    expect(screen.queryByRole('dialog', { name: 'Organize DM Gallery' })).not.toBeInTheDocument();
  });
});
