import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { FaCheck } from 'react-icons/fa';
import { parseCombatDamage } from './combatPresentation';
import './grigliataCombat.css';

// Shared by the Registro and the Home defense popup: the confirmation of a recorded application and the form that
// sends one. Rights, locks and the request itself stay with the caller, which passes the state of its own request.

const IDLE = {};
const INVALID_DAMAGE = 'Indica il danno finale: un numero intero da 0 in su.';
const belowMinimum = minimum => 'Il danno non può essere inferiore a ' + minimum + ': solo il DM può ridurlo.';
const TABLE_CRITICAL = 'Critico da calcolare al tavolo: il danno lo applica il DM.';

export function AppliedDamage({ applied, focusRef }) {
  return (
    <p ref={focusRef} tabIndex={focusRef ? -1 : undefined} className="gc-damage-done">
      <FaCheck aria-hidden="true" />
      {['Danno applicato', applied.amount].filter(part => part != null).join(' · ')}
    </p>
  );
}

// The final damage for one target, set by the DM or the target's owner: the proposal prefilled (blank when the critical is still to roll at the table,
// its formula beside the field). The DM may send any whole number from 0 up; an owner's `floor.minimum` is the least
// they may send, said beside the field.
function DamageForm({ name, proposal, floor, criticalScore, state, onApply, draft, onDraftChange, inputRef }) {
  const id = useId();
  // Once a submit or a blur found a problem, it is shown against the current proposal until an edit fixes it.
  const [checked, setChecked] = useState(false);
  const currentDraft = draft === undefined ? state.submitted : draft;
  const value = currentDraft ? currentDraft.value : proposal.amount == null ? '' : String(proposal.amount);
  const changed = Boolean(currentDraft) && currentDraft.criticalScore !== criticalScore;
  const minimum = floor?.minimum > 0 ? floor.minimum : null;
  const problem = text => {
    const amount = parseCombatDamage(text);
    if (amount == null) return INVALID_DAMAGE;
    return minimum != null && amount < minimum ? belowMinimum(minimum) : '';
  };
  const invalid = checked ? problem(value) : '';
  const busy = Boolean(state.busy || state.criticalPending);
  const error = invalid || state.error;
  const describedBy = [
    proposal.formula && id + '-formula', minimum != null && id + '-minimum', changed && id + '-changed', error && id + '-error',
  ].filter(Boolean).join(' ');

  function submit(event) {
    event.preventDefault();
    if (busy || changed) return;
    if (problem(value)) {
      setChecked(true);
      inputRef.current?.focus();
      return;
    }
    setChecked(false);
    // The amount sent stays in the field: a refused application is retried as it was.
    onDraftChange({ value, criticalScore });
    onApply(parseCombatDamage(value));
  }

  function edit(next) {
    onDraftChange({ value: next, criticalScore });
    if (checked && !problem(next)) setChecked(false);
  }

  return (
    <form className="gc-damage-form" aria-label={'Applica danno a ' + name} aria-busy={busy || undefined} noValidate onSubmit={submit}>
      <label htmlFor={id + '-amount'}>Danno finale</label>
      <div className="gc-damage-row">
        <input
          ref={inputRef}
          id={id + '-amount'}
          name="amount"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          required
          readOnly={busy}
          value={value}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          onChange={event => edit(event.target.value)}
          onBlur={() => { if (currentDraft && problem(value)) setChecked(true); }}
        />
        {proposal.formula && <small id={id + '-formula'} className="gc-damage-formula"><code>{proposal.formula}</code></small>}
        <button type="submit" className="gc-secondary" aria-disabled={busy || changed || undefined}>
          {state.busy ? 'Applicazione…' : state.criticalPending ? 'Calcolo critico…' : 'Applica danno'}
        </button>
      </div>
      {minimum != null && (
        <p id={id + '-minimum'} className="gc-hint">{'Minimo ' + minimum + ': puoi aumentarlo; per ridurlo chiedi al DM.'}</p>
      )}
      {changed && (
        <p id={id + '-changed'} className="gc-hint gc-damage-changed">
          {proposal.amount == null ? 'Il critico va ora calcolato al tavolo.' : 'Danno proposto aggiornato: ' + proposal.amount + '.'}
          <button type="button" className="gc-link" disabled={busy} onClick={() => {
            onDraftChange(null);
            setChecked(false);
            inputRef.current?.focus();
          }}>
            Usa la proposta
          </button>
        </p>
      )}
      {error && <p id={id + '-error'} className="gc-error" role="alert">{error}</p>}
    </form>
  );
}

// A critical rolled at the table leaves the owner no number to confirm: its formula stays in view, and the DM applies it.
function TableCritical({ formula, noteRef }) {
  const formulaId = useId();
  return (
    <div className="gc-damage-form gc-damage-table">
      <p className="gc-hint" ref={noteRef} tabIndex={-1} aria-describedby={formula ? formulaId : undefined}>{TABLE_CRITICAL}</p>
      {formula && <small id={formulaId} className="gc-damage-formula"><code>{formula}</code></small>}
    </div>
  );
}

// Home holds the draft across receipt moves. Registro keeps it here, including while the numeric form is unavailable.
// `floor` comes from `combatDamageFloor`: null for the DM, `{ minimum }` or `{ table: true }` for the target's owner.
export function TargetDamage({ name, proposal, floor = null, criticalScore, applied, state = IDLE, onApply, draft, onDraftChange }) {
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const noteRef = useRef(null);
  const doneRef = useRef(null);
  const [ownDraft, setOwnDraft] = useState();
  // Set on focus, cleared only when focus lands on another element: a removed form leaves focus nowhere, not elsewhere.
  const focusInside = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const view = applied ? 'applied' : floor?.table ? 'table' : 'form';
  const previousView = useRef(view);
  const amount = applied?.amount;
  useLayoutEffect(() => {
    const before = previousView.current;
    previousView.current = view;
    if (before === view) return;
    const active = document.activeElement;
    const lost = !active || active === document.body;
    const focus = wrapperRef.current?.contains(active) || (lost && focusInside.current);
    const next = view === 'applied' ? doneRef : view === 'table' ? noteRef : inputRef;
    if (focus) next.current?.focus({ preventScroll: true });
    const message = view === 'table' ? name + '. ' + TABLE_CRITICAL
      : view === 'applied' ? ['Danno applicato a ' + name, amount].filter(part => part != null).join(': ') + '.' : '';
    setAnnouncement(focus ? '' : message);
  }, [view, name, amount]);

  return (
    <div
      ref={wrapperRef}
      className="gc-damage"
      onFocus={() => { focusInside.current = true; }}
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) focusInside.current = false;
      }}
    >
      {applied
        ? <AppliedDamage applied={applied} focusRef={doneRef} />
        : floor?.table
          ? <TableCritical formula={proposal.formula} noteRef={noteRef} />
          : <DamageForm
            {...{ name, proposal, floor, criticalScore, state, onApply, inputRef }}
            draft={onDraftChange ? draft : ownDraft}
            onDraftChange={onDraftChange || setOwnDraft}
          />}
      <p role="status" className="gc-sr-only">{announcement}</p>
    </div>
  );
}
