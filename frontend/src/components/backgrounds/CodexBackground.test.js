import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CodexBackground from './CodexBackground';
let media; let mediaChange;
beforeEach(() => {
  jest.useFakeTimers(); media = { matches: false, addEventListener: jest.fn((_type, fn) => { mediaChange = fn; }), removeEventListener: jest.fn() };
  window.matchMedia = jest.fn(() => media); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(() => { jest.useRealTimers(); });
test('only explicit background hits spawn; UI and window clicks do not', () => {
  const view = render(<div><CodexBackground /><button>UI control</button><h1>Codex</h1></div>); const surface = view.container.querySelector('.codex-background');
  fireEvent.click(screen.getByText('UI control')); fireEvent.click(screen.getByText('Codex')); fireEvent.click(window);
  expect(view.container.querySelectorAll('.codex-quasar')).toHaveLength(0);
  fireEvent.click(surface, { clientX: 20, clientY: 30 }); expect(view.container.querySelectorAll('.codex-quasar')).toHaveLength(1);
  act(() => jest.advanceTimersByTime(2500)); expect(view.container.querySelectorAll('.codex-quasar')).toHaveLength(0);
  view.unmount(); expect(jest.getTimerCount()).toBe(0);
});
test('reduced motion prevents timers and pulses; preference changes clear work', () => {
  media.matches = true; const view = render(<CodexBackground />); const surface = view.container.firstChild;
  expect(surface).toHaveAttribute('data-paused', 'true'); expect(jest.getTimerCount()).toBe(0);
  fireEvent.click(surface); expect(view.container.querySelectorAll('.codex-quasar')).toHaveLength(0);
  act(() => { media.matches = false; mediaChange(); }); fireEvent.click(surface); expect(jest.getTimerCount()).toBe(2);
  act(() => { media.matches = true; mediaChange(); }); expect(jest.getTimerCount()).toBe(0); expect(view.container.querySelectorAll('.codex-quasar')).toHaveLength(0);
  view.unmount(); expect(media.removeEventListener).toHaveBeenCalledWith('change', mediaChange);
});
test('hidden tabs pause CSS, clear timeouts and resume one interval', () => {
  const view = render(<CodexBackground />); const surface = view.container.firstChild;
  fireEvent.click(surface); fireEvent.click(surface); expect(jest.getTimerCount()).toBe(3);
  act(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(surface).toHaveAttribute('data-paused', 'true'); expect(jest.getTimerCount()).toBe(0); fireEvent.click(surface); expect(view.container.querySelectorAll('.codex-quasar')).toHaveLength(0);
  act(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(jest.getTimerCount()).toBe(1); view.unmount(); expect(jest.getTimerCount()).toBe(0);
});
