import React, { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppliedDamage, TargetDamage } from './GrigliataDamageConfirmation';

// The public shape shared by the Registro and the Home defense popup.
test('TargetDamage sends a typed whole number once per submit and gives way to the recorded amount', () => {
  const onApply = jest.fn();
  const proposal = { amount: 7, formula: '' };
  const view = (extra) => <TargetDamage name="Lia" proposal={proposal} criticalScore={null} onApply={onApply} {...extra} />;
  const { rerender } = render(view());
  const form = screen.getByRole('form', { name: 'Applica danno a Lia' });
  const field = within(form).getByLabelText('Danno finale');
  expect(field).toHaveValue('7');
  field.focus();
  fireEvent.change(field, { target: { value: '5' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(onApply).toHaveBeenCalledWith(5);

  rerender(view({ state: { busy: true, submitted: { value: '5', criticalScore: null } } }));
  expect(within(form).getByRole('button', { name: 'Applicazione…' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.submit(form);
  expect(onApply).toHaveBeenCalledTimes(1);

  rerender(view({ state: { error: 'Conferma non ricevuta.', submitted: { value: '5', criticalScore: null } } }));
  expect(within(form).getByRole('alert')).toHaveTextContent('Conferma non ricevuta.');
  expect(field).toHaveValue('5');

  rerender(view({ applied: { amount: 5 } }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.getByText('Danno applicato · 5')).toHaveFocus();
});

test('TargetDamage can leave its draft to the caller, so a form mounted again keeps the typed amount and its critical', () => {
  const onDraftChange = jest.fn();
  const view = extra => (
    <TargetDamage name="Lia" proposal={{ amount: 7, formula: '' }} criticalScore={13} onApply={jest.fn()} onDraftChange={onDraftChange} {...extra} />
  );
  const { unmount } = render(view());
  fireEvent.change(screen.getByLabelText('Danno finale'), { target: { value: '5' } });
  expect(onDraftChange).toHaveBeenLastCalledWith({ value: '5', criticalScore: 13 });
  // Held by the caller: the field shows what it is given, not a copy of its own.
  expect(screen.getByLabelText('Danno finale')).toHaveValue('7');
  unmount();

  // Mounted again after the critical changed: the typed amount stays, flagged against the critical it was typed for.
  const { rerender } = render(view({ draft: { value: '5', criticalScore: 13 }, criticalScore: 15, proposal: { amount: 9, formula: '' } }));
  expect(screen.getByLabelText('Danno finale')).toHaveValue('5');
  expect(screen.getByText(/Danno proposto aggiornato: 9\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Usa la proposta' }));
  expect(onDraftChange).toHaveBeenLastCalledWith(null);
  rerender(view({ draft: null, criticalScore: 15, proposal: { amount: 9, formula: '' } }));
  expect(screen.getByLabelText('Danno finale')).toHaveValue('9');
});

test('an owner starts from the proposal as the minimum and may only raise it; a critical rolled at the table is left to the DM', () => {
  const onApply = jest.fn();
  const view = extra => (
    <TargetDamage name="Lia" proposal={{ amount: 9, formula: '' }} floor={{ minimum: 9 }} criticalScore={null} onApply={onApply} {...extra} />
  );
  const { rerender } = render(view());
  const form = screen.getByRole('form', { name: 'Applica danno a Lia' });
  const field = within(form).getByLabelText('Danno finale');
  expect(field).toHaveValue('9');
  expect(field).toHaveAccessibleDescription('Minimo 9: puoi aumentarlo; per ridurlo chiedi al DM.');
  fireEvent.change(field, { target: { value: '8' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(onApply).not.toHaveBeenCalled();
  expect(within(form).getByRole('alert')).toHaveTextContent('Il danno non può essere inferiore a 9: solo il DM può ridurlo.');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: '12' } });
  expect(field).not.toHaveAttribute('aria-invalid');
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(onApply).toHaveBeenCalledWith(12);
  // Leaving a lower amount in the field says so at once.
  fireEvent.change(field, { target: { value: '3' } });
  fireEvent.blur(field);
  expect(within(form).getByRole('alert')).toHaveTextContent('Il danno non può essere inferiore a 9');

  // A minimum of 0 restricts nothing and says nothing.
  rerender(view({ proposal: { amount: 0, formula: '' }, floor: { minimum: 0 }, draft: null, onDraftChange: jest.fn() }));
  expect(screen.getByLabelText('Danno finale')).toHaveAccessibleDescription('');

  // No number the owner could meet: the formula stays in view and the DM applies the damage.
  rerender(view({ proposal: { amount: null, formula: '2d6 + 4' }, floor: { table: true }, criticalScore: 30 }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.getByText('Critico da calcolare al tavolo: il danno lo applica il DM.')).toBeInTheDocument();
  expect(screen.getByText('2d6 + 4')).toBeInTheDocument();
  expect(onApply).toHaveBeenCalledTimes(1);
  rerender(view({ proposal: { amount: null, formula: '2d6 + 4' }, floor: { table: true }, criticalScore: 30, applied: { amount: 11 } }));
  expect(screen.getByText('Danno applicato · 11')).toBeInTheDocument();
  expect(screen.queryByText(/il danno lo applica il DM/)).not.toBeInTheDocument();
});

test('AppliedDamage reads the recorded amount, 0 included, and takes focus only through a focusRef', () => {
  const focusRef = createRef();
  const { rerender } = render(<AppliedDamage applied={{ amount: 0 }} />);
  expect(screen.getByText('Danno applicato · 0')).not.toHaveAttribute('tabindex');
  rerender(<AppliedDamage applied={{ amount: 0 }} focusRef={focusRef} />);
  expect(focusRef.current).toBe(screen.getByText('Danno applicato · 0'));
  expect(focusRef.current).toHaveAttribute('tabindex', '-1');
});

test('a live table critical receives focus and preserves the unsent draft when a numeric amount returns', () => {
  const view = (proposal, floor, criticalScore) => (
    <>
      <button type="button">Mappa</button>
      <TargetDamage name="Lia" proposal={proposal} floor={floor} criticalScore={criticalScore} onApply={jest.fn()} />
    </>
  );
  const { rerender } = render(view({ amount: 9, formula: '' }, { minimum: 9 }, 13));
  const field = screen.getByLabelText('Danno finale');
  field.focus();
  fireEvent.change(field, { target: { value: '16' } });

  rerender(view({ amount: null, formula: '2d6 + 4' }, { table: true }, 30));
  const note = screen.getByText('Critico da calcolare al tavolo: il danno lo applica il DM.');
  expect(note).toHaveFocus();
  expect(note).toHaveAccessibleDescription('2d6 + 4');

  rerender(view({ amount: 12, formula: '' }, { minimum: 12 }, 21));
  expect(screen.getByLabelText('Danno finale')).toHaveFocus();
  expect(screen.getByLabelText('Danno finale')).toHaveValue('16');
  expect(screen.getByRole('button', { name: 'Applica danno' })).toHaveAttribute('aria-disabled', 'true');

  const outside = screen.getByRole('button', { name: 'Mappa' });
  outside.focus();
  rerender(view({ amount: null, formula: '2d6 + 4' }, { table: true }, 30));
  expect(outside).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Lia. Critico da calcolare al tavolo');
});
