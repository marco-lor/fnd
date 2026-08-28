import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import useTask07MediaOperationOwner from '../../../data/media/useTask07MediaOperationOwner';
import { tryPersistTask07VarieMedia } from '../../../data/media/privateInventoryMediaWriter';
import {
  describeTask07ConsumerOutcome,
  task07ConsumerNeedsAttention,
} from '../../../data/media/mediaConsumerAdapter';
import useCatalogItemsById from '../../../data/useCatalogItemsById';
import Inventory, { buildInventoryView } from './Inventory';
import { recordTask08Event } from '../../../performance/task08';

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
jest.mock('../../../data/media/useTask07MediaOperationOwner', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../data/media/privateInventoryMediaWriter', () => ({
  tryPersistTask07VarieMedia: jest.fn(),
}));
jest.mock('../../../data/media/mediaConsumerAdapter', () => ({
  describeTask07ConsumerOutcome: jest.fn(),
  task07ConsumerNeedsAttention: jest.fn(),
}));
jest.mock('../../../data/useCatalogItemsById', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('./lazyHomeFeatures', () => ({
  LazyItemDetailsModal: jest.fn(() => null),
}));
jest.mock('./ConfirmDeleteModal', () => jest.fn(() => null));
jest.mock('../../../performance/task08', () => ({
  recordTask08Event: jest.fn(),
}));

const readyInventory = {
  data: [{
    id: 'rope',
    name: 'Rope',
    type: 'varie',
    qty: 1,
    _instance: { instanceId: 'rope-1' },
  }],
  status: 'fresh',
};

const openVarieDraft = () => {
  fireEvent.click(screen.getByTitle('Aggiungi oggetto Varie'));
  fireEvent.change(screen.getByPlaceholderText('Es. Corda di canapa'), {
    target: { value: 'Lanterna' },
  });
};

const submitVarieDraft = () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Aggiungi' }).at(-1));
};

describe('Inventory command safety', () => {
  let consoleError;
  let operationRun;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    operationRun = jest.fn((operation) => operation({ aborted: false }));
    useTask07MediaOperationOwner.mockReturnValue({ run: operationRun });
    useCatalogItemsById.mockReturnValue({ itemsById: {}, status: 'fresh', error: null });
    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 0,
    });
    useInventory.mockReturnValue(readyInventory);
    useEquipment.mockReturnValue({ data: { slots: {} }, status: 'fresh' });
    useResources.mockReturnValue({
      data: { stats: { gold: 100 } },
      status: 'fresh',
    });
    createUserOperationId.mockImplementation((prefix) => `${prefix}-fixed`);
    isDefinitiveUserDataCommandError.mockImplementation((error) => (
      error?.code === 'functions/invalid-argument'
    ));
    adjustGold.mockResolvedValue({ success: true });
    mutateInventory.mockResolvedValue({ success: true });
    tryPersistTask07VarieMedia.mockResolvedValue({
      inventoryId: 'varie-1',
      outcome: { state: 'complete' },
    });
    task07ConsumerNeedsAttention.mockReturnValue(false);
    describeTask07ConsumerOutcome.mockReturnValue('Inventory image requires attention.');
    if (!URL.createObjectURL) URL.createObjectURL = jest.fn(() => 'blob:preview');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => consoleError.mockRestore());

  test('keeps the Varie creator gated while canonical inventory is loading', () => {
    useInventory.mockReturnValue({ ...readyInventory, status: 'loading' });

    render(<Inventory />);

    const openButton = screen.getByTitle('Aggiungi oggetto Varie');
    expect(openButton).toBeDisabled();
    fireEvent.click(openButton);
    expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument();
    expect(tryPersistTask07VarieMedia).not.toHaveBeenCalled();
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

  test('reuses one logical retry key for a Varie item without media', async () => {
    mutateInventory
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce({ success: true });
    render(<Inventory />);
    openVarieDraft();

    submitVarieDraft();
    await waitFor(() => expect(mutateInventory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: 'Aggiungi' }).at(-1)
    ).not.toBeDisabled());
    submitVarieDraft();
    await waitFor(() => expect(mutateInventory).toHaveBeenCalledTimes(2));

    expect(mutateInventory.mock.calls[0][0].retryKey).toBe('user-1:0:varie-flow-fixed');
    expect(mutateInventory.mock.calls[1][0].retryKey).toBe('user-1:0:varie-flow-fixed');
    expect(tryPersistTask07VarieMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument());
  });

  test('creates a Varie item with media through one canonical Task 07 operation', async () => {
    const { container } = render(<Inventory />);
    openVarieDraft();
    fireEvent.change(screen.getByPlaceholderText('Dettagli opzionali'), {
      target: { value: 'Luce schermata' },
    });
    fireEvent.change(container.querySelector('input[type="number"]'), { target: { value: '3' } });
    const file = new File(['image'], 'lamp.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

    submitVarieDraft();
    await waitFor(() => expect(tryPersistTask07VarieMedia).toHaveBeenCalledTimes(1));

    expect(operationRun).toHaveBeenCalledTimes(1);
    expect(tryPersistTask07VarieMedia).toHaveBeenCalledWith({
      userId: 'user-1',
      snapshot: {
        name: 'Lanterna',
        description: 'Luce schermata',
        type: 'varie',
        item_type: 'varie',
      },
      quantity: 3,
      file,
      signal: { aborted: false },
    });
    expect(mutateInventory).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Aggiungi oggetto "Varie"')).not.toBeInTheDocument());
  });

  test('fails closed and keeps the Varie draft when canonical media is unavailable', async () => {
    tryPersistTask07VarieMedia.mockResolvedValueOnce(null);
    const { container } = render(<Inventory />);
    openVarieDraft();
    const file = new File(['image'], 'lamp.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

    submitVarieDraft();

    expect(await screen.findByText('Canonical media is unavailable. Nothing was saved.')).toBeInTheDocument();
    expect(screen.getByText('Aggiungi oggetto "Varie"')).toBeInTheDocument();
    expect(mutateInventory).not.toHaveBeenCalled();
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
    expect(tryPersistTask07VarieMedia).not.toHaveBeenCalled();
  });

  test('records an inventory filter only after commit and deduplicates an unchanged summary', async () => {
    const { rerender } = render(<Inventory />);

    await waitFor(() => expect(recordTask08Event).toHaveBeenCalledTimes(1));
    rerender(<Inventory />);
    expect(recordTask08Event).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('Cerca nome o tipo…'), {
      target: { value: 'rope' },
    });
    await waitFor(() => expect(recordTask08Event).toHaveBeenCalledTimes(2));
  });

  test('joins canonical-only Bazaar media into a purchased display entity in memory', () => {
    const catalogMedia = { assetId: `m_${'a'.repeat(40)}` };
    const purchased = {
      id: 'sword-1',
      General: { Nome: 'Spada' },
      item_type: 'weapon',
      _task05: {
        inventoryId: 'purchase-receipt-1',
        catalogItemId: 'sword-1',
      },
    };

    const view = buildInventoryView([purchased], { slots: {} }, {
      'sword-1': { id: 'sword-1', media: catalogMedia, task07MediaRevision: 4 },
    });

    expect(view.items[0].doc.media).toBe(catalogMedia);
    expect(view.items[0].doc.task07MediaRevision).toBe(4);
    expect(purchased).not.toHaveProperty('media');
  });});
