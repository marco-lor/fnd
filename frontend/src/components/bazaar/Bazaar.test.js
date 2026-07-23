import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Bazaar from './Bazaar';
import { useAuth, useAuthSession } from '../../AuthContext';
import { useShellLayout } from '../common/shellLayout';
import { onSnapshot } from '../../performance/firestore';
import { useResources } from '../../data/userData/userDataHooks';
import { acquireItem } from './elements/acquireItem';
import { createUserOperationId } from '../../data/userData/userDataCommands';
import PurchaseConfirmModal from './elements/PurchaseConfirmModal';
import { USER_DATA_ROLLOUT_STAGES } from '../../data/userData/domainSchema';

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
  useAuthSession: jest.fn(),
}));

jest.mock('../../data/userData/userDataHooks', () => ({
  useResources: jest.fn(),
}));

jest.mock('../../data/userData/userDataCommands', () => ({
  createUserOperationId: jest.fn(() => 'purchase-flow-fixed'),
}));

jest.mock('../common/shellLayout', () => ({
  useShellLayout: jest.fn(),
}));

jest.mock('../common/paramMetadata', () => ({
  SPECIAL_PARAM_SCHEMA_IDS: [],
}));

jest.mock('./elements/addWeapon', () => ({
  AddWeaponOverlay: jest.fn(() => null),
}));

jest.mock('./elements/addArmatura', () => ({
  AddArmaturaOverlay: jest.fn(() => null),
}));

jest.mock('./elements/addAccessorio', () => ({
  AddAccessorioOverlay: jest.fn(() => null),
}));

jest.mock('./elements/addConsumabile', () => ({
  AddConsumabileOverlay: jest.fn(() => null),
}));

jest.mock('./elements/comparisonComponent', () => ({
  __esModule: true,
  default: jest.fn(({ item }) => <div data-testid="comparison-panel-content">{item?.General?.Nome}</div>),
}));
jest.mock('./elements/PurchaseConfirmModal', () => jest.fn(({ onConfirm, onClose }) => (
  <div data-testid="purchase-confirm-modal">
    <button type="button" onClick={onConfirm}>Confirm purchase</button>
    <button type="button" onClick={onClose}>Close purchase</button>
  </div>
)));
jest.mock('./elements/FiltersSection', () => jest.fn(() => <div data-testid="filters-section" />));

jest.mock('../firebaseConfig', () => ({
  db: {},
}));
jest.mock('../firebaseStorage', () => ({ storage: {} }));

jest.mock('../../performance/firestore', () => ({
  and: jest.fn(),
  collection: jest.fn((db, path) => ({ path })),
  doc: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  getDoc: jest.fn(() => Promise.resolve({
    exists: () => false,
    data: () => ({}),
  })),
  onSnapshot: jest.fn((target, onNext) => {
    onNext({
      forEach: (callback) => {
        callback({
          id: 'weapon-1',
          data: () => ({
            General: {
              Nome: 'Spada Lunga',
              Slot: 'Mano',
              prezzo: 10,
            },
            Parametri: {
              Base: {},
              Combattimento: {},
              Special: {},
            },
            Specific: {
              Hands: 1,
              Tipo: 'Taglio',
            },
            item_type: 'weapon',
          }),
        });
      },
    });
    return () => {};
  }),
  or: jest.fn(),
  query: jest.fn((base) => base),
  where: jest.fn(),
}));

jest.mock('./elements/acquireItem', () => ({
  acquireItem: jest.fn(() => Promise.resolve({ success: true, newGold: 90 })),
}));

describe('Bazaar layout', () => {
  beforeEach(() => {
    PurchaseConfirmModal.mockImplementation(({ onConfirm, onClose }) => (
      <div data-testid="purchase-confirm-modal">
        <button type="button" onClick={onConfirm}>Confirm purchase</button>
        <button type="button" onClick={onClose}>Close purchase</button>
      </div>
    ));
    createUserOperationId.mockReturnValue('purchase-flow-fixed');
    acquireItem.mockResolvedValue({ success: true, newGold: 90 });
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
      },
      userData: {
        role: 'dm',
        stats: {
          gold: 100,
        },
      },
    });
    useAuthSession.mockReturnValue({ repositoryAccessGeneration: 0 });
    useResources.mockReturnValue({
      data: { stats: { gold: 100 } },
      status: 'fresh',
      stage: USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
    });
    useShellLayout.mockReturnValue({
      topInset: 96,
    });
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({
        forEach: (callback) => {
          callback({
            id: 'weapon-1',
            data: () => ({
              General: {
                Nome: 'Spada Lunga',
                Slot: 'Mano',
                prezzo: 10,
              },
              Parametri: {
                Base: {},
                Combattimento: {},
                Special: {},
              },
              Specific: {
                Hands: 1,
                Tipo: 'Taglio',
              },
              item_type: 'weapon',
            }),
          });
        },
      });
      return () => {};
    });
  });

  test('renders the comparison panel inside the content layout using shell offsets', async () => {
    render(<Bazaar />);

    const panel = await screen.findByTestId('bazaar-comparison-panel');

    expect(screen.getByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
    expect(panel.style.top).toBe('120px');
    expect(panel.style.getPropertyValue('--bazaar-comparison-panel-height')).toBe('calc(100vh - 144px)');
    expect(panel.className).toContain('xl:sticky');
    expect(panel.className).not.toContain('fixed');
    expect(await screen.findByTestId('bazaar-item-card-weapon-1')).toBeInTheDocument();
    expect(screen.getByText('Spada Lunga')).toBeInTheDocument();
    expect(screen.getByText('Slot: Mano')).toBeInTheDocument();
    expect(screen.getByText('Tipo: Taglio')).toBeInTheDocument();
    expect(screen.getByText('Hands: 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acquire' })).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  test('shows the real detail panel on hover and restores the placeholder on mouse leave', async () => {
    render(<Bazaar />);

    const itemCard = await screen.findByTestId('bazaar-item-card-weapon-1');
    expect(screen.getByTestId('bazaar-detail-placeholder')).toBeInTheDocument();

    fireEvent.mouseEnter(itemCard);
    await waitFor(() => expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument());

    fireEvent.mouseLeave(itemCard);
    expect(await screen.findByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
  });

  test('locks and unlocks the detail panel when the tile is clicked', async () => {
    render(<Bazaar />);

    const itemCard = await screen.findByTestId('bazaar-item-card-weapon-1');

    fireEvent.click(itemCard);
    await waitFor(() => expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument());

    fireEvent.mouseLeave(itemCard);
    expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument();

    fireEvent.click(itemCard);
    await waitFor(() => expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument());

    fireEvent.mouseLeave(itemCard);
    expect(await screen.findByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
  });

  test('keeps one actor-scoped retry key for the confirmed purchase flow', async () => {
    render(<Bazaar />);

    fireEvent.click(await screen.findByRole('button', { name: 'Acquire' }));
    await waitFor(() => expect(createUserOperationId).toHaveBeenCalledWith('purchase-flow'));
    await waitFor(() => expect(PurchaseConfirmModal).toHaveBeenCalled());
    const modalProps = PurchaseConfirmModal.mock.calls.at(-1)[0];
    await act(async () => {
      await modalProps.onConfirm();
    });

    await waitFor(() => expect(acquireItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'weapon-1' }),
      undefined,
      USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
      'user-1:purchase-flow-fixed'
    ));
  });

  test.each([
    ['an unresolved rollout stage', { data: null, status: 'loading', stage: null }],
    ['a missing V2 resources document', {
      data: null,
      status: 'missing',
      stage: USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE,
    }],
  ])('disables purchase without falling back to legacy gold for %s', async (_label, resourceState) => {
    useResources.mockReturnValue(resourceState);

    render(<Bazaar />);

    const purchaseButton = await screen.findByRole('button', { name: 'Unavailable' });
    expect(purchaseButton).toBeDisabled();
    fireEvent.click(purchaseButton);
    expect(createUserOperationId).not.toHaveBeenCalled();
    expect(acquireItem).not.toHaveBeenCalled();
    expect(PurchaseConfirmModal).not.toHaveBeenCalled();
  });

  test('masks the previous catalog and closes its purchase flow on an auth scope change', async () => {
    let subscriptionCount = 0;
    onSnapshot.mockImplementation((target, onNext) => {
      subscriptionCount += 1;
      if (subscriptionCount === 1) {
        onNext({
          forEach: (callback) => callback({
            id: 'weapon-1',
            data: () => ({
              General: { Nome: 'Spada Lunga', Slot: 'Mano', prezzo: 10 },
              Parametri: { Base: {}, Combattimento: {}, Special: {} },
              Specific: { Hands: 1, Tipo: 'Taglio' },
              item_type: 'weapon',
            }),
          }),
        });
      }
      return () => {};
    });

    const { rerender } = render(<Bazaar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acquire' }));
    expect(await screen.findByTestId('purchase-confirm-modal')).toBeInTheDocument();

    useAuth.mockReturnValue({
      user: { uid: 'user-2' },
      userData: { role: 'dm', stats: { gold: 100 } },
    });
    useAuthSession.mockReturnValue({ repositoryAccessGeneration: 1 });
    rerender(<Bazaar />);

    await waitFor(() => {
      expect(screen.queryByTestId('bazaar-item-card-weapon-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('purchase-confirm-modal')).not.toBeInTheDocument();
    });
  });

  test('closes a pending purchase when the item leaves the authorized catalog', async () => {
    let publishCatalog;
    onSnapshot.mockImplementation((target, onNext) => {
      publishCatalog = onNext;
      onNext({
        forEach: (callback) => callback({
          id: 'weapon-1',
          data: () => ({
            General: { Nome: 'Spada Lunga', Slot: 'Mano', prezzo: 10 },
            Parametri: { Base: {}, Combattimento: {}, Special: {} },
            Specific: { Hands: 1, Tipo: 'Taglio' },
            item_type: 'weapon',
          }),
        }),
      });
      return () => {};
    });

    render(<Bazaar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acquire' }));
    expect(await screen.findByTestId('purchase-confirm-modal')).toBeInTheDocument();

    act(() => publishCatalog({ forEach: () => {} }));

    await waitFor(() => expect(screen.queryByTestId('purchase-confirm-modal')).not.toBeInTheDocument());
    expect(acquireItem).not.toHaveBeenCalled();
  });
});
