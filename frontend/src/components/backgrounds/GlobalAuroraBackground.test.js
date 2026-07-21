import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { withAsyncResourceOwner } from '../../performance/runtime';
import GlobalAuroraBackground from './GlobalAuroraBackground';

jest.mock('../../performance/runtime', () => ({
  withAsyncResourceOwner: jest.fn((_owner, callback) => callback()),
}));

describe('GlobalAuroraBackground', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    withAsyncResourceOwner.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('keeps one click listener across rerenders and clears scheduled work on unmount', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    const { rerender, unmount } = render(
      <GlobalAuroraBackground density={80} />
    );

    const clickRegistration = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'click');
    expect(clickRegistration).toBeDefined();

    rerender(<GlobalAuroraBackground density={100} />);

    expect(addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === 'click')).toHaveLength(1);

    fireEvent.click(window, { clientX: 120, clientY: 80 });

    expect(withAsyncResourceOwner).toHaveBeenCalledTimes(2);
    expect(withAsyncResourceOwner.mock.calls.every(([owner]) => owner === 'shell')).toBe(true);

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', clickRegistration[1]);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
