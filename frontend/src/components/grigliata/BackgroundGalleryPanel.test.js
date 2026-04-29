import React from 'react';
import { render, screen } from '@testing-library/react';
import BackgroundGalleryPanel from './BackgroundGalleryPanel';

const backgrounds = [{
  id: 'map-1',
  name: 'Sunken Ruins',
  imageUrl: 'https://example.com/map-1.png',
  imageWidth: 1280,
  imageHeight: 720,
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
  grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
}];

const buildProps = (overrides = {}) => ({
  backgrounds,
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
});
