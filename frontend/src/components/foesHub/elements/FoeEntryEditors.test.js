import React, {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import SpellsEditor from './SpellsEditor';
import TecnicheEditor from './TecnicheEditor';

jest.mock('../../common/MediaImage', () => ({
  __esModule: true,
  default: ({alt, media, src}) => (
    <img alt={alt} src={src} data-asset-id={media?.media?.assetId || ''} />
  ),
  hasMediaAsset: (value) => Boolean(
    value?.media?.assetId || value?.imageUrl
  ),
}));

jest.mock('../../common/useObjectUrl', () => ({
  __esModule: true,
  default: (file) => (file ? 'blob:entry-preview' : ''),
}));

const Harness = ({Editor}) => {
  const [value, setValue] = useState([]);
  return (
    <>
      <Editor value={value} onChange={setValue} />
      <output data-testid="entry-state">{JSON.stringify(value)}</output>
    </>
  );
};

describe.each([
  ['technique', TecnicheEditor, '+ Add Tecnica'],
  ['spell', SpellsEditor, '+ Add Spell'],
])('%s image selection', (_label, Editor, addLabel) => {
  test('delete and re-add at the same index mints a distinct identity', () => {
    render(<Harness Editor={Editor} />);
    fireEvent.click(screen.getByRole('button', {name: addLabel}));
    const first = JSON.parse(screen.getByTestId('entry-state').textContent)[0]
      .task07MediaEntryId;
    expect(first).toMatch(/^n_[A-Za-z0-9._-]{1,127}$/);

    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
    fireEvent.click(screen.getByRole('button', {name: addLabel}));
    const second = JSON.parse(screen.getByTestId('entry-state').textContent)[0]
      .task07MediaEntryId;
    expect(second).toMatch(/^n_[A-Za-z0-9._-]{1,127}$/);
    expect(second).not.toBe(first);
  });

  test('remounts the file input after removal so the same file can be selected', () => {
    render(<Harness Editor={Editor} />);
    fireEvent.click(screen.getByRole('button', {name: addLabel}));

    const firstInput = document.querySelector('input[type="file"]');
    const file = new File(['image'], 'same.png', {type: 'image/png'});
    fireEvent.change(firstInput, {target: {files: [file]}});
    expect(screen.getByRole('button', {name: 'Remove'})).toBeInTheDocument();

    const selectedInput = document.querySelector('input[type="file"]');
    fireEvent.click(screen.getByRole('button', {name: 'Remove'}));
    const clearedInput = document.querySelector('input[type="file"]');

    expect(clearedInput).not.toBe(selectedInput);
    expect(clearedInput.value).toBe('');
    fireEvent.change(clearedInput, {target: {files: [file]}});
    expect(screen.getByRole('button', {name: 'Remove'})).toBeInTheDocument();
  });

  test('previews and explicitly removes canonical-only nested media', () => {
    const assetId = `m_${'a'.repeat(40)}`;
    const onChange = jest.fn();
    render(<Editor value={[{
      name: 'Canonical entry',
      media: {assetId},
      task07MediaEntryId: 'entry-a',
    }]} onChange={onChange} />);

    expect(screen.getByAltText('Canonical entry')).toHaveAttribute(
      'data-asset-id',
      assetId
    );
    fireEvent.click(screen.getByRole('button', {name: 'Remove'}));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        task07MediaEntryId: 'entry-a',
        imageFile: null,
        imageUrl: '',
        removeImage: true,
      }),
    ]);
  });
});
