import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NpcSidebar from './NpcSidebar';
import { addDoc, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc } from '../../performance/firestore';
import { isTask07MediaV1WriteEnabled } from '../../data/media/mediaFeatureFlags';
import { runTask07ConsumerUpload, runWithTask07MediaOperationReceipt } from '../../data/media/mediaConsumerAdapter';
import { deleteObject } from 'firebase/storage';

jest.mock('../../data/media/mediaFeatureFlags', () => ({
  ...jest.requireActual('../../data/media/mediaFeatureFlags'),
  isTask07MediaV1WriteEnabled: jest.fn(),
}));

jest.mock('../../data/media/mediaConsumerAdapter', () => ({
  ...jest.requireActual('../../data/media/mediaConsumerAdapter'),
  runTask07ConsumerUpload: jest.fn(),
  runWithTask07MediaOperationReceipt: jest.fn(),
}));

jest.mock('../firebaseConfig', () => ({
  db: {},
  storage: {},
}));
jest.mock('../firebaseStorage', () => ({ storage: {} }));

jest.mock('../../performance/firestore', () => ({
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
  setDoc: jest.fn(() => Promise.resolve()),
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
  const Div = React.forwardRef(({ children, initial, animate, exit, transition, ...props }, ref) => (
    <div ref={ref} {...props}>{children}</div>
  ));

  return {
    AnimatePresence: ({ children }) => <>{children}</>,
    motion: { div: Div },
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
    jest.clearAllMocks();
    isTask07MediaV1WriteEnabled.mockResolvedValue(false);
    serverTimestamp.mockReturnValue({ seconds: 0 });
    if (!URL.createObjectURL) URL.createObjectURL = jest.fn(() => 'blob:npc-preview');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = jest.fn();
    doc.mockImplementation((db, ...segments) => ({
      path: segments.join('/'),
    }));
    getDocs.mockResolvedValue({ empty: true, forEach: jest.fn() });
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [] });
      return () => {};
    });
  });

  const renderWithNpc = (extraNpcs = []) => {
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [{ id: 'npc-guide', data: () => ({
        nome: 'Guide', description: 'A local guide', notes: 'Final note',
      }) }, ...extraNpcs] });
      return () => {};
    });
    return render(<NpcSidebar user={{ uid: 'dm-1' }} userData={{ role: 'dm' }} stickyOffset={104} />);
  };

  test('bounds the popup to a 320 CSS pixel viewport and makes long content scrollable', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    window.innerWidth = 320;
    window.innerHeight = 240;
    const bounds = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('role') === 'dialog') {
        return { left: 0, right: 304, top: 0, bottom: 600, width: 304, height: 600 };
      }
      return { left: 280, right: 312, top: 212, bottom: 232, width: 32, height: 20 };
    });
    try {
      renderWithNpc();
      fireEvent.focus(screen.getByRole('button', { name: /Guide/ }));
      const popup = screen.getByRole('dialog', { name: /Guide/ });
      expect(popup).toHaveStyle({ position: 'fixed', left: '8px', top: '8px', width: '304px', maxHeight: '224px', overflowY: 'auto' });
      expect(popup).toHaveTextContent('Final note');
    } finally {
      bounds.mockRestore();
      window.innerWidth = originalWidth;
      window.innerHeight = originalHeight;
    }
  });

  test('keeps the focused NPC action owner when a different tile is hovered', () => {
    jest.useFakeTimers();
    try {
      renderWithNpc([{ id: 'npc-scout', data: () => ({ nome: 'Scout', notes: 'Scout note' }) }]);
      const guide = screen.getByRole('button', { name: /Guide/ });
      const scout = screen.getByRole('button', { name: /Scout/ });
      act(() => guide.focus());
      const guidePopup = screen.getByRole('dialog', { name: 'NPC: Guide' });
      const editGuide = screen.getByRole('button', { name: 'Edit' });
      act(() => editGuide.focus());
      fireEvent.mouseEnter(scout);
      fireEvent.mouseLeave(scout);
      act(() => jest.advanceTimersByTime(300));
      expect(editGuide).toHaveFocus();
      expect(screen.getByRole('dialog', { name: 'NPC: Guide' })).toBe(guidePopup);
      expect(screen.queryByRole('dialog', { name: 'NPC: Scout' })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('ArrowDown enters its initiating NPC after a different tile is hovered', () => {
    renderWithNpc([{ id: 'npc-scout', data: () => ({ nome: 'Scout', notes: 'Scout note' }) }]);
    const guide = screen.getByRole('button', { name: /Guide/ });
    const scout = screen.getByRole('button', { name: /Scout/ });
    act(() => guide.focus());
    fireEvent.mouseEnter(scout);
    fireEvent.keyDown(guide, { key: 'ArrowDown' });
    expect(screen.getByRole('dialog', { name: 'NPC: Guide' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'NPC: Scout' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(guide).toHaveFocus();
    fireEvent.keyDown(guide, { key: 'ArrowDown' });
    expect(screen.getByRole('dialog', { name: 'NPC: Guide' })).toHaveFocus();
  });

  test('explicit activation can select another NPC while the first popup owns focus', () => {
    jest.useFakeTimers();
    try {
      renderWithNpc([{ id: 'npc-scout', data: () => ({ nome: 'Scout', notes: 'Scout note' }) }]);
      const guide = screen.getByRole('button', { name: /Guide/ });
      const scout = screen.getByRole('button', { name: /Scout/ });
      act(() => guide.focus());
      act(() => screen.getByRole('button', { name: 'Edit' }).focus());
      fireEvent.mouseEnter(screen.getByRole('dialog', { name: 'NPC: Guide' }));
      fireEvent.click(scout);
      expect(screen.getByRole('dialog', { name: 'NPC: Scout' })).toHaveFocus();
      expect(screen.queryByRole('dialog', { name: 'NPC: Guide' })).not.toBeInTheDocument();
      act(() => screen.getByRole('button', { name: '+ Add NPC' }).focus());
      act(() => jest.advanceTimersByTime(300));
      expect(screen.queryByRole('dialog', { name: 'NPC: Scout' })).not.toBeInTheDocument();
      fireEvent.click(scout);
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByDisplayValue('Scout')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Scout note')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('keeps the popup open while focus moves from its tile into its actions', () => {
    jest.useFakeTimers();
    try {
      renderWithNpc();
      const tile = screen.getByRole('button', { name: /Guide/ });
      act(() => tile.focus());
      fireEvent.keyDown(tile, { key: 'ArrowDown' });
      expect(screen.getByRole('dialog', { name: /Guide/ })).toHaveFocus();
      const edit = screen.getByRole('button', { name: 'Edit' });
      act(() => edit.focus());
      act(() => jest.advanceTimersByTime(300));
      expect(edit).toHaveFocus();
      expect(screen.getByRole('dialog', { name: /Guide/ })).toBeInTheDocument();
      act(() => screen.getByRole('button', { name: '+ Add NPC' }).focus());
      act(() => jest.advanceTimersByTime(300));
      expect(screen.queryByRole('dialog', { name: /Guide/ })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Escape dismisses the popup, restores its trigger and does not immediately reopen it', () => {
    renderWithNpc();
    const tile = screen.getByRole('button', { name: /Guide/ });
    act(() => tile.focus());
    act(() => screen.getByRole('button', { name: 'Edit' }).focus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Guide/ })).not.toBeInTheDocument();
    expect(tile).toHaveFocus();
    fireEvent.focus(tile);
    expect(screen.queryByRole('dialog', { name: /Guide/ })).not.toBeInTheDocument();
    fireEvent.click(tile);
    expect(screen.getByRole('dialog', { name: /Guide/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => screen.getByRole('button', { name: '+ Add NPC' }).focus());
    act(() => tile.focus());
    expect(screen.getByRole('dialog', { name: /Guide/ })).toBeInTheDocument();
  });

  test('removes an open popup and pending close when the route unmounts', () => {
    jest.useFakeTimers();
    try {
      const { unmount } = renderWithNpc();
      const tile = screen.getByRole('button', { name: /Guide/ });
      fireEvent.mouseEnter(tile);
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      fireEvent.mouseLeave(tile);
      unmount();
      act(() => jest.runOnlyPendingTimers());
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a dismissed pointer popup can open and close normally on a later visit', () => {
    jest.useFakeTimers();
    try {
      renderWithNpc();
      const tile = screen.getByRole('button', { name: /Guide/ });
      fireEvent.mouseEnter(tile);
      fireEvent.mouseLeave(tile);
      fireEvent.mouseEnter(screen.getByRole('dialog', { name: /Guide/ }));
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.mouseEnter(tile);
      fireEvent.mouseLeave(tile);
      act(() => jest.advanceTimersByTime(300));
      fireEvent.mouseEnter(tile);
      expect(screen.getByRole('dialog', { name: /Guide/ })).toBeInTheDocument();
      fireEvent.mouseLeave(tile);
      act(() => jest.advanceTimersByTime(300));
      expect(screen.queryByRole('dialog', { name: /Guide/ })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('reports hover state without triggering cross-component render warnings', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<HoverStateHarness />);

    const emptyState = await screen.findByText('No NPCs yet.');
    fireEvent.mouseEnter(emptyState);

    await waitFor(() => expect(screen.getByTestId('hover-state')).toHaveTextContent('hovered'));

    const hasCrossComponentWarning = consoleErrorSpy.mock.calls.some((call) =>
      call.some((entry) => String(entry).includes('Cannot update a component'))
    );

    expect(hasCrossComponentWarning).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  test('prepares a Rules-compatible NPC placeholder before canonical image upload', async () => {
    isTask07MediaV1WriteEnabled.mockResolvedValueOnce(true);
    doc.mockImplementationOnce(() => ({ id: 'new-npc', path: 'echi_npcs/new-npc' }));
    runWithTask07MediaOperationReceipt.mockImplementationOnce(({ invoke, expectedRevision, previousAssetId, signal }) => invoke({
      operationId: 'npc-create-operation', expectedRevision, previousAssetId, signal,
    }));
    runTask07ConsumerUpload.mockImplementationOnce(async ({ prepareEntity }) => {
      await prepareEntity();
      return { handled: true, status: 'complete' };
    });
    render(<NpcSidebar user={{ uid: 'dm-1' }} userData={{ role: 'dm' }} stickyOffset={104} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add NPC' }));
    fireEvent.change(screen.getByPlaceholderText('Nome NPC...'), { target: { value: '  New guide  ' } });
    fireEvent.change(screen.getByPlaceholderText('NPC description...'), { target: { value: '  Local guide  ' } });
    fireEvent.change(screen.getByPlaceholderText('NPC notes...'), { target: { value: '  Meet at dawn  ' } });
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { files: [new File(['portrait'], 'guide.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create NPC' }));

    await waitFor(() => expect(setDoc).toHaveBeenCalledWith(
      { id: 'new-npc', path: 'echi_npcs/new-npc' },
      {
        nome: 'New guide', imageUrl: '', imagePath: '',
        description: 'Local guide', notes: 'Meet at dawn',
        createdBy: 'dm-1', createdByRole: 'dm',
        createdAt: { seconds: 0 }, updatedAt: { seconds: 0 },
      },
    ));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add NPC' })).not.toBeInTheDocument());
    expect(addDoc).not.toHaveBeenCalled();
  });

  test('deletes a canonical NPC document without directly deleting private Storage', async () => {
    const canonicalNpc = {
      id: 'npc-canonical',
      data: () => ({
        nome: 'Canonical NPC',
        description: 'Lifecycle-owned portrait',
        media: {
          assetId: `m_${'a'.repeat(40)}`,
        },
      }),
    };
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [canonicalNpc] });
      return () => {};
    });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <NpcSidebar
        user={{ uid: 'dm-1' }}
        userData={{ role: 'dm' }}
        stickyOffset={104}
        canDragToMap={false}
      />
    );

    fireEvent.mouseEnter(await screen.findByRole('button', { name: /Canonical NPC/ }));
    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(deleteDoc).toHaveBeenCalledWith({
      path: 'echi_npcs/npc-canonical',
    }));
    expect(deleteObject).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  test('deletes the legacy NPC reference before eager Storage cleanup', async () => {
    const legacyNpc = {
      id: 'npc-legacy',
      data: () => ({
        nome: 'Legacy NPC',
        description: 'Legacy portrait',
        imageUrl: 'https://example.com/npc.png',
        imagePath: 'echi_npcs/dm-1/legacy.png',
      }),
    };
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [legacyNpc] });
      return () => {};
    });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <NpcSidebar
        user={{ uid: 'dm-1' }}
        userData={{ role: 'dm' }}
        stickyOffset={104}
        canDragToMap={false}
      />
    );

    fireEvent.mouseEnter(await screen.findByRole('button', { name: /Legacy NPC/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteObject).toHaveBeenCalled());
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'echi_npcs/npc-legacy' });
    expect(deleteDoc.mock.invocationCallOrder[0])
      .toBeLessThan(deleteObject.mock.invocationCallOrder[0]);

    confirmSpy.mockRestore();
  });
});
