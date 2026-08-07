import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetSchema = jest.fn();
const mockSaveSpellForUser = jest.fn();
const mockRun = jest.fn((operation) => operation(undefined));

jest.mock('../../../common/SpellOverlay', () => {
  const ReactModule = jest.requireActual('react');
  return {
    SpellOverlay: ({ isSaving, onClose }) => ReactModule.createElement(
      'button',
      {
        type: 'button',
        disabled: isSaving,
        onClick: () => onClose({
          spellData: { Nome: 'Loading guard spell' },
          imageFile: null,
          videoFile: null,
        }),
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
});
