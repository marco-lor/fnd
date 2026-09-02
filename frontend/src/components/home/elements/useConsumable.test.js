import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConsumableActionLayer, useConsumableAction } from './useConsumable';
import {
  commitConsumable,
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  prepareConsumable,
} from '../../../data/userData/userDataCommands';
import logDiceRoll from '../../common/diceLogger';
import { recordTask08Event } from '../../../performance/task08';

jest.mock('../../../data/userData/userDataCommands', () => ({
  commitConsumable: jest.fn(),
  createUserOperationId: jest.fn(),
  isDefinitiveUserDataCommandError: jest.fn((error) => (
    error?.code === 'functions/failed-precondition'
    || error?.code === 'functions/not-found'
  )),
  prepareConsumable: jest.fn(),
}));

jest.mock('../../../performance/task08', () => ({ recordTask08Event: jest.fn() }));
jest.mock('../../common/diceLogger', () => jest.fn(() => Promise.resolve()));

const item = Object.freeze({
  id: 'healing-draught',
  item_type: 'consumabile',
  General: { Nome: 'Healing draught' },
  _task05: { inventoryId: 'inventory-1', revision: 1 },
  qty: 2,
});

const replacementItem = Object.freeze({
  ...item,
  General: { Nome: 'Replacement draught' },
  _task05: { inventoryId: 'inventory-1', revision: 2 },
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const Harness = ({
  currentItem = item,
  generation = 1,
  mode = 'hp',
  ready = true,
  user = { uid: 'user-1' },
}) => {
  const controller = useConsumableAction({
    inventory: currentItem ? [currentItem] : [],
    mutationsReady: ready,
    repositoryAccessGeneration: generation,
    user,
  });
  return (
    <div data-testid="home-tree">
      <button type="button" onClick={() => controller.begin({ item: currentItem, mode })}>
        Begin consumption
      </button>
      <ConsumableActionLayer controller={controller} />
    </div>
  );
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('Home consumable action ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let sequence = 0;
    createUserOperationId.mockImplementation((prefix) => `${prefix}-operation-${++sequence}`);
    isDefinitiveUserDataCommandError.mockImplementation((error) => (
      error?.code === 'functions/failed-precondition'
      || error?.code === 'functions/not-found'
    ));
    commitConsumable.mockResolvedValue({ success: true, replayed: false });
    prepareConsumable.mockResolvedValue({
      preparationId: 'preparation-1', rolls: [], resource: null, replayed: false,
    });
  });

  afterEach(() => { jest.useRealTimers(); });

  test('survives the React Strict Mode mount probe without wedging or cancelling the logical action', async () => {
    render(
      <React.StrictMode>
        <Harness mode={null} />
      </React.StrictMode>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));

    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(1));
    expect(prepareConsumable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Preparazione consumabile…')).not.toBeInTheDocument();
    expect(screen.queryByText('Applicazione autorevole in corso…')).not.toBeInTheDocument();
    expect(recordTask08Event).not.toHaveBeenCalledWith(expect.objectContaining({
      metric: 'consumable-action-cancelled',
    }));
  });

  test('renders authoritative prepared rolls declaratively inside the existing Home tree', async () => {
    jest.useFakeTimers();
    prepareConsumable.mockResolvedValue({
      preparationId: 'preparation-1',
      rolls: [4, 2],
      faces: 6,
      modifier: 1,
      resource: 'hp',
      replayed: false,
    });
    const view = render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    await flush();

    expect(view.container).toContainElement(screen.getByText('Dice:'));
    expect(document.body.children).toHaveLength(1);
    expect(commitConsumable).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(screen.getByText('4 + 2 + 1')).toBeInTheDocument();
    expect(screen.getByText('Result = 7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(1));
    expect(commitConsumable).toHaveBeenCalledWith(expect.objectContaining({
      preparationId: 'preparation-1',
      resource: 'hp',
    }));
  });

  test('deduplicates rapid confirmation into one preparation and one commit', async () => {
    const preparation = deferred();
    prepareConsumable.mockReturnValue(preparation.promise);
    render(<Harness mode={null} />);

    const begin = screen.getByRole('button', { name: 'Begin consumption' });
    fireEvent.click(begin);
    fireEvent.click(begin);
    expect(prepareConsumable).toHaveBeenCalledTimes(1);

    await act(async () => {
      preparation.resolve({ preparationId: 'preparation-1', rolls: [], resource: null });
      await preparation.promise;
    });
    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(1));
  });

  test('cancels before commit and ignores a late preparation completion', async () => {
    const preparation = deferred();
    prepareConsumable.mockReturnValue(preparation.promise);
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel consumable' }));
    expect(screen.queryByText('Preparazione consumabile…')).not.toBeInTheDocument();

    await act(async () => {
      preparation.resolve({
        preparationId: 'preparation-1', rolls: [5], faces: 6, modifier: 0, resource: 'hp',
      });
      await preparation.promise;
    });
    expect(commitConsumable).not.toHaveBeenCalled();
    expect(screen.queryByText('Dice:')).not.toBeInTheDocument();
  });

  test('retries an ambiguous commit with the same preparation and operation identity without rerolling', async () => {
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    commitConsumable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ success: true, replayed: true });
    const view = render(<Harness mode={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    const retry = await screen.findByRole('button', { name: 'Retry consumable' });
    expect(prepareConsumable).toHaveBeenCalledTimes(1);
    expect(commitConsumable).toHaveBeenCalledTimes(1);
    const firstCommit = commitConsumable.mock.calls[0][0];

    view.rerender(<Harness currentItem={null} mode={null} />);
    fireEvent.click(retry);
    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(2));
    expect(commitConsumable.mock.calls[1][0]).toEqual(firstCommit);
    expect(prepareConsumable).toHaveBeenCalledTimes(1);
  });

  test('retries an ambiguous preparation with one stable identity', async () => {
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    prepareConsumable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ preparationId: 'preparation-1', rolls: [], resource: null });
    render(<Harness mode={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry consumable' }));
    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(1));

    expect(prepareConsumable).toHaveBeenCalledTimes(2);
    expect(prepareConsumable.mock.calls[1][0]).toEqual(prepareConsumable.mock.calls[0][0]);
  });

  test('clears ownership after a definitive failure so a later action gets new identities', async () => {
    const invalid = Object.assign(new Error('changed'), { code: 'functions/failed-precondition' });
    prepareConsumable
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce({ preparationId: 'preparation-2', rolls: [], resource: null });
    render(<Harness mode={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    await waitFor(() => expect(isDefinitiveUserDataCommandError).toHaveBeenCalledWith(invalid));
    expect(isDefinitiveUserDataCommandError.mock.results.at(-1)?.value).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss consumable error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(1));

    expect(prepareConsumable).toHaveBeenCalledTimes(2);
    expect(prepareConsumable.mock.calls[1][0].operationId)
      .not.toBe(prepareConsumable.mock.calls[0][0].operationId);
  });

  test.each([
    ['actor loss', { user: null }],
    ['actor change', { user: { uid: 'user-2' } }],
    ['repository generation change', { generation: 2 }],
    ['read-plane freshness loss', { ready: false }],
    ['inventory replacement', { currentItem: replacementItem }],
    ['inventory removal', { currentItem: null }],
  ])('fences %s before commit and ignores late preparation', async (_label, replacementProps) => {
    const preparation = deferred();
    prepareConsumable.mockReturnValue(preparation.promise);
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    view.rerender(<Harness {...replacementProps} />);

    await act(async () => {
      preparation.resolve({
        preparationId: 'preparation-1', rolls: [3], faces: 6, resource: 'hp',
      });
      await preparation.promise;
    });
    expect(commitConsumable).not.toHaveBeenCalled();
    expect(screen.queryByText('Dice:')).not.toBeInTheDocument();
  });

  test('fences animation logging completion after a generation change', async () => {
    jest.useFakeTimers();
    const logging = deferred();
    logDiceRoll.mockReturnValue(logging.promise);
    prepareConsumable.mockResolvedValue({
      preparationId: 'preparation-1', rolls: [6], faces: 6, modifier: 0, resource: 'hp',
    });
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    view.rerender(<Harness generation={2} />);

    await act(async () => {
      logging.resolve();
      await logging.promise;
    });
    expect(commitConsumable).not.toHaveBeenCalled();
  });

  test('does not report an already-dispatched commit as cancelled after unmount', async () => {
    const commit = deferred();
    commitConsumable.mockReturnValue(commit.promise);
    const view = render(<Harness mode={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Begin consumption' }));
    await waitFor(() => expect(commitConsumable).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      commit.resolve({ success: true, replayed: false });
      await commit.promise;
    });
    expect(commitConsumable).toHaveBeenCalledTimes(1);
  });
});
