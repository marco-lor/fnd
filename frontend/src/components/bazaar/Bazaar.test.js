import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Bazaar from './Bazaar';
import { useAuth } from '../../AuthContext';
import { useShellLayout } from '../common/shellLayout';
import { onSnapshot } from 'firebase/firestore';

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
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
jest.mock('./elements/PurchaseConfirmModal', () => jest.fn(() => null));
jest.mock('./elements/FiltersSection', () => jest.fn(() => <div data-testid="filters-section" />));

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
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
});
