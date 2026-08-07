import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddLinguaPersonaleOverlay } from './addLinguaPersonale';
import { AddConoscenzaPersonaleOverlay } from './addConoscenzaPersonale';
import { AddProfessionePersonaleOverlay } from './addProfessionePersonale';

const mockGetCodex = jest.fn();
const mockPersistProfileContentMap = jest.fn();

jest.mock('../../../../data/codexRepository', () => ({
  getCodex: (...args) => mockGetCodex(...args),
}));

jest.mock('../../../../data/userData/managerProfileContent', () => ({
  persistProfileContentMap: (...args) => mockPersistProfileContentMap(...args),
}));

const overlayCases = [
  {
    label: 'lingua',
    Component: AddLinguaPersonaleOverlay,
    selectedName: 'Elfico',
    field: 'lingue',
    expectedValue: 'Descrizione lingua',
  },
  {
    label: 'conoscenza',
    Component: AddConoscenzaPersonaleOverlay,
    selectedName: 'Arcano',
    field: 'conoscenze',
    expectedValue: { descrizione: 'Descrizione conoscenza', livello: 'Base' },
  },
  {
    label: 'professione',
    Component: AddProfessionePersonaleOverlay,
    selectedName: 'Alchimista',
    field: 'professioni',
    expectedValue: { descrizione: 'Descrizione professione', livello: 'Base' },
  },
];

const renderOverlay = (Component, onClose) => render(
  <Component
    userId="marco-test"
    userLabel="MarcoTEST"
    currentMap={{}}
    onClose={onClose}
  />
);

describe('DM profile-content add save state', () => {
  let alertSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCodex.mockResolvedValue({
      lingue: { Elfico: 'Descrizione lingua' },
      conoscenze: { Arcano: 'Descrizione conoscenza' },
      professioni: { Alchimista: 'Descrizione professione' },
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test.each(overlayCases)(
    'shows progress and permits only one $label save',
    async ({ Component, selectedName, field, expectedValue }) => {
      let resolveSave;
      mockPersistProfileContentMap.mockReturnValue(new Promise((resolve) => {
        resolveSave = resolve;
      }));
      const onClose = jest.fn();

      renderOverlay(Component, onClose);
      fireEvent.click(await screen.findByText(selectedName));

      const addButton = screen.getByRole('button', { name: 'Aggiungi' });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const savingButton = await screen.findByRole('button', { name: 'Saving...' });
      expect(savingButton).toBeDisabled();
      expect(savingButton).toHaveAttribute('aria-busy', 'true');
      expect(savingButton.querySelector('svg')).toHaveClass('animate-spin');
      expect(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
      expect(mockPersistProfileContentMap).toHaveBeenCalledTimes(1);
      expect(mockPersistProfileContentMap).toHaveBeenCalledWith({
        userId: 'marco-test',
        field,
        currentMap: {},
        action: 'upsert',
        name: selectedName,
        value: expectedValue,
      });
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        resolveSave();
        await Promise.resolve();
      });

      await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
      expect(mockPersistProfileContentMap).toHaveBeenCalledTimes(1);
    }
  );

  test.each(overlayCases)(
    'restores the $label action after a failed save',
    async ({ Component, selectedName }) => {
      mockPersistProfileContentMap.mockRejectedValue(new Error('Save failed'));
      const onClose = jest.fn();

      renderOverlay(Component, onClose);
      fireEvent.click(await screen.findByText(selectedName));
      fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Annulla' })).toBeEnabled();
      expect(onClose).not.toHaveBeenCalled();
    }
  );
});
