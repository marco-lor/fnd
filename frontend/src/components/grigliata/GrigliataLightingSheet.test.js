import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  const [mapClicks, setMapClicks] = useState(0);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open lighting</button>
      <button type="button" onClick={() => setMapClicks((current) => current + 1)}>
        Map control {mapClicks}
      </button>
      <div data-testid="sidebar-host">
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
      </div>
    </>
  );
};

describe('GrigliataLightingSheet', () => {
  let entryFrameCallback;
  let requestAnimationFrameSpy;
  let cancelAnimationFrameSpy;

  beforeEach(() => {
    entryFrameCallback = null;
    requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        entryFrameCallback = callback;
        return 1;
      });
    cancelAnimationFrameSpy = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  test('slides in as a non-modal sidebar panel and only the X starts its reverse close', async () => {
    render(<LightingSheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Open lighting' });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Lighting — Iron Keep' });
    const closeButton = screen.getByRole('button', { name: 'Close lighting for Iron Keep' });
    const closeFocusSpy = jest.spyOn(closeButton, 'focus');
    expect(screen.getByTestId('sidebar-host')).toContainElement(dialog);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveClass('transition-transform');
    expect(dialog).toHaveStyle({
      transform: 'translate3d(100%, 0, 0)',
      transitionDuration: '260ms',
      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    expect(dialog).toHaveAttribute('data-motion-state', 'entering');
    expect(screen.queryByTestId('grigliata-lighting-sheet-backdrop')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(closeButton).not.toHaveFocus();
    expect(trigger).toHaveFocus();

    act(() => entryFrameCallback?.(0));
    expect(dialog).toHaveStyle({ transform: 'translate3d(0, 0, 0)' });
    expect(dialog).toHaveAttribute('data-motion-state', 'entered');
    fireEvent.transitionEnd(dialog, { propertyName: 'transform' });
    expect(closeButton).toHaveFocus();
    expect(closeFocusSpy).toHaveBeenCalledWith({ preventScroll: true });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Map control 0' }));
    expect(screen.getByRole('button', { name: 'Map control 1' })).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();

    const triggerFocusSpy = jest.spyOn(trigger, 'focus');
    fireEvent.click(closeButton);
    expect(dialog).toHaveStyle({
      transform: 'translate3d(100%, 0, 0)',
      transitionDuration: '180ms',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 1, 1)',
    });
    expect(dialog).toHaveAttribute('data-motion-state', 'exiting');
    expect(dialog).toBeInTheDocument();

    fireEvent.transitionEnd(dialog, { propertyName: 'transform' });
    expect(screen.queryByRole('dialog', { name: 'Lighting — Iron Keep' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(triggerFocusSpy).toHaveBeenCalledWith({ preventScroll: true });
    closeFocusSpy.mockRestore();
    triggerFocusSpy.mockRestore();
  });

  test('does not discard a parsed import draft without confirmation', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LightingSheetHarness hasUnsavedChanges />);
    fireEvent.click(screen.getByRole('button', { name: 'Open lighting' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close lighting for Iron Keep' }));

    expect(confirmSpy).toHaveBeenCalledWith('Discard the parsed lighting file without importing it?');
    expect(screen.getByRole('dialog', { name: 'Lighting — Iron Keep' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Lighting — Iron Keep' })).not.toHaveAttribute(
      'data-motion-state',
      'exiting'
    );
    confirmSpy.mockRestore();
  });

  test('removes the transition for reduced-motion users', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({ matches: true }));

    try {
      render(<LightingSheetHarness />);
      fireEvent.click(screen.getByRole('button', { name: 'Open lighting' }));

      const dialog = screen.getByRole('dialog', { name: 'Lighting — Iron Keep' });
      expect(dialog).toHaveStyle({
        transform: 'translate3d(0, 0, 0)',
        transitionProperty: 'none',
        transitionDuration: '0ms',
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Close lighting for Iron Keep' })).toHaveFocus();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Close lighting for Iron Keep' }));
      expect(screen.queryByRole('dialog', { name: 'Lighting — Iron Keep' })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test('cannot close while an import is being written', () => {
    render(<LightingSheetHarness isCloseDisabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Open lighting' }));

    const dialog = screen.getByRole('dialog', { name: 'Lighting — Iron Keep' });
    const closeButton = screen.getByRole('button', { name: 'Close lighting for Iron Keep' });
    expect(closeButton).toBeDisabled();
    expect(screen.getByText('Importing')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Map control 0' }));

    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute('data-motion-state', 'exiting');
    expect(screen.getByRole('button', { name: 'Map control 1' })).toBeInTheDocument();
  });
});
