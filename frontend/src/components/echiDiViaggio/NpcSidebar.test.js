import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NpcSidebar from './NpcSidebar';
import { onSnapshot } from 'firebase/firestore';

jest.mock('../firebaseConfig', () => ({
  db: {},
  storage: {},
}));

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(() => Promise.resolve()),
  collection: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  deleteDoc: jest.fn(() => Promise.resolve()),
  doc: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  getDocs: jest.fn(() => Promise.resolve({ empty: true, forEach: jest.fn() })),
  onSnapshot: jest.fn((target, onNext) => {
    onNext({ docs: [] });
    return () => {};
  }),
  orderBy: jest.fn((field, direction) => ({ field, direction })),
  query: jest.fn((base) => base),
  serverTimestamp: jest.fn(() => ({ seconds: 0 })),
  updateDoc: jest.fn(() => Promise.resolve()),
  where: jest.fn((field, op, value) => ({ field, op, value })),
  writeBatch: jest.fn(() => ({
    delete: jest.fn(),
    commit: jest.fn(() => Promise.resolve()),
  })),
}));

jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(() => Promise.resolve()),
  getDownloadURL: jest.fn(() => Promise.resolve('https://example.com/npc.png')),
  ref: jest.fn((storage, path) => ({ storage, path })),
  uploadBytes: jest.fn(() => Promise.resolve()),
}));

jest.mock('framer-motion', () => {
  const React = require('react');

  return {
    AnimatePresence: ({ children }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: () => React.forwardRef(({ children, ...props }, ref) => (
          <div ref={ref} {...props}>
            {children}
          </div>
        )),
      }
    ),
    useReducedMotion: () => true,
  };
});

function HoverStateHarness() {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div>
      <div data-testid="hover-state">{isHovered ? 'hovered' : 'idle'}</div>
      <NpcSidebar
        user={{ uid: 'user-1' }}
        userData={{ role: 'dm' }}
        stickyOffset={104}
        onHoverStateChange={setIsHovered}
        canDragToMap={false}
      />
    </div>
  );
}

describe('NpcSidebar', () => {
  beforeEach(() => {
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [] });
      return () => {};
    });
  });

  test('reports hover state without triggering cross-component render warnings', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<HoverStateHarness />);

    const emptyState = await screen.findByText('No NPCs yet.');
    const listContainer = emptyState.parentElement;
    fireEvent.mouseEnter(listContainer);

    await waitFor(() => expect(screen.getByTestId('hover-state')).toHaveTextContent('hovered'));

    const hasCrossComponentWarning = consoleErrorSpy.mock.calls.some((call) =>
      call.some((entry) => String(entry).includes('Cannot update a component'))
    );

    expect(hasCrossComponentWarning).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});
