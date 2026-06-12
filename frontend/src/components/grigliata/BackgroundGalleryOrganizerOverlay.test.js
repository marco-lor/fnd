import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BackgroundGalleryOrganizerOverlay from './BackgroundGalleryOrganizerOverlay';

const folders = [
  { id: 'folder-a', name: 'Boss Arenas' },
  { id: 'folder-b', name: 'Cities' },
];

const backgrounds = [
  {
    id: 'map-1',
    name: 'Dragon Room',
    imageUrl: 'https://example.com/map-1.png',
    imageWidth: 1280,
    imageHeight: 720,
    galleryFolderId: 'folder-a',
  },
  {
    id: 'map-2',
    name: 'Old Harbor',
    imageUrl: 'https://example.com/map-2.png',
    imageWidth: 1920,
    imageHeight: 1080,
  },
];

const buildProps = (overrides = {}) => ({
  isOpen: true,
  backgrounds,
  folders,
  creatingFolderName: '',
  renamingFolderId: '',
  deletingFolderId: '',
  movingBackgroundId: '',
  selectedFolderId: '__unfiled__',
  onClose: jest.fn(),
  onSelectedFolderIdChange: jest.fn(),
  onCreateFolder: jest.fn(),
  onRenameFolder: jest.fn(),
  onDeleteFolder: jest.fn(),
  onMoveBackgroundToFolder: jest.fn(),
  onDeleteBackground: jest.fn(),
  onDeleteBackgrounds: jest.fn(),
  ...overrides,
});

describe('BackgroundGalleryOrganizerOverlay', () => {
  test('creates a folder from the overlay form', () => {
    const onCreateFolder = jest.fn();
    render(<BackgroundGalleryOrganizerOverlay {...buildProps({ onCreateFolder })} />);

    fireEvent.change(screen.getByLabelText('New folder name'), {
      target: { value: 'Catacombs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Folder' }));

    expect(onCreateFolder).toHaveBeenCalledWith('Catacombs');
  });

  test('portals the organizer outside clipped gallery panels', () => {
    const { container } = render(
      <section className="overflow-hidden backdrop-blur-sm" data-testid="clipped-gallery-panel">
        <BackgroundGalleryOrganizerOverlay {...buildProps()} />
      </section>
    );

    const dialog = screen.getByRole('dialog', { name: 'Organize DM Gallery' });

    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  test('renames and deletes existing folders from folder actions', () => {
    const onRenameFolder = jest.fn();
    const onDeleteFolder = jest.fn();
    render(
      <BackgroundGalleryOrganizerOverlay
        {...buildProps({ onRenameFolder, onDeleteFolder })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Boss Arenas' }));
    fireEvent.change(screen.getByLabelText('Rename Boss Arenas'), {
      target: { value: 'Final Rooms' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Boss Arenas' }));

    expect(onRenameFolder).toHaveBeenCalledWith('folder-a', 'Final Rooms');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Cities' }));
    expect(onDeleteFolder).toHaveBeenCalledWith(expect.objectContaining(folders[1]));
  });

  test('moves a background with the click move control', () => {
    const onMoveBackgroundToFolder = jest.fn();
    render(
      <BackgroundGalleryOrganizerOverlay
        {...buildProps({ onMoveBackgroundToFolder })}
      />
    );

    fireEvent.change(screen.getByLabelText('Move Old Harbor to folder'), {
      target: { value: 'folder-b' },
    });

    expect(onMoveBackgroundToFolder).toHaveBeenCalledWith('map-2', 'folder-b');
  });

  test('selects maps and moves them together to another folder', () => {
    const onMoveBackgroundToFolder = jest.fn();
    render(
      <BackgroundGalleryOrganizerOverlay
        {...buildProps({ onMoveBackgroundToFolder })}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all maps' }));
    fireEvent.change(screen.getByLabelText('Move selected maps to folder'), {
      target: { value: 'folder-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected maps' }));

    expect(onMoveBackgroundToFolder).toHaveBeenCalledWith('map-1', 'folder-b');
    expect(onMoveBackgroundToFolder).toHaveBeenCalledWith('map-2', 'folder-b');
  });

  test('deletes one map or the selected maps from the organizer', () => {
    const onDeleteBackground = jest.fn();
    const onDeleteBackgrounds = jest.fn();
    render(
      <BackgroundGalleryOrganizerOverlay
        {...buildProps({ onDeleteBackground, onDeleteBackgrounds })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Dragon Room map' }));
    expect(onDeleteBackground).toHaveBeenCalledWith(expect.objectContaining({ id: 'map-1' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Old Harbor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected maps' }));

    expect(onDeleteBackgrounds).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'map-2' }),
    ]);
  });

  test('moves a background by dragging it onto a folder drop target', () => {
    const onMoveBackgroundToFolder = jest.fn();
    const dataTransfer = {
      setData: jest.fn(),
      getData: jest.fn(() => 'map-2'),
      effectAllowed: '',
      dropEffect: '',
    };
    render(
      <BackgroundGalleryOrganizerOverlay
        {...buildProps({ onMoveBackgroundToFolder })}
      />
    );

    fireEvent.dragStart(screen.getByTestId('gallery-organizer-map-map-2'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('gallery-folder-drop-folder-a'), { dataTransfer });

    expect(onMoveBackgroundToFolder).toHaveBeenCalledWith('map-2', 'folder-a');
  });

  test('switches folders from the sidebar without requiring all folder contents to be loaded', () => {
    const onSelectedFolderIdChange = jest.fn();
    render(
      <BackgroundGalleryOrganizerOverlay
        {...buildProps({
          backgrounds: [],
          selectedFolderId: '__unfiled__',
          onSelectedFolderIdChange,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open folder Boss Arenas' }));

    expect(onSelectedFolderIdChange).toHaveBeenCalledWith('folder-a');
  });

  test('closes from Escape and the backdrop', () => {
    const onClose = jest.fn();
    render(<BackgroundGalleryOrganizerOverlay {...buildProps({ onClose })} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gallery-organizer-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
