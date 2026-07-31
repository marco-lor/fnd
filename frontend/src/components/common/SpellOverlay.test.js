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
