import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GrigliataLightingSheet from './GrigliataLightingSheet';

const background = {
  id: 'map-2',
  name: 'Iron Keep',
};

const LightingSheetHarness = ({
  hasUnsavedChanges = false,
  isCloseDisabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open lighting</button>
      {isOpen && (
        <GrigliataLightingSheet
          background={background}
          hasLightingMetadata
          hasUnsavedChanges={hasUnsavedChanges}
          isCloseDisabled={isCloseDisabled}
          onClose={() => setIsOpen(false)}
        >
          <button type="button">First control</button>
          <button type="button">Last control</button>
        </GrigliataLightingSheet>
      )}
    </>
  );
};

describe('GrigliataLightingSheet', () => {
  test('opens as a labelled modal sheet, closes with Escape, and restores trigger focus', () => {
    render(<LightingSheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Open lighting' });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Lighting — Iron Keep' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('sm:max-w-[34rem]');
    expect(dialog).toHaveClass('bg-slate-950/[0.98]');
    expect(screen.getByRole('button', { name: 'Close lighting for Iron Keep' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Lighting — Iron Keep' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  test('does not discard a parsed import draft without confirmation', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LightingSheetHarness hasUnsavedChanges />);
    fireEvent.click(screen.getByRole('button', { name: 'Open lighting' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close lighting for Iron Keep' }));

    expect(confirmSpy).toHaveBeenCalledWith('Discard the parsed lighting file without importing it?');
    expect(screen.getByRole('dialog', { name: 'Lighting — Iron Keep' })).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  test('cannot close while an import is being written', () => {
    render(<LightingSheetHarness isCloseDisabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Open lighting' }));

    const dialog = screen.getByRole('dialog', { name: 'Lighting — Iron Keep' });
    const closeButton = screen.getByRole('button', { name: 'Close lighting for Iron Keep' });
    expect(closeButton).toBeDisabled();
    expect(screen.getByText('Importing')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('grigliata-lighting-sheet-backdrop'));

    expect(dialog).toBeInTheDocument();
  });
});
