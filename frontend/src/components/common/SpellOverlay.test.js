import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpellOverlay } from './SpellOverlay';

describe('SpellOverlay preview ownership', () => {
  const initialData = {
    Nome: 'Original spell',
    image_url: 'https://example.com/original.png',
    video_url: 'https://example.com/original.mp4',
  };

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn()
        .mockReturnValueOnce('blob:image-one')
        .mockReturnValueOnce('blob:video-one')
        .mockReturnValueOnce('blob:image-two'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('revokes only owned blob previews without resetting edited form state', () => {
    const { unmount } = render(
      <SpellOverlay
        mode="edit"
        schema={{}}
        initialData={initialData}
        onClose={jest.fn()}
      />
    );

    const nameInput = screen.getByPlaceholderText('Spell Name *');
    fireEvent.change(nameInput, { target: { value: 'Edited spell' } });

    const imageInput = screen.getByLabelText('Spell image file');
    const videoInput = screen.getByLabelText('Spell video file');
    fireEvent.change(imageInput, {
      target: { files: [new File(['image-one'], 'one.png', { type: 'image/png' })] },
    });
    fireEvent.change(videoInput, {
      target: { files: [new File(['video-one'], 'one.mp4', { type: 'video/mp4' })] },
    });

    expect(nameInput).toHaveValue('Edited spell');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.change(imageInput, {
      target: { files: [new File(['image-two'], 'two.png', { type: 'image/png' })] },
    });

    expect(nameInput).toHaveValue('Edited spell');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-one');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-two');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-one');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(initialData.image_url);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(initialData.video_url);
  });
});

describe('SpellOverlay save state', () => {
  test('mints a distinct persistent identity for every newly added spell', () => {
    const firstClose = jest.fn();
    const firstRender = render(
      <SpellOverlay schema={{}} onClose={firstClose} />
    );
    fireEvent.change(screen.getByPlaceholderText('Spell Name *'), {
      target: {value: 'First spell'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save Spell'}));
    const firstId = firstClose.mock.calls[0][0].spellData.task07MediaEntryId;
    firstRender.unmount();

    const secondClose = jest.fn();
    render(<SpellOverlay schema={{}} onClose={secondClose} />);
    fireEvent.change(screen.getByPlaceholderText('Spell Name *'), {
      target: {value: 'Second spell'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save Spell'}));
    const secondId = secondClose.mock.calls[0][0].spellData.task07MediaEntryId;

    expect(firstId).toMatch(/^n_[A-Za-z0-9._-]{1,127}$/);
    expect(secondId).toMatch(/^n_[A-Za-z0-9._-]{1,127}$/);
    expect(secondId).not.toBe(firstId);
  });

  test('shows a spinner and disables actions while a spell is saving', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <SpellOverlay
        schema={{}}
        initialData={{ Nome: 'Loading test spell' }}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('button', { name: 'Save Spell' })).toBeEnabled();

    rerender(
      <SpellOverlay
        schema={{}}
        initialData={{ Nome: 'Loading test spell' }}
        isSaving
        onClose={onClose}
      />
    );

    const saveButton = screen.getByRole('button', { name: 'Saving...' });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute('aria-busy', 'true');
    expect(saveButton.querySelector('svg')).toHaveClass('animate-spin');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    fireEvent.click(saveButton);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('reports explicit media removal separately from an unchanged save', () => {
    const onClose = jest.fn();
    render(
      <SpellOverlay
        mode="edit"
        schema={{}}
        initialData={{
          Nome: 'Canonical spell',
          media: {assetId: `m_${'a'.repeat(40)}`},
          videoMedia: {assetId: `m_${'b'.repeat(40)}`},
          task07MediaEntryId: 'spell-entry',
        }}
        onClose={onClose}
      />
    );
    expect(screen.getByAltText('Preview')).toBeInTheDocument();
    expect(screen.getByLabelText('Spell video preview')).toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button', {name: '×'});
    fireEvent.click(removeButtons[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Save Spell'}));
    fireEvent.click(screen.getByRole('button', {
      name: 'Conferma Sovrascrittura',
    }));

    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({
      imageFile: null,
      videoFile: null,
      imageRemoved: true,
      videoRemoved: false,
      spellData: expect.objectContaining({
        task07MediaEntryId: 'spell-entry',
      }),
    }));
  });
});
