// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Node-environment suites (e.g. local Firestore emulator tests) have no DOM.
if (typeof window !== 'undefined') {
  Object.defineProperties(window.HTMLMediaElement.prototype, {
    play: { configurable: true, value: jest.fn().mockResolvedValue(undefined) },
    pause: { configurable: true, value: jest.fn() },
    load: { configurable: true, value: jest.fn() },
  });
}
