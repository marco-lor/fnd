import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import { useAuthSession } from '../../../AuthContext';
import {
  useEquipment,
  useInventory,
  useResources,
} from '../../../data/userData/userDataHooks';
import {
  adjustGold,
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  mutateInventory,
} from '../../../data/userData/userDataCommands';
import {
  isUserDataCommandStageResolved,
  runVersionedUserDataCommand,
} from '../../../data/userData/userDataCommandRouting';
import { uploadCacheableImage } from '../../common/imageStorage';
import Inventory from './Inventory';

jest.mock('../../../AuthContext', () => ({ useAuthSession: jest.fn() }));
jest.mock('../../../data/userData/userDataHooks', () => ({
  useEquipment: jest.fn(),
  useInventory: jest.fn(),
  useResources: jest.fn(),
}));
jest.mock('../../../data/userData/userDataCommands', () => ({
  adjustGold: jest.fn(),
  createUserOperationId: jest.fn(),
  isDefinitiveUserDataCommandError: jest.fn(),
  mutateInventory: jest.fn(),
}));
jest.mock('../../../data/userData/legacyUserDataCommands', () => ({
  legacyAdjustGold: jest.fn(),
  legacyMutateInventory: jest.fn(),
}));
jest.mock('../../../data/userData/userDataCommandRouting', () => ({
  isUserDataCommandStageResolved: jest.fn(() => true),
  runVersionedUserDataCommand: jest.fn(),
}));
jest.mock('../../firebaseStorage', () => ({ storage: {} }));
jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(),
  ref: jest.fn((_storage, path) => ({ path })),
}));
jest.mock('../../common/imageStorage', () => ({ uploadCacheableImage: jest.fn() }));
jest.mock('./lazyHomeFeatures', () => ({
  LazyItemDetailsModal: jest.fn(() => null),
}));
jest.mock('./ConfirmDeleteModal', () => jest.fn(() => null));

const readyInventory = {
  data: [{
    id: 'rope',
    name: 'Rope',
    type: 'varie',
    qty: 1,
    _instance: { instanceId: 'rope-1' },
  }],
  status: 'fresh',
  stage: 'legacy-read',
};

describe('Inventory command safety', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 0,
    });
    useInventory.mockReturnValue(readyInventory);
    useEquipment.mockReturnValue({ data: { slots: {} }, status: 'fresh' });
    useResources.mockReturnValue({
      data: { stats: { gold: 100 } },
      status: 'fresh',
      stage: 'legacy-read',
    });
    createUserOperationId.mockImplementation((prefix) => `${prefix}-fixed`);
    isUserDataCommandStageResolved.mockReturnValue(true);
    isDefinitiveUserDataCommandError.mockImplementation((error) => (
      error?.code === 'functions/invalid-argument'
    ));
    runVersionedUserDataCommand.mockImplementation(({ authoritative }) => authoritative());
    uploadCacheableImage.mockResolvedValue({ downloadUrl: 'https://example.test/rope.png' });
    storageRef.mockImplementation((_storage, path) => ({ path }));
    deleteObject.mockResolvedValue(undefined);
    if (!URL.createObjectURL) URL.createObjectURL = jest.fn(() => 'blob:preview');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => consoleError.mockRestore());

  test('keeps the Varie creator gated while the inventory rollout stage is unresolved', () => {
    useInventory.mockReturnValue({ ...readyInventory, status: 'loading', stage: null });

    render(<Inventory />);

    const openButton = screen.getByTitle('Aggiungi oggetto Varie');
    expect(openButton).toBeDisabled();
    fireEvent.click(openButton);
    expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument();
    expect(uploadCacheableImage).not.toHaveBeenCalled();
  });

  test('reuses one logical retry key for an ambiguous gold adjustment', async () => {
    adjustGold
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce({ success: true });

    render(<Inventory />);
    fireEvent.click(screen.getByTitle('Aggiungi oro'));
    fireEvent.change(screen.getByPlaceholderText('Es. 10'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(adjustGold).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Conferma' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(adjustGold).toHaveBeenCalledTimes(2));

    expect(adjustGold.mock.calls[0][0].retryKey).toBe('user-1:0:gold-flow-fixed');
    expect(adjustGold.mock.calls[1][0].retryKey).toBe('user-1:0:gold-flow-fixed');
    await waitFor(() => expect(screen.queryByPlaceholderText('Es. 10')).not.toBeInTheDocument());
  });

  test('uploads a Varie image once and reuses it with one retry key after an ambiguous result', async () => {
    mutateInventory
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce({ success: true });
    const { container } = render(<Inventory />);

    fireEvent.click(screen.getByTitle('Aggiungi oggetto Varie'));
    fireEvent.change(screen.getByPlaceholderText('Es. Corda di canapa'), { target: { value: 'Lanterna' } });
    const file = new File(['image'], 'lamp.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Aggiungi' }).at(-1));
    await waitFor(() => expect(mutateInventory).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(
      screen.getAllByRole('button', { name: 'Aggiungi' }).at(-1)
    ).not.toBeDisabled());

    fireEvent.click(screen.getAllByRole('button', { name: 'Aggiungi' }).at(-1));
    await waitFor(() => expect(mutateInventory).toHaveBeenCalledTimes(2));

    expect(uploadCacheableImage).toHaveBeenCalledTimes(1);
    expect(mutateInventory.mock.calls[0][0].retryKey).toBe('user-1:0:varie-flow-fixed');
    expect(mutateInventory.mock.calls[1][0].retryKey).toBe('user-1:0:varie-flow-fixed');
    expect(mutateInventory.mock.calls[1][0].snapshot.image_url).toBe('https://example.test/rope.png');
    await waitFor(() => expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument());
  });

  test('deletes an uploaded Varie image after a definitive downstream rejection', async () => {
    mutateInventory.mockRejectedValueOnce(Object.assign(
      new Error('invalid item'),
      { code: 'functions/invalid-argument' }
    ));
    const { container } = render(<Inventory />);

    fireEvent.click(screen.getByTitle('Aggiungi oggetto Varie'));
    fireEvent.change(screen.getByPlaceholderText('Es. Corda di canapa'), { target: { value: 'Lanterna' } });
    const file = new File(['image'], 'lamp.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Aggiungi' }).at(-1));

    await waitFor(() => expect(deleteObject).toHaveBeenCalledWith({ path: expect.stringContaining('items/varie_user-1_') }));
    expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument();
  });

  test('closes the Varie draft immediately on a UID/access-generation change', () => {
    const { rerender } = render(<Inventory />);
    fireEvent.click(screen.getByTitle('Aggiungi oggetto Varie'));
    expect(screen.getByText('Aggiungi oggetto "Varie"')).toBeInTheDocument();

    useAuthSession.mockReturnValue({
      user: { uid: 'user-2' },
      repositoryAccessGeneration: 1,
    });
    rerender(<Inventory />);

    expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument();
    expect(mutateInventory).not.toHaveBeenCalled();
  });
});
