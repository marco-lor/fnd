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
  presentationBackgroundIds: [],
  selectedBackgroundId: 'map-1',
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
  selectedFolderId: '__unfiled__',
  isUseBackgroundDisabled: false,
  destructiveActionLockedBackgroundIds: [],
  onSelectedFolderIdChange: jest.fn(),
  onUploadBackgroundFiles: jest.fn(),
  onSelectBackground: jest.fn(),
  onUseBackground: jest.fn(),
  onNarrateBackground: jest.fn(),
  onCloseNarration: jest.fn(),
  onAddNarrationBackground: jest.fn(),
  onRemoveNarrationBackground: jest.fn(),
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

    const clearButtons = screen.getAllByRole('button', { name: /^Clear tokens from /i });
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete /i });

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

    expect(screen.getByRole('button', { name: 'Close narration for Iron Keep' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Narrate Frost Hall' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Frost Hall to multi narration' })).toBeDisabled();
  });

  test('shows multi narration controls only while a narration scene is active', () => {
    const onAddNarrationBackground = jest.fn();
    const onRemoveNarrationBackground = jest.fn();
    const { rerender } = render(
      <BackgroundGalleryPanel
        {...buildProps({
          onAddNarrationBackground,
          onRemoveNarrationBackground,
        })}
      />
    );

    expect(screen.queryByRole('button', { name: 'Add Iron Keep to multi narration' })).not.toBeInTheDocument();

    rerender(
      <BackgroundGalleryPanel
        {...buildProps({
          presentationBackgroundId: 'map-2',
          presentationBackgroundIds: ['map-2'],
          onAddNarrationBackground,
          onRemoveNarrationBackground,
        })}
      />
    );

    const frostHallRow = screen.getByTestId('background-gallery-row-map-3');
    fireEvent.click(within(frostHallRow).getByRole('button', { name: 'Add Frost Hall to multi narration' }));

    expect(onAddNarrationBackground).toHaveBeenCalledWith(backgrounds[2]);
    expect(within(screen.getByTestId('background-gallery-row-map-2')).queryByRole('button', { name: 'Add Iron Keep to multi narration' })).not.toBeInTheDocument();

    rerender(
      <BackgroundGalleryPanel
        {...buildProps({
          presentationBackgroundId: 'map-2',
          presentationBackgroundIds: ['map-2', 'map-3'],
          onAddNarrationBackground,
          onRemoveNarrationBackground,
        })}
      />
    );

    const includedFrostHallRow = screen.getByTestId('background-gallery-row-map-3');
    fireEvent.click(within(includedFrostHallRow).getByRole('button', { name: 'Remove Frost Hall from narration' }));

    expect(screen.queryByRole('button', { name: 'Add Frost Hall to multi narration' })).not.toBeInTheDocument();
    expect(onRemoveNarrationBackground).toHaveBeenCalledWith(backgrounds[2]);
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

  test('uploads selected background files from the minimal maps toolbar', () => {
    const onUploadBackgroundFiles = jest.fn();
    const file = new File(['map'], 'train-yard.png', { type: 'image/png' });
    const secondFile = new File(['map-2'], 'signal-room.png', { type: 'image/png' });
    const { container } = render(
      <BackgroundGalleryPanel
        {...buildProps({
          onUploadBackgroundFiles,
        })}
      />
    );

    expect(screen.queryByText('Upload Background')).not.toBeInTheDocument();
    expect(screen.queryByText('Available Maps')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Display name for this map')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose File')).not.toBeInTheDocument();
    expect(screen.queryByText('Add To Gallery')).not.toBeInTheDocument();

    const uploadInput = container.querySelector('input[type="file"]');
    expect(uploadInput).toHaveAttribute('accept', 'image/*,video/mp4');
    expect(uploadInput).toHaveAttribute('multiple');

    fireEvent.change(uploadInput, {
      target: { files: [file, secondFile] },
    });

    expect(screen.getByRole('button', { name: 'Upload background files' })).toBeInTheDocument();
    expect(onUploadBackgroundFiles).toHaveBeenCalledWith([file, secondFile]);
    expect(uploadInput.value).toBe('');
  });

  test('renders the available maps controls on one compact icon row', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    expect(screen.queryByText('Available Maps')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter DM Gallery by folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload background files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Organize DM Gallery' })).toBeInTheDocument();
    expect(screen.queryByText('Organize')).not.toBeInTheDocument();
  });

  test('shows a loading icon while background files are uploading', () => {
    render(<BackgroundGalleryPanel {...buildProps({ isUploading: true })} />);

    const uploadButton = screen.getByRole('button', { name: 'Uploading background files' });

    expect(uploadButton).toBeDisabled();
    expect(uploadButton).toHaveAttribute('aria-busy', 'true');
    expect(uploadButton.querySelector('svg')).toHaveClass('animate-spin');
  });

  test('lets the map list fill the available desktop sidebar height', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    const mapList = screen.getByTestId('background-gallery-scroll-list');

    expect(mapList).toHaveClass('xl:flex-1');
    expect(mapList).toHaveClass('xl:min-h-0');
    expect(mapList).toHaveClass('xl:max-h-none');
  });

  test('opens a local zoom preview from a map thumbnail without selecting it', () => {
    const onSelectBackground = jest.fn();
    render(<BackgroundGalleryPanel {...buildProps({ onSelectBackground })} />);

    const sunkenRuinsRow = screen.getByTestId('background-gallery-row-map-1');
    const previewButton = within(sunkenRuinsRow).getByRole('button', { name: 'Preview Sunken Ruins' });

    expect(previewButton).toHaveClass('opacity-0');
    expect(previewButton).toHaveClass('group-hover/thumbnail:opacity-100');

    fireEvent.click(previewButton);

    expect(onSelectBackground).not.toHaveBeenCalled();

    const previewOverlay = screen.getByTestId('background-gallery-preview-overlay');
    expect(previewOverlay.parentElement).toBe(document.body);
    expect(previewOverlay).toHaveClass('z-[120]');

    const previewDialog = screen.getByRole('dialog', { name: 'Preview Sunken Ruins' });
    expect(previewDialog).toHaveAttribute('aria-modal', 'true');
    expect(within(previewDialog).getByRole('img', { name: 'Sunken Ruins preview' })).toHaveAttribute('src', backgrounds[0].imageUrl);

    fireEvent.click(within(previewDialog).getByRole('button', { name: 'Close preview' }));

    expect(screen.queryByRole('dialog', { name: 'Preview Sunken Ruins' })).not.toBeInTheDocument();
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
    expect(within(ironKeepRow).getByRole('button', { name: 'Use Iron Keep' })).toBeInTheDocument();
    expect(within(ironKeepRow).getByRole('button', { name: 'Narrate Iron Keep' })).toBeInTheDocument();
    expect(within(ironKeepRow).getByRole('button', { name: 'Calibrate Iron Keep grid' })).toBeInTheDocument();
  });

  test('renders the row folder menu inline inside the selected map row', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    const ironKeepRow = screen.getByTestId('background-gallery-row-map-2');
    fireEvent.click(within(ironKeepRow).getByRole('button', { name: 'Move Iron Keep to folder' }));

    expect(within(ironKeepRow).getByRole('button', { name: 'Move to Unfiled Current' })).toBeDisabled();
    expect(within(ironKeepRow).getByRole('button', { name: 'Move to Boss Arenas' })).toBeInTheDocument();
    expect(screen.getByTestId('background-gallery-row-map-3')).toBeInTheDocument();
  });

  test('requests a selected gallery folder change instead of filtering all maps locally', () => {
    const onSelectedFolderIdChange = jest.fn();
    render(<BackgroundGalleryPanel {...buildProps({ onSelectedFolderIdChange })} />);

    const folderFilter = screen.getByRole('button', { name: 'Filter DM Gallery by folder' });
    fireEvent.click(folderFilter);
    fireEvent.click(screen.getByRole('option', { name: 'Boss Arenas' }));

    expect(onSelectedFolderIdChange).toHaveBeenCalledWith('folder-a');
    expect(screen.getByTestId('background-gallery-row-map-1')).toBeInTheDocument();
    expect(screen.getByTestId('background-gallery-row-map-2')).toBeInTheDocument();
  });

  test('opens the folder filter as a dark custom listbox', () => {
    render(<BackgroundGalleryPanel {...buildProps()} />);

    const folderFilter = screen.getByRole('button', { name: 'Filter DM Gallery by folder' });
    expect(screen.queryByRole('combobox', { name: 'Filter DM Gallery by folder' })).not.toBeInTheDocument();

    fireEvent.click(folderFilter);

    const folderListbox = screen.getByRole('listbox', { name: 'Filter DM Gallery by folder options' });
    expect(folderListbox).toHaveClass('bg-slate-950');
    expect(screen.queryByRole('option', { name: 'All folders' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unfiled' })).toHaveAttribute('aria-selected', 'true');
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
