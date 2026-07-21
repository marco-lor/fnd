import React from 'react';
import { render } from '@testing-library/react';
import { useAuthSession, useShellProfile } from '../AuthContext';
import {
  isPerformanceEnabled,
  markRouteEffectsMounted,
  markRouteShellVisible,
  startRouteMeasurement,
} from './runtime';
import RoutePerformanceObserver from './RoutePerformanceObserver';

let mockLocation;

jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
}), { virtual: true });

jest.mock('../AuthContext', () => ({
  useAuthSession: jest.fn(),
  useShellProfile: jest.fn(),
}));

jest.mock('./runtime', () => ({
  isPerformanceEnabled: jest.fn(),
  markRouteEffectsMounted: jest.fn(),
  markRouteShellVisible: jest.fn(),
  startRouteMeasurement: jest.fn(),
}));

describe('RoutePerformanceObserver', () => {
  let originalAnimationFrame;
  let originalCancelAnimationFrame;

  beforeEach(() => {
    jest.clearAllMocks();
    originalAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = jest.fn((callback) => {
      callback();
      return 1;
    });
    window.cancelAnimationFrame = jest.fn();
    isPerformanceEnabled.mockReturnValue(true);
    mockLocation = { pathname: '/codex' };
    useShellProfile.mockReturnValue({ shellProfile: null });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test('does not declare effects mounted until authentication is authoritative', () => {
    useAuthSession.mockReturnValue({ authReady: false });
    const view = render(<RoutePerformanceObserver />);

    expect(startRouteMeasurement).toHaveBeenCalledWith('/codex', 'unknown');
    expect(markRouteShellVisible).toHaveBeenCalledTimes(1);
    expect(markRouteEffectsMounted).not.toHaveBeenCalled();

    useAuthSession.mockReturnValue({ authReady: true });
    view.rerender(<RoutePerformanceObserver />);

    expect(markRouteEffectsMounted).toHaveBeenCalledTimes(1);
  });
});
