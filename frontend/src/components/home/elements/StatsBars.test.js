import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useAuthSession } from '../../../AuthContext';
import { useResources } from '../../../data/userData/userDataHooks';
import {
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  updateResource,
} from '../../../data/userData/userDataCommands';
import { getTask08ResourceHoldId, recordTask08Event } from '../../../performance/task08';
import StatsBars from './StatsBars';

jest.mock('../../../AuthContext', () => ({ useAuthSession: jest.fn() }));
jest.mock('../../../data/userData/userDataHooks', () => ({ useResources: jest.fn() }));
jest.mock('../../../data/userData/userDataCommands', () => ({
  updateResource: jest.fn(),
  createUserOperationId: jest.fn((prefix) => `${prefix}-test-operation`),
  isDefinitiveUserDataCommandError: jest.fn((error) => error?.code === 'invalid-argument'),
}));
jest.mock('../../../performance/task08', () => ({
  getTask08ResourceHoldId: jest.fn(() => 'hold-default'),
  recordTask08Event: jest.fn(),
}));

const readyResources = {
  data: {
    stats: {
      hpCurrent: 8,
      hpTotal: 10,
      manaCurrent: 5,
      manaTotal: 10,
      essenzaCurrent: 2,
      essenzaTotal: 5,
      barrieraCurrent: 0,
      barrieraTotal: 0,
    },
  },
  status: 'fresh',
};

const withResourceRevision = (hpCurrent, revision) => ({
  ...readyResources,
  data: {
    ...readyResources.data,
    revision,
    stats: {
      ...readyResources.data.stats,
      hpCurrent,
    },
  },
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

const hpValue = () => screen.getByTitle('-1 HP')
  .parentElement
  ?.querySelector('span[class*="min-w"]')
  ?.textContent;

const pointerEvent = (type, properties) => {
  const result = new Event(type, {bubbles: true, cancelable: true});
  Object.entries(properties).forEach(([key, value]) => {
    Object.defineProperty(result, key, {value});
  });
  return result;
};

describe('StatsBars auth-scoped overlays', () => {
  beforeEach(() => {
    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 0,
    });
    useResources.mockReturnValue(readyResources);
  });

  test('closes the custom resource modal on a UID/access-generation change', () => {
    const { rerender } = render(<StatsBars />);
    fireEvent.click(screen.getByTitle('Aggiungi HP (valore custom)'));
    expect(screen.getByText('Inserisci il valore da aggiungere')).toBeInTheDocument();

    useAuthSession.mockReturnValue({
      user: { uid: 'user-2' },
      repositoryAccessGeneration: 1,
    });
    rerender(<StatsBars />);

    expect(screen.queryByText('Inserisci il valore da aggiungere')).not.toBeInTheDocument();
  });

  test('closes the barrier activation modal on a UID/access-generation change', () => {
    const { rerender } = render(<StatsBars />);
    fireEvent.click(screen.getByTitle('Attiva Barriera'));
    expect(screen.getByRole('heading', { name: 'Attiva Barriera' })).toBeInTheDocument();

    useAuthSession.mockReturnValue({
      user: { uid: 'user-2' },
      repositoryAccessGeneration: 1,
    });
    rerender(<StatsBars />);

    expect(screen.queryByRole('heading', { name: 'Attiva Barriera' })).not.toBeInTheDocument();
  });
});

describe('StatsBars resource gestures', () => {
  beforeEach(() => {
    let operationSequence = 0;
    jest.useFakeTimers();
    updateResource.mockReset();
    updateResource.mockResolvedValue({ replayed: false });
    createUserOperationId.mockImplementation((prefix) => `${prefix}-test-operation-${++operationSequence}`);
    getTask08ResourceHoldId.mockReset();
    getTask08ResourceHoldId.mockReturnValue('hold-default');
    recordTask08Event.mockReset();
    isDefinitiveUserDataCommandError.mockImplementation((error) => error?.code === 'invalid-argument');
    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 0,
    });
    useResources.mockReturnValue(readyResources);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('keeps a short pointer press optimistic and commits one delta on release', async () => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, { pointerType: 'mouse' });

    expect(screen.getByText('7/10', { exact: true })).toBeInTheDocument();
    expect(updateResource).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 });
    });

    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'hp',
      mode: 'delta',
      value: -1,
    }));
  });

  test('batches a two-second hold into its eleven optimistic ticks and one exact delta', async () => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement);
    await act(async () => { jest.advanceTimersByTime(2_000); });

    expect(screen.getByText('-3/10', { exact: true })).toBeInTheDocument();
    expect(updateResource).not.toHaveBeenCalled();

    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });

    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'hp', mode: 'delta', value: -11,
    }));
  });

  test('treats duplicate terminal events as one gesture command', async () => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement);
    await act(async () => {
      fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 });
      fireEvent.pointerCancel(decrement);
    });

    expect(updateResource).toHaveBeenCalledTimes(1);
  });

  test('uses pointer terminals only and ignores a non-primary button', async () => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent(decrement, new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    expect(screen.getByText('8/10', { exact: true })).toBeInTheDocument();
    expect(updateResource).not.toHaveBeenCalled();

    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    fireEvent.mouseUp(decrement);
    expect(updateResource).not.toHaveBeenCalled();

    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });
    expect(updateResource).toHaveBeenCalledTimes(1);
  });

  test.each(['mouse', 'touch', 'pen'])('owns a %s hold by its primary pointer ID', async (pointerType) => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent(decrement, pointerEvent('pointerdown', {
      pointerId: 4, pointerType, isPrimary: false, button: 0,
    }));
    expect(updateResource).not.toHaveBeenCalled();

    fireEvent(decrement, pointerEvent('pointerdown', {
      pointerId: 4, pointerType, isPrimary: true, button: 0,
    }));
    await act(async () => { fireEvent(decrement, pointerEvent('pointerup', {pointerId: 5, pointerType})); });
    expect(updateResource).not.toHaveBeenCalled();

    await act(async () => { fireEvent(decrement, pointerEvent('pointerup', {pointerId: 4, pointerType})); });
    expect(updateResource).toHaveBeenCalledTimes(1);
  });

  test('commits at most once across cancel, lost capture, and release-triggered lost capture', async () => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    decrement.hasPointerCapture = jest.fn(() => true);
    decrement.releasePointerCapture = jest.fn(() => {
      fireEvent.lostPointerCapture(decrement, {pointerType: 'mouse', pointerId: 4});
    });

    fireEvent.pointerDown(decrement, {pointerType: 'mouse', pointerId: 4, button: 0, isPrimary: true});
    await act(async () => { fireEvent.pointerCancel(decrement, {pointerType: 'mouse', pointerId: 4}); });
    expect(updateResource).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.lostPointerCapture(decrement, {pointerType: 'mouse', pointerId: 4});
      fireEvent.pointerUp(decrement, {pointerType: 'mouse', pointerId: 4});
    });
    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(decrement.releasePointerCapture).toHaveBeenCalledTimes(1);
  });

  test('does not retain a timer or command when pointer capture fails', async () => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    decrement.setPointerCapture = jest.fn(() => { throw new Error('capture unavailable'); });

    fireEvent.pointerDown(decrement, {pointerType: 'mouse', pointerId: 4, button: 0, isPrimary: true});
    await act(async () => { jest.advanceTimersByTime(2_000); });
    await act(async () => { fireEvent.pointerUp(decrement, {pointerType: 'mouse', pointerId: 4}); });

    expect(updateResource).not.toHaveBeenCalled();
    expect(hpValue()).toBe('8/10');
  });

  test('keeps keyboard activation as one one-step delta', async () => {
    render(<StatsBars />);
    const increment = screen.getByTitle('+1 HP');

    await act(async () => { fireEvent.click(increment, { detail: 0 }); });

    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'hp', mode: 'delta', value: 1,
    }));
  });

  test('does not turn a pointer release and its synthesized click into two mutations', async () => {
    render(<StatsBars />);
    const increment = screen.getByTitle('+1 HP');

    fireEvent(increment, pointerEvent('pointerdown', {
      pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0,
    }));
    await act(async () => {
      fireEvent(increment, pointerEvent('pointerup', {pointerId: 4, pointerType: 'mouse'}));
      fireEvent.click(increment, {detail: 1});
    });

    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({resource: 'hp', value: 1}));
  });

  test('does not double-apply a source update that arrives before the callable result', async () => {
    const command = deferred();
    updateResource.mockReturnValue(command.promise);
    const { rerender } = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });
    expect(screen.getByText('7/10', { exact: true })).toBeInTheDocument();

    useResources.mockReturnValue(withResourceRevision(7, 2));
    rerender(<StatsBars resourceVersion={2} />);
    expect(hpValue()).toBe('7/10');

    await act(async () => {
      command.resolve({ previousValue: 8, newValue: 7, appliedDelta: -1, newRevision: 2 });
      await command.promise;
    });
    expect(hpValue()).toBe('7/10');
  });

  test('freezes a terminal gesture while an unrelated source update is still ambiguous', async () => {
    const command = deferred();
    updateResource.mockReturnValue(command.promise);
    const { rerender } = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });

    useResources.mockReturnValue(withResourceRevision(6, 2));
    rerender(<StatsBars resourceVersion={2} />);
    expect(hpValue()).toBe('7/10');

    await act(async () => {
      command.resolve({ previousValue: 6, newValue: 5, appliedDelta: -1, newRevision: 3 });
      await command.promise;
    });
    expect(hpValue()).toBe('5/10');
  });

  test('holds the callable result until its newer source revision arrives', async () => {
    const command = deferred();
    updateResource.mockReturnValue(command.promise);
    const { rerender } = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });
    await act(async () => {
      command.resolve({ previousValue: 8, newValue: 7, appliedDelta: -1, newRevision: 2 });
      await command.promise;
    });
    expect(screen.getByText('7/10', { exact: true })).toBeInTheDocument();

    useResources.mockReturnValue(withResourceRevision(7, 2));
    rerender(<StatsBars resourceVersion={2} />);
    expect(hpValue()).toBe('7/10');
  });

  test('retries one ambiguous failure with the same operation identity', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    updateResource
      .mockRejectedValueOnce({ code: 'unavailable' })
      .mockResolvedValueOnce({ previousValue: 8, newValue: 7, appliedDelta: -1, newRevision: 2 });
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });
    await act(async () => { await Promise.resolve(); });

    expect(updateResource).toHaveBeenCalledTimes(2);
    expect(updateResource.mock.calls[1][0].operationId).toBe(updateResource.mock.calls[0][0].operationId);
    expect(hpValue()).toBe('7/10');
    consoleError.mockRestore();
  });

  test('recovers a twice-ambiguous gesture from Retry save with the same identity', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    updateResource
      .mockRejectedValueOnce({ code: 'unavailable' })
      .mockRejectedValueOnce({ code: 'unavailable' })
      .mockResolvedValueOnce({ previousValue: 8, newValue: 7, appliedDelta: -1, newRevision: 2 });
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: 'Retry saving resource change' })).toBeInTheDocument();
    const operationId = updateResource.mock.calls[0][0].operationId;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry saving resource change' })); });
    expect(updateResource).toHaveBeenCalledTimes(3);
    expect(updateResource.mock.calls[2][0].operationId).toBe(operationId);
    consoleError.mockRestore();
  });

  test('uses a new operation ID only after a retained retry has reconciled', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    updateResource
      .mockRejectedValueOnce({code: 'unavailable'})
      .mockRejectedValueOnce({code: 'unavailable'})
      .mockResolvedValueOnce({previousValue: 8, newValue: 7, appliedDelta: -1, newRevision: 2})
      .mockResolvedValueOnce({previousValue: 7, newValue: 6, appliedDelta: -1, newRevision: 3});
    const {rerender} = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, {pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true});
    await act(async () => { fireEvent.pointerUp(decrement, {pointerType: 'mouse', pointerId: 1}); });
    await act(async () => { await Promise.resolve(); });
    const retainedOperationId = updateResource.mock.calls[0][0].operationId;
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Retry saving resource change'})); });
    expect(updateResource.mock.calls[2][0].operationId).toBe(retainedOperationId);

    useResources.mockReturnValue(withResourceRevision(7, 2));
    rerender(<StatsBars resourceVersion="resolved" />);
    fireEvent.pointerDown(decrement, {pointerType: 'mouse', pointerId: 2, button: 0, isPrimary: true});
    await act(async () => { fireEvent.pointerUp(decrement, {pointerType: 'mouse', pointerId: 2}); });
    expect(updateResource).toHaveBeenCalledTimes(4);
    expect(updateResource.mock.calls[3][0].operationId).not.toBe(retainedOperationId);
    consoleError.mockRestore();
  });

  test('keeps an unresolved ambiguous hold frozen against its source snapshot and blocks keyboard mutations', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    updateResource
      .mockRejectedValueOnce({ code: 'unavailable' })
      .mockRejectedValueOnce({ code: 'unavailable' });
    const { rerender } = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    const increment = screen.getByTitle('+1 HP');

    fireEvent.pointerDown(decrement, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(decrement, { pointerType: 'mouse', pointerId: 1 }); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Retry saving resource change' })).toBeInTheDocument();

    // The server may already have applied the first command even though both
    // responses were lost. Rendering that authoritative value must not add
    // the retained delta a second time.
    useResources.mockReturnValue(withResourceRevision(7, 2));
    rerender(<StatsBars resourceVersion={2} />);
    expect(hpValue()).toBe('7/10');

    await act(async () => { fireEvent.click(increment, { detail: 0 }); });
    expect(updateResource).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  test('cancels an active hold when resources cease to be fresh', async () => {
    const { rerender } = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    fireEvent.pointerDown(decrement, { pointerType: 'touch', pointerId: 7, isPrimary: true });
    expect(hpValue()).toBe('7/10');

    useResources.mockReturnValue({data: null, status: 'loading'});
    rerender(<StatsBars resourceVersion="loading" />);
    await act(async () => { jest.advanceTimersByTime(1_000); });

    expect(updateResource).not.toHaveBeenCalled();
  });

  test.each([
    ['pointerup', (button) => fireEvent(button, pointerEvent('pointerup', {pointerId: 4, pointerType: 'mouse'}))],
    ['pointercancel', (button) => fireEvent(button, pointerEvent('pointercancel', {pointerId: 4, pointerType: 'mouse'}))],
    ['lost capture', (button) => fireEvent(button, pointerEvent('lostpointercapture', {pointerId: 4, pointerType: 'mouse'}))],
  ])('clears the hold interval after %s', async (_terminal, dispatchTerminal) => {
    render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    fireEvent(decrement, pointerEvent('pointerdown', {
      pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0,
    }));
    expect(jest.getTimerCount()).toBe(1);

    await act(async () => { dispatchTerminal(decrement); });
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => { jest.advanceTimersByTime(1_000); });
    expect(updateResource).toHaveBeenCalledTimes(1);
  });

  test('clears the interval on freshness cancellation and component unmount', async () => {
    const {rerender, unmount} = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    fireEvent(decrement, pointerEvent('pointerdown', {
      pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0,
    }));
    expect(jest.getTimerCount()).toBe(1);

    useResources.mockReturnValue({data: null, status: 'loading'});
    rerender(<StatsBars freshnessLoss />);
    expect(jest.getTimerCount()).toBe(0);

    useResources.mockReturnValue(readyResources);
    rerender(<StatsBars freshAgain />);
    const currentDecrement = screen.getByTitle('-1 HP');
    fireEvent(currentDecrement, pointerEvent('pointerdown', {
      pointerId: 5, pointerType: 'mouse', isPrimary: true, button: 0,
    }));
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('fences an in-flight result after actor, freshness, or unmount invalidation', async () => {
    const command = deferred();
    updateResource.mockReturnValue(command.promise);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const {rerender, unmount} = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent.pointerDown(decrement, {pointerType: 'mouse', pointerId: 4, button: 0, isPrimary: true});
    await act(async () => { fireEvent.pointerUp(decrement, {pointerType: 'mouse', pointerId: 4}); });
    expect(updateResource).toHaveBeenCalledTimes(1);

    useAuthSession.mockReturnValue({user: {uid: 'user-2'}, repositoryAccessGeneration: 1});
    rerender(<StatsBars actorChange />);
    useResources.mockReturnValue({data: null, status: 'loading'});
    rerender(<StatsBars freshnessChange />);
    unmount();
    await act(async () => {
      command.reject({code: 'unavailable'});
      await Promise.resolve();
    });

    expect(updateResource).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', {name: 'Retry saving resource change'})).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  test.each([
    ['actor scope', () => useAuthSession.mockReturnValue({user: {uid: 'user-2'}, repositoryAccessGeneration: 1})],
    ['freshness', () => useResources.mockReturnValue({data: null, status: 'loading'})],
  ])('fences late successful and ambiguous results after %s invalidation', async (_kind, invalidate) => {
    const successful = deferred();
    const ambiguous = deferred();
    updateResource.mockReturnValueOnce(successful.promise).mockReturnValueOnce(ambiguous.promise);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const {rerender} = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent(decrement, pointerEvent('pointerdown', {pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0}));
    await act(async () => { fireEvent(decrement, pointerEvent('pointerup', {pointerId: 4, pointerType: 'mouse'})); });
    invalidate();
    rerender(<StatsBars invalidated />);
    await act(async () => {
      successful.resolve({previousValue: 8, newValue: 7, appliedDelta: -1, newRevision: 2});
      await successful.promise;
    });

    useResources.mockReturnValue(readyResources);
    useAuthSession.mockReturnValue({user: {uid: 'user-1'}, repositoryAccessGeneration: 0});
    rerender(<StatsBars restored />);
    const restoredDecrement = screen.getByTitle('-1 HP');
    fireEvent(restoredDecrement, pointerEvent('pointerdown', {pointerId: 5, pointerType: 'mouse', isPrimary: true, button: 0}));
    await act(async () => { fireEvent(restoredDecrement, pointerEvent('pointerup', {pointerId: 5, pointerType: 'mouse'})); });
    invalidate();
    rerender(<StatsBars invalidatedAgain />);
    await act(async () => {
      ambiguous.reject({code: 'unavailable'});
      await Promise.resolve();
    });

    expect(updateResource).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', {name: 'Retry saving resource change'})).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('fences a late definitive rejection after freshness loss', async () => {
    const command = deferred();
    updateResource.mockReturnValue(command.promise);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const {rerender} = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');
    fireEvent(decrement, pointerEvent('pointerdown', {pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0}));
    await act(async () => { fireEvent(decrement, pointerEvent('pointerup', {pointerId: 4, pointerType: 'mouse'})); });
    useResources.mockReturnValue({data: null, status: 'loading'});
    rerender(<StatsBars stale />);
    await act(async () => {
      command.reject({code: 'invalid-argument'});
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', {name: 'Retry saving resource change'})).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('fences an in-flight manual Retry save after its actor scope is invalidated', async () => {
    const manualRetry = deferred();
    updateResource
      .mockRejectedValueOnce({code: 'unavailable'})
      .mockRejectedValueOnce({code: 'unavailable'})
      .mockReturnValueOnce(manualRetry.promise);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const {rerender} = render(<StatsBars />);
    const decrement = screen.getByTitle('-1 HP');

    fireEvent(decrement, pointerEvent('pointerdown', {pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0}));
    await act(async () => {
      fireEvent(decrement, pointerEvent('pointerup', {pointerId: 4, pointerType: 'mouse'}));
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', {name: 'Retry saving resource change'}));
    expect(updateResource).toHaveBeenCalledTimes(3);
    consoleError.mockClear();

    useAuthSession.mockReturnValue({user: {uid: 'user-2'}, repositoryAccessGeneration: 1});
    rerender(<StatsBars actorChange />);
    await act(async () => {
      manualRetry.reject({code: 'unavailable'});
      await Promise.resolve();
    });

    expect(updateResource).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('button', {name: 'Retry saving resource change'})).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('captures a hold ID at start and propagates it to the terminal and command', async () => {
    const { rerender } = render(<StatsBars />);
    const barrierData = {
      ...readyResources,
      data: {
        ...readyResources.data,
        stats: {...readyResources.data.stats, barrieraCurrent: 9, barrieraTotal: 10},
      },
    };
    useResources.mockReturnValue(barrierData);
    rerender(<StatsBars resourceVersion="barrier-start" />);
    getTask08ResourceHoldId.mockReturnValueOnce('hold-at-start').mockReturnValue('hold-later');
    const increment = screen.getByTitle('+1 Barriera');

    fireEvent.pointerDown(increment, { pointerType: 'mouse', pointerId: 3, button: 0, isPrimary: true });
    await act(async () => { fireEvent.pointerUp(increment, { pointerType: 'mouse', pointerId: 3 }); });

    expect(updateResource).toHaveBeenCalledWith(expect.objectContaining({resource: 'barriera', value: 1}));
    expect(recordTask08Event).toHaveBeenCalledWith(expect.objectContaining({
      metric: 'resource-gesture-terminal',
      tags: expect.objectContaining({holdId: 'hold-at-start', effectiveDelta: 1}),
    }));
    expect(getTask08ResourceHoldId).toHaveBeenCalledTimes(1);
  });
});
