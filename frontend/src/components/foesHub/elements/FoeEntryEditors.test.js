import React, {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import SpellsEditor from './SpellsEditor';
import TecnicheEditor from './TecnicheEditor';

jest.mock('../../common/MediaImage', () => ({
  __esModule: true,
  default: ({alt, src}) => <img alt={alt} src={src} />,
}));

jest.mock('../../common/useObjectUrl', () => ({
  __esModule: true,
  default: (file) => (file ? 'blob:entry-preview' : ''),
}));

const Harness = ({Editor}) => {
  const [value, setValue] = useState([]);
  return <Editor value={value} onChange={setValue} />;
};

describe.each([
  ['technique', TecnicheEditor, '+ Add Tecnica'],
  ['spell', SpellsEditor, '+ Add Spell'],
])('%s image selection', (_label, Editor, addLabel) => {
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
});
