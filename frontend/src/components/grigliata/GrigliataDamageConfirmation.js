import React, { useEffect, useId, useRef, useState } from 'react';
import { FaCheck } from 'react-icons/fa';
import { parseCombatDamage } from './combatPresentation';
import './grigliataCombat.css';

// Shared by the Registro and the Home defense popup: the confirmation of a recorded application and the form that
// sends one. Rights, locks and the request itself stay with the caller, which passes the state of its own request.

const IDLE = {};
const INVALID_DAMAGE = 'Indica il danno finale: un numero intero da 0 in su.';

export function AppliedDamage({ applied, focusRef }) {
  return (
    <p ref={focusRef} tabIndex={focusRef ? -1 : undefined} className="gc-damage-done">
      <FaCheck aria-hidden="true" />
      {['Danno applicato', applied.amount].filter(part => part != null).join(' · ')}
    </p>
  );
}

// The final damage for one target, set by the DM or the target's owner: the proposal prefilled (blank when the critical is still to roll at the table,
// its formula beside the field), any whole number from 0 up accepted.
function DamageForm({ name, proposal, criticalScore, state, onApply, draft: heldDraft, onDraftChange }) {
  const id = useId();
  const inputRef = useRef(null);
  // An untouched form can recover the last submitted value after the panel reopens. A caller that moves the form
  // between places holds the draft itself: undefined untouched, null back to the proposal, or the typed value with the
  // critical it was typed against.
  const [ownDraft, setOwnDraft] = useState();
  const held = typeof onDraftChange === 'function';
  const draft = held ? heldDraft : ownDraft;
  const setDraft = held ? onDraftChange : setOwnDraft;
  const [invalid, setInvalid] = useState('');
  const currentDraft = draft === undefined ? state.submitted : draft;
  const value = currentDraft ? currentDraft.value : proposal.amount == null ? '' : String(proposal.amount);
  const changed = Boolean(currentDraft) && currentDraft.criticalScore !== criticalScore;
  const busy = Boolean(state.busy || state.criticalPending);
  const error = invalid || state.error;
  const describedBy = [proposal.formula && id + '-formula', changed && id + '-changed', error && id + '-error']
    .filter(Boolean).join(' ');

  function submit(event) {
    event.preventDefault();
    if (busy || changed) return;
    const amount = parseCombatDamage(value);
    if (amount == null) {
      setInvalid(INVALID_DAMAGE);
      inputRef.current?.focus();
      return;
    }
    setInvalid('');
    // The amount sent stays in the field: a refused application is retried as it was.
    setDraft({ value, criticalScore });
    onApply(amount);
  }

  function edit(next) {
    setDraft({ value: next, criticalScore });
    if (invalid && parseCombatDamage(next) != null) setInvalid('');
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
          onBlur={() => { if (currentDraft && parseCombatDamage(value) == null) setInvalid(INVALID_DAMAGE); }}
        />
        {proposal.formula && <small id={id + '-formula'} className="gc-damage-formula"><code>{proposal.formula}</code></small>}
        <button type="submit" className="gc-secondary" aria-disabled={busy || changed || undefined}>
          {state.busy ? 'Applicazione…' : state.criticalPending ? 'Calcolo critico…' : 'Applica danno'}
        </button>
      </div>
      {changed && (
        <p id={id + '-changed'} className="gc-hint gc-damage-changed">
          {proposal.amount == null ? 'Il critico va ora calcolato al tavolo.' : 'Danno proposto aggiornato: ' + proposal.amount + '.'}
          <button type="button" className="gc-link" disabled={busy} onClick={() => {
            setDraft(null);
            setInvalid('');
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

// `draft` and `onDraftChange` are optional: without them the form keeps its own draft, as in the Registro.
export function TargetDamage({ name, proposal, criticalScore, applied, state = IDLE, onApply, draft, onDraftChange }) {
  const wrapperRef = useRef(null);
  const doneRef = useRef(null);
  // Set on focus, cleared only when focus lands on another element: a removed form leaves focus nowhere, not elsewhere.
  const focusInside = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const isApplied = Boolean(applied);
  const wasApplied = useRef(isApplied);
  const amount = applied?.amount;
  useEffect(() => {
    const before = wasApplied.current;
    wasApplied.current = isApplied;
    if (!isApplied || before) return;
    // The form just gave way to the confirmation: focus follows it unless the viewer is already working elsewhere,
    // who then hears it instead.
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (wrapperRef.current?.contains(active) || (lost && focusInside.current)) doneRef.current?.focus({ preventScroll: true });
    else setAnnouncement(['Danno applicato a ' + name, amount].filter(part => part != null).join(': ') + '.');
  }, [isApplied, name, amount]);

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
        : <DamageForm {...{ name, proposal, criticalScore, state, onApply, draft, onDraftChange }} />}
      <p role="status" className="gc-sr-only">{announcement}</p>
    </div>
  );
}
