import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlayerInfoInventoryRow from './PlayerInfoInventoryRow';
import DelVarieItemUnitsOverlay from '../../buttons/delVarieItemUnits';

jest.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: () => <span data-testid="icon" />,
}));

jest.mock('../../buttons/delInventoryItem', () => () => null);
jest.mock('../../buttons/delVarieItemUnits', () => jest.fn(() => <div data-testid="varie-overlay" />));
jest.mock('../overlays/AddBazaarItemOverlay', () => () => null);

test('passes the aggregated Varie quantity through the overlay totalQty contract', async () => {
  render(
    <PlayerInfoInventoryRow
      variant="card"
      users={[{
        id: 'user-1',
        inventory: [{ id: 'rope', type: 'varie', name: 'Corda', qty: 3 }],
        stats: { gold: 0 },
      }]}
      catalog={{}}
      itemsDocs={{}}
      iconEditClass="edit"
      onEditInventoryItem={() => {}}
      onOpenGoldOverlay={() => {}}
      goldUpdating={{}}
      onAddVarie={() => {}}
    />
  );

  fireEvent.click(screen.getByTitle(/Rimuovi unit/));

  await waitFor(() => expect(DelVarieItemUnitsOverlay).toHaveBeenCalled());
  expect(DelVarieItemUnitsOverlay).toHaveBeenLastCalledWith(
    expect.objectContaining({ totalQty: 3 }),
    expect.anything()
  );
  expect(DelVarieItemUnitsOverlay.mock.calls.at(-1)[0]).not.toHaveProperty('quantity');
});
