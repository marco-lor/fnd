import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FoeFormModal from './FoeFormModal';

jest.mock('./lazyFoeEditors', () => ({
  ParametersEditor: () => null,
  ParamTotalsPreview: () => null,
  SpellsEditor: () => null,
  StatsEditor: () => null,
  TecnicheEditor: () => null,
}));

jest.mock('../../common/MediaImage', () => {
  const ReactModule = require('react');
  const canonicalAssetId = (value) => (
    value?.media?.assetId || value?.General?.media?.assetId || ''
  );
  return {
    __esModule: true,
    default: ({ alt, media, src }) => ReactModule.createElement('img', {
      alt,
      'data-media-asset': canonicalAssetId(media),
      'data-preview-src': src || '',
    }),
    hasMediaAsset: (value) => Boolean(
      canonicalAssetId(value) || value?.imageUrl
    ),
  };
});

jest.mock('../../common/useObjectUrl', () => ({
  __esModule: true,
  default: (file) => (file ? 'blob:local-preview' : ''),
}));

const ASSET_ID = `m_${'a'.repeat(40)}`;
const canonicalMedia = {
  assetId: ASSET_ID,
  state: 'ready',
  original: {path: `media_assets/v1/dm-only/dm/${ASSET_ID}/7/original`},
};

const baseFoe = (overrides = {}) => ({
  name: 'Canonical foe',
  Parametri: {},
  spells: [],
  stats: {level: 2},
  tecniche: [],
  ...overrides,
});

const renderModal = (initial, props = {}) => {
  const onCancel = jest.fn();
  const onSave = jest.fn();
  render(
    <FoeFormModal
      open
      initial={initial}
      onCancel={onCancel}
      onSave={onSave}
      schema={{}}
      {...props}
    />
  );
  return {onCancel, onSave};
};

describe('FoeFormModal media lifecycle', () => {
  test('preserves dirty form values when a save error rerenders the open modal', () => {
    const onCancel = jest.fn();
    const onSave = jest.fn();
    const renderView = (initial, error = '') => (
      <FoeFormModal
        open
        initial={initial}
        onCancel={onCancel}
        onSave={onSave}
        schema={{}}
        error={error}
      />
    );
    const view = render(renderView(baseFoe()));

    fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {
      target: {value: 'Unsaved audit foe'},
    });
    view.rerender(renderView(baseFoe(), 'Save failed.'));

    expect(screen.getByRole('alert')).toHaveTextContent('Save failed.');
    expect(screen.getByRole('textbox', {name: 'Name'})).toHaveValue(
      'Unsaved audit foe'
    );
  });

  test.each([
    ['root', baseFoe({media: canonicalMedia})],
    ['General', baseFoe({General: {media: canonicalMedia}})],
  ])('previews a %s canonical binding and submits removal without mutating it', (
    _location,
    initial
  ) => {
    const {onSave} = renderModal(initial);
    expect(screen.getByAltText('preview')).toHaveAttribute(
      'data-media-asset',
      ASSET_ID
    );

    fireEvent.click(screen.getByRole('button', {name: 'Remove image'}));
    expect(screen.queryByAltText('preview')).not.toBeInTheDocument();
    expect(screen.getByText('No Img')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining(initial),
      expect.objectContaining({imageFile: null, removeImage: true})
    );
  });

  test('a local file preview takes precedence over persisted canonical media', async () => {
    renderModal(baseFoe({
      imageUrl: 'https://legacy.example/foe.png',
      media: canonicalMedia,
    }));
    const file = new File(['image'], 'replacement.png', {type: 'image/png'});
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: {files: [file]},
    });

    await waitFor(() => {
      expect(screen.getByAltText('preview')).toHaveAttribute(
        'data-preview-src',
        'blob:local-preview'
      );
    });
    expect(screen.getByAltText('preview')).toHaveAttribute(
      'data-media-asset',
      ''
    );
  });

  test('clears a removed local file so the same file can be selected again', async () => {
    renderModal(baseFoe({name: 'New foe'}));
    const input = document.querySelector('input[type="file"]');
    const file = new File(['image'], 'same.png', {type: 'image/png'});
    fireEvent.change(input, {target: {files: [file]}});
    Object.defineProperty(input, 'value', {
      configurable: true,
      value: 'C:\\fakepath\\same.png',
      writable: true,
    });

    fireEvent.click(screen.getByRole('button', {name: 'Remove image'}));

    expect(input.value).toBe('');
    expect(screen.queryByRole('button', {name: 'Undo remove'}))
      .not.toBeInTheDocument();
    fireEvent.change(input, {target: {files: [file]}});
    await waitFor(() => {
      expect(screen.getByAltText('preview')).toHaveAttribute(
        'data-preview-src',
        'blob:local-preview'
      );
    });
  });

  test('undo restores the persisted preview and busy failures stay in the modal', () => {
    const initial = baseFoe({General: {media: canonicalMedia}});
    renderModal(initial, {busy: true, error: 'Retirement failed.'});

    expect(screen.getByRole('alert')).toHaveTextContent('Retirement failed.');
    expect(screen.getByRole('button', {name: 'Saving...'})).toBeDisabled();
  });

  test('undo restores a canonical preview before save', () => {
    renderModal(baseFoe({General: {media: canonicalMedia}}));
    fireEvent.click(screen.getByRole('button', {name: 'Remove image'}));
    fireEvent.click(screen.getByRole('button', {name: 'Undo remove'}));
    expect(screen.getByAltText('preview')).toHaveAttribute(
      'data-media-asset',
      ASSET_ID
    );
  });
});
