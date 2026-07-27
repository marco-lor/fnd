import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { withAsyncResourceOwner } from '../../performance/runtime';
import GlobalAuroraBackground, {
  MAX_AURORA_MOBILE_STAR_COUNT,
  MAX_AURORA_SHOOTING_STARS,
  MAX_AURORA_STAR_COUNT,
} from './GlobalAuroraBackground';

jest.mock('../../performance/runtime', () => ({
  withAsyncResourceOwner: jest.fn((_owner, callback) => callback()),
}));

describe('GlobalAuroraBackground', () => {
  let visibilityState;
  let reducedMotion;
  let mediaQueryListeners;
  let originalMatchMedia;
  let originalVisibilityState;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    withAsyncResourceOwner.mockClear();
    withAsyncResourceOwner.mockImplementation((_owner, callback) => callback());

    visibilityState = 'visible';
    reducedMotion = false;
    mediaQueryListeners = new Set();
    originalMatchMedia = window.matchMedia;
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    window.matchMedia = jest.fn(() => ({
      matches: reducedMotion,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: (_eventName, listener) => mediaQueryListeners.add(listener),
      removeEventListener: (_eventName, listener) => mediaQueryListeners.delete(listener),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      delete document.visibilityState;
    }
  });

  test('uses two bounded star-field nodes instead of one node per requested star', () => {
    const { container } = render(<GlobalAuroraBackground density={MAX_AURORA_STAR_COUNT * 10} />);

    expect(container.querySelectorAll('.global-aurora__star-field')).toHaveLength(2);
    expect(container.querySelectorAll('.global-aurora__twinkle')).toHaveLength(0);
    expect(MAX_AURORA_STAR_COUNT).toBeLessThan(140);
    expect(MAX_AURORA_SHOOTING_STARS).toBeLessThanOrEqual(3);
  });

  test('halves decorative star density on a mobile viewport', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
    try {
      const { container } = render(<GlobalAuroraBackground density={500} />);
      const renderedStarCount = Array.from(
        container.querySelectorAll('.global-aurora__star-field')
      ).reduce((total, field) => (
        total + (field.style.boxShadow ? field.style.boxShadow.split('),').length : 0)
      ), 0);
      expect(renderedStarCount).toBe(MAX_AURORA_MOBILE_STAR_COUNT);
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  test('keeps one click listener across rerenders and clears scheduled work on unmount', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');

    const { rerender, unmount } = render(<GlobalAuroraBackground density={80} />);
    const clickRegistration = addEventListenerSpy.mock.calls.find(([eventName]) => eventName === 'click');
    expect(clickRegistration).toBeDefined();

    rerender(<GlobalAuroraBackground density={100} />);
    expect(addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === 'click')).toHaveLength(1);

    fireEvent.click(window, { button: 0, clientX: 120, clientY: 80 });
    expect(withAsyncResourceOwner).toHaveBeenCalledTimes(2);
    expect(withAsyncResourceOwner.mock.calls.every(([owner]) => owner === 'shell')).toBe(true);

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', clickRegistration[1]);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('ignores ordinary control clicks while allowing a decorative surface click', () => {
    const { container } = render(<GlobalAuroraBackground />);
    const button = document.createElement('button');
    const surface = document.createElement('div');
    document.body.append(button, surface);

    try {
      fireEvent.click(button, { button: 0, clientX: 10, clientY: 20 });
      expect(container.querySelectorAll('.shooting-star')).toHaveLength(0);
      expect(withAsyncResourceOwner).toHaveBeenCalledTimes(1);

      fireEvent.click(surface, { button: 0, clientX: 30, clientY: 40 });
      expect(container.querySelectorAll('.shooting-star')).toHaveLength(1);
      expect(withAsyncResourceOwner).toHaveBeenCalledTimes(2);
    } finally {
      button.remove();
      surface.remove();
    }
  });

  test('caps outstanding decorative click timeouts under rapid input', () => {
    const { container } = render(<GlobalAuroraBackground />);

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(window, {
        button: 0,
        clientX: 30 + index,
        clientY: 40 + index,
      });
    }

    expect(container.querySelectorAll('.shooting-star'))
      .toHaveLength(MAX_AURORA_SHOOTING_STARS);
    expect(withAsyncResourceOwner)
      .toHaveBeenCalledTimes(1 + MAX_AURORA_SHOOTING_STARS);
  });

  test('does not schedule animation work when reduced motion is preferred', () => {
    reducedMotion = true;
    const { container } = render(<GlobalAuroraBackground />);

    expect(container.firstChild).toHaveClass('global-aurora--paused');
    expect(withAsyncResourceOwner).not.toHaveBeenCalled();

    fireEvent.click(window, { button: 0, clientX: 20, clientY: 30 });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(container.querySelectorAll('.shooting-star')).toHaveLength(0);
    expect(withAsyncResourceOwner).not.toHaveBeenCalled();
  });

  test('stops intervals and clears pending shooting stars while the document is hidden', () => {
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    const { container } = render(<GlobalAuroraBackground />);

    fireEvent.click(window, { button: 0, clientX: 20, clientY: 30 });
    expect(container.querySelectorAll('.shooting-star')).toHaveLength(1);

    act(() => {
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(container.firstChild).toHaveClass('global-aurora--paused');
    expect(container.querySelectorAll('.shooting-star')).toHaveLength(0);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(window, { button: 0, clientX: 50, clientY: 60 });
    expect(container.querySelectorAll('.shooting-star')).toHaveLength(0);
  });

  test('removes expired timeout handles and stays flat during a ten-minute soak', () => {
    let nextTimerId = 1;
    const pendingTimeouts = new Map();
    const activeIntervals = new Map();
    jest.spyOn(window, 'setTimeout').mockImplementation((callback) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      pendingTimeouts.set(timerId, callback);
      return timerId;
    });
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout').mockImplementation((timerId) => {
      pendingTimeouts.delete(timerId);
    });
    jest.spyOn(window, 'setInterval').mockImplementation((callback) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      activeIntervals.set(timerId, callback);
      return timerId;
    });
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval').mockImplementation((timerId) => {
      activeIntervals.delete(timerId);
    });
    const { container, unmount } = render(<GlobalAuroraBackground />);

    fireEvent.click(window, { button: 0, clientX: 20, clientY: 30 });
    expect(container.querySelectorAll('.shooting-star')).toHaveLength(1);
    expect(pendingTimeouts.size).toBe(1);
    expect(activeIntervals.size).toBe(1);

    act(() => {
      const callbacks = Array.from(pendingTimeouts.values());
      pendingTimeouts.clear();
      callbacks.forEach((callback) => callback());
    });
    expect(container.querySelectorAll('.shooting-star')).toHaveLength(0);
    expect(pendingTimeouts.size).toBe(0);

    Math.random.mockReturnValue(0.9);
    act(() => {
      for (let elapsedMs = 0; elapsedMs < 10 * 60 * 1000; elapsedMs += 8000) {
        Array.from(activeIntervals.values()).forEach((callback) => callback());
      }
    });
    expect(container.querySelectorAll('.shooting-star')).toHaveLength(0);
    expect(pendingTimeouts.size).toBe(0);
    expect(activeIntervals.size).toBe(1);

    unmount();
    expect(clearTimeoutSpy).not.toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(activeIntervals.size).toBe(0);
  });
});
