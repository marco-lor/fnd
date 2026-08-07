import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetSchema = jest.fn();
const mockSaveSpellForUser = jest.fn();
const mockRun = jest.fn((operation) => operation(undefined));
let mockOverlayResult;

jest.mock('../../../common/SpellOverlay', () => {
  const ReactModule = jest.requireActual('react');
  return {
    SpellOverlay: ({ isSaving, onClose }) => ReactModule.createElement(
      'button',
      {
        type: 'button',
        disabled: isSaving,
        onClick: () => onClose(mockOverlayResult),
      },
      isSaving ? 'Saving...' : 'Save Spell',
    ),
  };
});

jest.mock('../../../firebaseConfig', () => ({ db: {} }));

jest.mock('../../../../performance/firestore', () => ({
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
}));

jest.mock('../../../common/userOwnedMedia', () => ({
  saveSpellForUser: (...args) => mockSaveSpellForUser(...args),
}));

jest.mock('../../../common/legacyMediaStorage', () => ({
  deleteLegacyStoragePath: jest.fn(() => Promise.resolve()),
  uploadLegacyBlob: jest.fn(),
  uploadLegacyImage: jest.fn(),
}));

jest.mock('../../../../data/configRepository', () => ({
  getSchema: (...args) => mockGetSchema(...args),
}));

jest.mock('../../../../data/media/useTask07MediaOperationOwner', () => ({
  __esModule: true,
  default: () => ({ run: mockRun }),
}));

const { AddSpellOverlay } = require('./addSpell');

describe('AddSpellOverlay save state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockImplementation((operation) => operation(undefined));
    mockGetSchema.mockResolvedValue({});
    mockOverlayResult = {
      spellData: { Nome: 'Loading guard spell' },
      imageFile: null,
      videoFile: null,
    };
  });

  test('keeps one save in flight and closes only after it completes', async () => {
    let resolveSave;
    mockSaveSpellForUser.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    const onClose = jest.fn();

    render(
      <AddSpellOverlay
        userId="marco-test"
        userLabel="MarcoTEST"
        onClose={onClose}
      />
    );

    const saveButton = await screen.findByRole('button', { name: 'Save Spell' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(mockSaveSpellForUser).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(mockSaveSpellForUser).toHaveBeenCalledTimes(1);
  });

  test('rolls back item media when the Firestore save fails', async () => {
    const firestore = require('../../../../performance/firestore');
    const storage = require('../../../common/legacyMediaStorage');
    const saveError = new Error('write failed');
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ spells: {} }),
    });
    firestore.updateDoc.mockRejectedValue(saveError);
    storage.uploadLegacyImage.mockResolvedValue({
      downloadUrl: 'https://example.test/image',
      storagePath: 'spells/item-spell-image',
    });
    storage.uploadLegacyBlob.mockResolvedValue({
      downloadUrl: 'https://example.test/video',
      storagePath: 'spells/videos/item-spell-video',
    });
    mockOverlayResult = {
      spellData: { Nome: 'Item spell' },
      imageFile: new File(['image'], 'spell.png', { type: 'image/png' }),
      videoFile: new File(['video'], 'spell.mp4', { type: 'video/mp4' }),
    };
    const onClose = jest.fn();

    render(
      <AddSpellOverlay
        userId="marco-test"
        userLabel="MarcoTEST"
        savePath={{ id: 'item-1', type: 'item' }}
        onClose={onClose}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Save Spell' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(false));
    expect(storage.deleteLegacyStoragePath.mock.calls.map(([path]) => path))
      .toEqual([
        'spells/item-spell-image',
        'spells/videos/item-spell-video',
      ]);
    consoleErrorSpy.mockRestore();
    alertSpy.mockRestore();
  });
});
