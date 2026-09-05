import React from 'react';
import {
  classifyCharacterCreationCodex,
  classifyCharacterCreationVarie,
  loadCharacterCreationData,
  useCharacterCreationData,
} from './characterCreationData';
import { act, renderHook, waitFor } from '@testing-library/react';
import { getCodex } from '../../data/codexRepository';
import { getVarie } from '../../data/configRepository';

jest.mock('../../data/codexRepository', () => ({
  getCodex: jest.fn(),
  invalidateCodex: jest.fn(),
}));
jest.mock('../../data/configRepository', () => ({
  getVarie: jest.fn(),
  invalidateConfig: jest.fn(),
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe('Character Creation route data resource', () => {
  beforeEach(() => {
    getCodex.mockReset();
    getVarie.mockReset();
  });

  test('starts Codex and Varie reads before either deferred result settles', async () => {
    const codex = deferred();
    const varie = deferred();
    getCodex.mockReturnValue(codex.promise);
    getVarie.mockReturnValue(varie.promise);

    const snapshotPromise = loadCharacterCreationData();
    expect(getCodex).toHaveBeenCalledTimes(1);
    expect(getVarie).toHaveBeenCalledTimes(1);

    codex.resolve({ Razze: { Elfo: 'Agile and perceptive.' } });
    varie.resolve({ modAnima: { Spirito: { Saggezza: 2 } } });
    await expect(snapshotPromise).resolves.toEqual({
      codex: { Razze: { Elfo: 'Agile and perceptive.' } },
      codexStatus: 'ready',
      varie: { modAnima: { Spirito: { Saggezza: 2 } } },
      varieStatus: 'ready',
    });
  });

  test('propagates transport failure while classifying valid missing and malformed payloads', async () => {
    const failure = new Error('read denied');
    getCodex.mockRejectedValue(failure);
    getVarie.mockResolvedValue({ modAnima: { Spirito: { Saggezza: 2 } } });

    await expect(loadCharacterCreationData()).rejects.toBe(failure);
    expect(classifyCharacterCreationCodex(null)).toEqual({ data: null, status: 'missing' });
    expect(classifyCharacterCreationCodex({ categoria_00: { entry: 'legacy' } }).status).toBe('missing');
    expect(classifyCharacterCreationCodex({ Razze: [] }).status).toBe('malformed');
    expect(classifyCharacterCreationVarie({ modAnima: [] }).status).toBe('malformed');
    expect(classifyCharacterCreationVarie(null)).toEqual({ data: null, status: 'missing' });
  });

  test('publishes Codex as usable while Varie remains pending', async () => {
    const codex = deferred();
    const varie = deferred();
    getCodex.mockReturnValue(codex.promise);
    getVarie.mockReturnValue(varie.promise);
    const { result } = renderHook(() => useCharacterCreationData({
      uid: 'player-a',
      repositoryAccessGeneration: 1,
      enabled: true,
    }));

    await waitFor(() => expect(getCodex).toHaveBeenCalledTimes(1));
    expect(getVarie).toHaveBeenCalledTimes(1);
    await act(async () => {
      codex.resolve({ Razze: { Elfo: 'Agile and perceptive.' } });
      await codex.promise;
    });

    await waitFor(() => expect(result.current.codexStatus).toBe('ready'));
    expect(result.current.codex).toEqual({ Razze: { Elfo: 'Agile and perceptive.' } });
    expect(result.current.varieStatus).toBe('loading');
    expect(result.current.varie).toBeNull();

    await act(async () => {
      varie.resolve({ modAnima: { Spirito: { Saggezza: 2 } } });
      await varie.promise;
    });
  });

  test('retries only a rejected Varie dependency and preserves fulfilled Codex', async () => {
    const varieFailure = new Error('varie unavailable');
    getCodex.mockResolvedValue({ Razze: { Elfo: 'Agile and perceptive.' } });
    getVarie
      .mockRejectedValueOnce(varieFailure)
      .mockResolvedValueOnce({ modAnima: { Spirito: { Saggezza: 2 } } });
    const { result } = renderHook(() => useCharacterCreationData({
      uid: 'player-a',
      repositoryAccessGeneration: 1,
      enabled: true,
    }));

    await waitFor(() => expect(result.current.varieStatus).toBe('error'));
    expect(result.current.codexStatus).toBe('ready');
    expect(result.current.codex).toEqual({ Razze: { Elfo: 'Agile and perceptive.' } });
    expect(result.current.retryVarie).toEqual(expect.any(Function));

    await act(async () => {
      result.current.retryVarie();
    });
    await waitFor(() => expect(result.current.varieStatus).toBe('ready'));
    expect(getCodex).toHaveBeenCalledTimes(1);
    expect(getVarie).toHaveBeenCalledTimes(2);
    expect(result.current.codex).toEqual({ Razze: { Elfo: 'Agile and perceptive.' } });
  });

  test('retries only a rejected Codex dependency while Varie remains fulfilled', async () => {
    const codexFailure = new Error('codex unavailable');
    getCodex
      .mockRejectedValueOnce(codexFailure)
      .mockResolvedValueOnce({ Razze: { Elfo: 'Agile and perceptive.' } });
    getVarie.mockResolvedValue({ modAnima: { Spirito: { Saggezza: 2 } } });
    const { result } = renderHook(() => useCharacterCreationData({
      uid: 'player-a',
      repositoryAccessGeneration: 1,
      enabled: true,
    }));

    await waitFor(() => expect(result.current.codexStatus).toBe('error'));
    expect(result.current.varieStatus).toBe('ready');
    expect(result.current.retryCodex).toEqual(expect.any(Function));

    await act(async () => {
      result.current.retryCodex();
    });
    await waitFor(() => expect(result.current.codexStatus).toBe('ready'));
    expect(getCodex).toHaveBeenCalledTimes(2);
    expect(getVarie).toHaveBeenCalledTimes(1);
  });

  test('fences stale resource results after an actor or generation scope change', async () => {
    const actorACodex = deferred();
    const actorAVarie = deferred();
    const actorBCodex = deferred();
    const actorBVarie = deferred();
    getCodex
      .mockReturnValueOnce(actorACodex.promise)
      .mockReturnValueOnce(actorBCodex.promise);
    getVarie
      .mockReturnValueOnce(actorAVarie.promise)
      .mockReturnValueOnce(actorBVarie.promise);
    const { result, rerender } = renderHook(
      ({ uid, generation }) => useCharacterCreationData({
        uid,
        repositoryAccessGeneration: generation,
        enabled: true,
      }),
      { initialProps: { uid: 'player-a', generation: 1 } }
    );

    await waitFor(() => expect(getCodex).toHaveBeenCalledTimes(1));
    rerender({ uid: 'player-b', generation: 2 });
    await waitFor(() => expect(getCodex).toHaveBeenCalledTimes(2));
    await act(async () => {
      actorACodex.resolve({ Razze: { Stale: 'stale' } });
      actorAVarie.resolve({ modAnima: { Stale: {} } });
      await Promise.all([actorACodex.promise, actorAVarie.promise]);
    });
    expect(result.current.codex).toBeNull();

    actorBCodex.resolve({ Razze: { Elfo: 'Agile and perceptive.' } });
    actorBVarie.resolve({ modAnima: { Spirito: { Saggezza: 2 } } });
    await waitFor(() => expect(result.current.codex).toEqual({
      Razze: { Elfo: 'Agile and perceptive.' },
    }));
  });

  test('does not dispatch a pending resource completion after the hook unmounts', async () => {
    const codex = deferred();
    const varie = deferred();
    getCodex.mockReturnValue(codex.promise);
    getVarie.mockReturnValue(varie.promise);
    const setterSpies = [];
    const originalUseState = React.useState;
    const useStateSpy = jest.spyOn(React, 'useState').mockImplementation((initialValue) => {
      const [value, setValue] = originalUseState(initialValue);
      const setter = jest.fn(setValue);
      setterSpies.push(setter);
      return [value, setter];
    });

    try {
      const { unmount } = renderHook(() => useCharacterCreationData({
        uid: 'player-a',
        repositoryAccessGeneration: 1,
        enabled: true,
      }));

      await waitFor(() => expect(getCodex).toHaveBeenCalledTimes(1));
      const callsBeforeUnmount = setterSpies.map((setter) => setter.mock.calls.length);
      unmount();

      await act(async () => {
        codex.resolve({ Razze: { Stale: 'stale' } });
        varie.reject(new Error('late varie failure'));
        await Promise.allSettled([codex.promise, varie.promise]);
      });

      expect(setterSpies.map((setter) => setter.mock.calls.length)).toEqual(callsBeforeUnmount);
    } finally {
      useStateSpy.mockRestore();
    }
  });
});
