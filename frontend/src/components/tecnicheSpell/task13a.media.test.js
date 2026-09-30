import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PersonalMediaEditor from './elements/personalMediaEditor';
import { saveSpellForUser, saveTecnicaForUser } from '../common/userOwnedMedia';
import { getTask07MediaPurpose } from '../../data/media/mediaPolicy';

jest.mock('../common/userOwnedMedia', () => ({ saveSpellForUser: jest.fn(), saveTecnicaForUser: jest.fn() }));
jest.mock('../common/MediaImage', () => () => null);
jest.mock('../common/MediaVideo', () => () => null);
jest.mock('../common/useObjectUrl', () => () => null);
jest.mock('../../data/media/useTask07MediaOperationOwner', () => () => ({ run: task => task(null) }));

test.each(['spell', 'tecnica'])('%s rejects unsupported and oversized media before the save/upload entrypoint', itemType => {
  render(<PersonalMediaEditor userId="hero" itemType={itemType} itemName="Uno" itemData={{ Nome: 'Uno' }} onClose={jest.fn()} />);
  const image = screen.getByLabelText('Immagine');
  fireEvent.change(image, { target: { files: [new File(['gif'], 'image.gif', { type: 'image/gif' })] } });
  expect(screen.getByRole('alert')).toHaveTextContent('not supported');
  expect(screen.getByRole('button', { name: 'Salva Media' })).toBeDisabled();
  const video = screen.getByLabelText('Video');
  const purpose = itemType === 'spell' ? 'spell-video' : 'technique-video';
  const oversized = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  Object.defineProperty(oversized, 'size', { value: getTask07MediaPurpose(purpose).maxBytes + 1 });
  fireEvent.change(video, { target: { files: [oversized] } });
  expect(screen.getAllByRole('alert').some(node => node.textContent.includes('size limit'))).toBe(true);
  expect(saveSpellForUser).not.toHaveBeenCalled();
  expect(saveTecnicaForUser).not.toHaveBeenCalled();
  fireEvent.change(image, { target: { files: [new File(['jpg'], 'image.jpg', { type: 'image/jpeg' })] } });
  fireEvent.change(video, { target: { files: [new File(['mp4'], 'clip.mp4', { type: 'video/mp4' })] } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Salva Media' })).toBeEnabled();
});
