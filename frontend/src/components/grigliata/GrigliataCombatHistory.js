import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { FaArrowRight, FaClock, FaDiceD20, FaHistory } from 'react-icons/fa';
import {
  combatAppliedDamage, combatCanCancel, combatCardText, combatDamageFloor, combatDamageProposal, combatOutcomeLabel,
  combatPointLabel, combatSpentLabel, combatTargetName, combatTime, describeCombatCorrection, formatCombatRoll, signedCombatModifier,
  COMBAT_CONFIRMATION_STATUS,
} from './combatPresentation';
import { AppliedDamage, TargetDamage } from './GrigliataDamageConfirmation';

const IDLE = {};

function eventDestinations(event) {
  if (event.point) return combatPointLabel(event.point);
  const targets = event.targets || [];
  if (!targets.length) return '';
  const first = targets[0];
  if (targets.length === 1 && first.placementId === event.actor?.placementId) return 'sé';
  if (targets.length === 1) return first.name;
  if (targets.length === 2) return targets.map(target => combatTargetName(target, targets)).join(' e ');
  return first.name + ' +' + (targets.length - 1);
}

function eventResult(event) {
  if (event.status === 'cancelled') return 'Annullata';
  if (event.status === 'awaitingConfirmation') return COMBAT_CONFIRMATION_STATUS;
  if (event.status === 'waiting') return 'In attesa di risposta';
  if (event.status === 'retry') return 'Parità · rilancio';
  if (event.status === 'awaitingDamage') return 'In attesa del tiro di danno';
  const targets = event.targets || [];
  const critical = targets.find(target => target.critical)?.critical;
  // `tableRoll` is the part of the critical the app could not roll: the total is then only a partial sum.
  if (critical) return 'Critico · ' + (critical.tableRoll ? 'da calcolare al tavolo' : critical.total + ' danni proposti');
  const outcomes = targets.map(target => combatOutcomeLabel(target.outcome, event.kind, event.action?.hands)).filter(Boolean);
  if (outcomes.length > 1) {
    const counts = new Map();
    outcomes.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
    return Array.from(counts, ([label, count]) => count + ' · ' + label).join(' / ');
  }
  const effect = event.effects?.find(({ kind, amount }) => (
    (kind === 'damage' || kind === 'heal') && typeof amount === 'number'
  ));
  const total = effect?.amount ?? targets[0]?.damage;
  if (total != null) {
    const amount = total + (effect?.kind === 'heal' ? ' PF di cura proposti' : ' danni proposti');
    return [outcomes[0], amount].filter(Boolean).join(' · ');
  }
  if ((!outcomes[0] || targets[0]?.outcome === 'applied') && event.effects?.some(({ kind }) => kind === 'manual')) {
    return 'Effetto al tavolo';
  }
  return outcomes[0] || event.effects?.[0]?.label || 'Azione risolta';
}

function DetailRow({ label, children, className = '' }) {
  if (children === '' || children == null) return null;
  return (
    <div className={['gc-rule-row', className].filter(Boolean).join(' ')}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LoggedRoll({ roll }) {
  return roll && <DetailRow label={roll.label || 'Tiro'}>{formatCombatRoll(roll)}</DetailRow>;
}

function CancelCombat({ event, onCancel, state = IDLE }) {
  const [confirming, setConfirming] = useState(false);
  const questionId = useId();
  const start = useRef(null);
  const keep = useRef(null);
  const restore = useRef(false);
  useLayoutEffect(() => {
    if (confirming) keep.current?.focus();
    else if (restore.current) start.current?.focus();
  }, [confirming]);
  const action = [event.action?.name || 'Tiro', eventDestinations(event)].filter(Boolean).join(' · ');
  return (
    <div className="gc-cancel">
      {confirming ? (
        <div className="gc-cancel-options">
          <span id={questionId}>Annullare {action}?</span>
          <button ref={keep} type="button" disabled={state.busy} onClick={() => {
            restore.current = true;
            setConfirming(false);
          }}>Mantieni il tiro</button>
          <button type="button" aria-disabled={state.busy || undefined} aria-describedby={questionId}
            aria-label={(state.busy ? 'Annullamento in corso' : 'Conferma annullamento') + ' · ' + action}
            onClick={() => { if (!state.busy) onCancel(event); }}>
            {state.busy ? 'Annullamento in corso' : 'Conferma annullamento'}
          </button>
        </div>
      ) : (
        <button ref={start} type="button" aria-label={'Annulla tiro · ' + action} disabled={state.busy}
          onClick={() => setConfirming(true)}>Annulla tiro</button>
      )}
      {state.error && <p role="alert" className="gc-error">{state.error}</p>}
    </div>
  );
}

const needsCancellationReview = (event, isManager) => isManager && event.status === 'cancelled' && event.cancellation?.needsReview;

function CancellationDetails({ event, onCancellationDetails }) {
  const id = useId();
  const [state, setState] = useState(IDLE);
  const [open, setOpen] = useState(false);
  const { busy, error, corrections } = state;
  const toggle = async () => {
    if (busy) return;
    if (corrections) {
      setOpen(!open);
      return;
    }
    setOpen(true);
    setState({ busy: true });
    try {
      setState({ corrections: await onCancellationDetails(event) });
    } catch (failure) {
      setState({ error: failure?.message || 'Impossibile caricare le correzioni. Riprova.' });
    }
  };
  return (
    <div className="gc-corrections">
      <button type="button" className="gc-link" aria-expanded={open} aria-controls={id} aria-disabled={busy || undefined} onClick={toggle}>
        {busy ? 'Caricamento correzioni…' : error ? 'Riprova a caricare le correzioni' : open ? 'Nascondi correzioni' : 'Mostra correzioni'}
      </button>
      <div id={id} hidden={!open}>
        {error && <p className="gc-error" role="alert">{error}</p>}
        {corrections && (corrections.length ? (
          <ul>
            {corrections.map((item, index) => {
              const { name, reason, amounts, agreedDamage } = describeCombatCorrection(event, item);
              return <li key={index}>
                <strong>{name}</strong>
                <span>{reason}</span>
                {amounts && <span>{amounts}</span>}
                {agreedDamage && <span>{agreedDamage}</span>}
              </li>;
            })}
          </ul>
        ) : <p className="gc-hint">Nessuna correzione registrata.</p>)}
      </div>
    </div>
  );
}

function CriticalInput({ critical, onCritical, hasDice, busy }) {
  const [score, setScore] = useState(null);
  const cancelPrepared = useRef(null);
  const value = score ?? critical?.score ?? '';
  const row = Number(value);
  const canSubmit = Number.isInteger(row) && row >= 1 && row <= 41 && row !== critical?.score;
  useLayoutEffect(() => () => {
    cancelPrepared.current?.();
    cancelPrepared.current = null;
  }, [value, critical?.score]);

  function submit(event) {
    event.preventDefault();
    if (canSubmit && !busy) {
      const cancel = onCritical(row);
      if (typeof cancel === 'function') cancelPrepared.current = cancel;
    }
  }

  return (
    <details className="gc-details gc-critical">
      <summary>Critico da tabella</summary>
      <form className="gc-details-body gc-stack" onSubmit={submit}>
        <label className="gc-field">
          <span>Punteggio concordato nel Codex</span>
          <input type="number" min="1" max="41" step="1" required value={value} onChange={event => setScore(event.target.value)} />
        </label>
        <button type="submit" className="gc-secondary" disabled={!canSubmit || busy}>
          {critical ? 'Aggiorna il critico' : hasDice ? 'Critico · vai al tiro sulla mappa' : 'Calcola il critico'}
        </button>
      </form>
    </details>
  );
}

function CriticalResult({ critical }) {
  const roll = critical.roll == null ? '' : String(critical.roll) + (critical.bonus ? signedCombatModifier(critical.bonus) : '');
  return (
    <dl className="gc-critical-result">
      <DetailRow label="Riga del Codex">{[critical.score, critical.multiplier].filter(Boolean).join(' · ')}</DetailRow>
      <DetailRow label="Tiro critico">{roll}</DetailRow>
      <DetailRow label="RD effettiva">{critical.reduction}</DetailRow>
      <DetailRow label="Danno con critico">
        {critical.tableRoll ? critical.tableRoll + ' · da calcolare al tavolo' : critical.total}
      </DetailRow>
      <DetailRow label="Effetto del critico">{critical.effect}</DetailRow>
    </dl>
  );
}

function TargetRolls({ target, targets, kind, hands, busy, onCritical, criticalHasDice, proposal, damage = IDLE, onApplyDamage, onRollDamage, isManager, cancelled }) {
  const name = combatTargetName(target, targets);
  // What the server recorded wins; the reply to this viewer's own request covers the moments before its snapshot arrives.
  const applied = combatAppliedDamage(target) || damage.applied || null;
  const pending = cancelled ? '' : target.status === 'waiting' ? 'In attesa' : target.status === 'retry' ? 'Parità · rilancio' : '';
  const outcome = value => cancelled && value === 'tie' ? 'Parità' : combatOutcomeLabel(value, kind, hands);
  const result = pending || outcome(target.outcome);
  const trials = target.trials || [];
  const latest = trials[trials.length - 1];
  const showCurrent = !latest || target.round !== latest.round;
  return (
    <div className="gc-log-target">
      <strong>{name}{result && ' · ' + result}</strong>
      {trials.map((trial, index) => (
        <dl key={trial.round ?? index}>
          <DetailRow label={'Prova ' + (trial.round ?? index + 1)}>{outcome(trial.outcome)}</DetailRow>
          <LoggedRoll roll={trial.attack} />
          <LoggedRoll roll={trial.defense} />
          {isManager && trial.defenseAdjusted === true && (
            <DetailRow label="Valori modificati" className="gc-override">Difesa impostata manualmente</DetailRow>
          )}
          <DetailRow label="Danno proposto">{trial.damage}</DetailRow>
        </dl>
      ))}
      {showCurrent && <dl><LoggedRoll roll={target.attack} /><LoggedRoll roll={target.defense} /></dl>}
      {!cancelled && target.pendingDamage && <p className="gc-hint">In attesa del tiro di danno · {target.pendingDamage.expr}</p>}
      {target.pendingDamage && onRollDamage && <button className="gc-secondary" type="button" disabled={busy} onClick={onRollDamage}>
        Danno contro {name} · vai al tiro sulla mappa
      </button>}
      {target.critical && <CriticalResult critical={target.critical} />}
      {/* Once damage is applied the critical behind it is final; while it is being applied it holds still. */}
      {onCritical && !applied && !target.pendingDamage && target.status === 'done' && target.outcome === 'hit' && (
        <CriticalInput critical={target.critical} hasDice={criticalHasDice} onCritical={onCritical} busy={busy || Boolean(damage.busy)} />
      )}
      {onApplyDamage && (applied || (proposal && (!damage.unavailable || damage.busy)))
        ? <TargetDamage name={name} proposal={proposal} floor={combatDamageFloor(proposal, isManager)}
            criticalScore={target.critical?.score ?? null} applied={applied} state={damage} onApply={onApplyDamage} />
        : applied && <AppliedDamage applied={applied} />}
      {onApplyDamage && proposal && !applied && damage.unavailable && !damage.busy && (
        <p className="gc-hint">Bersaglio non più sulla mappa.</p>
      )}
    </div>
  );
}

function EffectValue({ effect, recipient }) {
  if (effect.kind === 'damage' && (effect.label === 'Danno base' || recipient?.damageDetails)) {
    const total = effect.amount ?? recipient?.damage;
    const details = recipient?.damageDetails;
    if (!details) return total;
    const { raw, subtotal, reduction, hands } = details;
    const twoHanded = hands === 2;
    return (
      <>
        <div>{effect.expr ? effect.expr + ' → ' : 'Tiro arma · '}{raw}</div>
        <div>max(0, {subtotal} − {reduction} RD){twoHanded && ' × 1,5'} = {total}{twoHanded && ' (arrotondato per eccesso)'}</div>
      </>
    );
  }

  const summary = [effect.expr, effect.amount].filter(value => value !== '' && value != null).join(' → ');
  return summary || effect.description || 'Da applicare al tavolo';
}

function CombatHistoryEntry({ event, busy, onCritical, onApplyDamage, onRollDamage, canApplyDamage, damageState, isRollRecorded,
  onCancel, cancel, onCancellationDetails, isManager }) {
  const { actor, action, targets = [], affected = [], cost, effects = [] } = event;
  const cancelled = event.status === 'cancelled';
  const needsReview = needsCancellationReview(event, isManager);
  const rollDamage = !cancelled && event.status !== 'awaitingConfirmation' && onRollDamage;
  const destination = eventDestinations(event);
  // The DM spots typed defense values without opening every entry.
  const overridden = isManager && targets.some(target => (target.trials || []).some(trial => trial.defenseAdjusted === true));
  // Per target: the DM answers for every pawn, a player only for their own.
  const damageCommand = target => (!cancelled && onApplyDamage && event.id && !target.pendingDamage && (!canApplyDamage || canApplyDamage(event, target))
    ? amount => onApplyDamage(event, target, amount)
    : undefined);
  // The card's own text replaces the generic table line (the manual effect bound to no pawn), so a condition stays in
  // view next to a rolled or table-rolled damage. Per-pawn table lines such as an uncovered damage band stay.
  const instruction = combatCardText(action, event.kind);
  const listed = instruction ? effects.filter(({ kind, targetPlacementId }) => kind !== 'manual' || targetPlacementId) : effects;
  return (
    <details className="gc-log-entry">
      <summary>
        <span className="gc-log-icon" data-kind={event.kind}><FaDiceD20 aria-hidden="true" /></span>
        <span className="gc-log-caption">
          <small>{actor?.name || 'Attaccante'}{destination && <><FaArrowRight aria-hidden="true" />{destination}</>}</small>
          <strong>{action?.name || 'Azione'}</strong>
          <span>{eventResult(event) + (overridden ? ' · valori di difesa modificati' : '')}</span>
          {needsReview && <span className="gc-cancel-review">Effetti da verificare al tavolo.</span>}
        </span>
      </summary>
      <div className="gc-log-detail">
        {needsReview && onCancellationDetails && <CancellationDetails {...{ event, onCancellationDetails }} />}
        {/* A private summary: the outcome on the viewer's own pawns, never the attacker or the other targets. */}
        {event.ownerPrivate && <p className="gc-hint">Riepilogo privato: solo l’esito sulle tue pedine.</p>}
        {targets.map(target => (
          <TargetRolls
            key={target.placementId}
            {...{ target, targets, busy, isManager, cancelled }}
            kind={event.kind}
            hands={action?.hands}
            criticalHasDice={action?.criticalHasDice}
            onCritical={!cancelled && onCritical && action?.hands > 0 ? score => onCritical(event, target, score) : undefined}
            proposal={combatDamageProposal(event, target)}
            damage={cancelled ? undefined : damageState?.(event, target)}
            onApplyDamage={damageCommand(target)}
            onRollDamage={rollDamage && !isRollRecorded?.(event, target) && (() => rollDamage(event, target))}
          />
        ))}
        <dl>
          {!targets.length && <LoggedRoll roll={event.attack} />}
          {event.point && affected.length > 0 && (
            <DetailRow label="Pedine nell’area">
              {affected.map(target => combatTargetName(target, affected)).join(', ')}
            </DetailRow>
          )}
          <DetailRow label="Costo">{combatSpentLabel(cost)}</DetailRow>
          {listed.map((effect, index) => {
            const recipient = targets.find(target => target.placementId === effect.targetPlacementId);
            const label = effect.label || (effect.kind === 'heal' ? 'Cura' : effect.kind === 'damage' ? 'Danno' : 'Effetto');
            return (
              <DetailRow key={index} label={recipient ? label + ' · ' + combatTargetName(recipient, targets) : label}>
                <EffectValue effect={effect} recipient={recipient} />
              </DetailRow>
            );
          })}
        </dl>
        {event.pendingDamage && rollDamage && !isRollRecorded?.(event, null) && <button className="gc-secondary" type="button" disabled={busy}
          onClick={() => rollDamage(event, null)}>Danno {event.pendingDamage.expr} · vai al tiro sulla mappa</button>}
        {instruction && <p className="gc-source">{instruction}</p>}
        {onCancel && <CancelCombat {...{ event, onCancel }} state={cancel} />}
      </div>
    </details>
  );
}

// `isManager` is the signed-in DM: free damage amounts and the defense audit. Anyone else is held to each proposal.
export function GrigliataCombatHistory({
  events, actor, currentUserId, busy, onCritical, onApplyDamage, onRollDamage, canApplyDamage, damageState,
  onCancel, canCancel = combatCanCancel, cancelState, onCancellationDetails, isManager = false, isRollRecorded,
}) {
  const isOwner = event => currentUserId
    ? (event.actorUid || event.actor?.ownerUid) === currentUserId
    : Boolean(actor?.placementId && event.actor?.placementId === actor.placementId);
  return (
    <details className="gc-surface gc-details gc-history">
      <summary><FaHistory aria-hidden="true" />Registro{events.length > 0 && <small>{events.length}</small>}</summary>
      {events.length > 0 ? (
        <div className="gc-log-list">
          {events.map(event => {
            const own = isOwner(event);
            const cancel = cancelState?.(event);
            return (
              <CombatHistoryEntry
                key={event.id || event.combatId}
                {...{ event, onApplyDamage, canApplyDamage, damageState, isManager, cancel, onCancellationDetails, isRollRecorded }}
                busy={busy || cancel?.busy}
                onCritical={own ? onCritical : undefined}
                onRollDamage={isManager && !own ? onRollDamage : undefined}
                onCancel={(own || isManager) && canCancel(event) ? onCancel : undefined}
              />
            );
          })}
        </div>
      ) : <p className="gc-empty">Nessuna azione registrata.</p>}
    </details>
  );
}

const resolvedTime = event => combatTime(event.status === 'cancelled' ? event.updatedAt : event.resolvedAt || event.createdAt);
const confirmationTime = event => combatTime(event.updatedAt === undefined ? event.createdAt : event.updatedAt);

// Keep every open defense or roll in view, plus the newest damage confirmation. The journal carries the rest.
// The selected pawn also keeps its latest terminal result, including an older launch resolved late.
export function GrigliataCombatStatus({ actor, pending, events, busy, onRetry, onRollDamage, onCancel,
  canCancel = combatCanCancel, cancelState, isManager, isRollRecorded }) {
  const selected = actor?.placementId;
  const latest = selected && events.filter(event => event.actor?.placementId === selected && ['done', 'cancelled'].includes(event.status))
    .reduce((last, event) => (!last || resolvedTime(event) > resolvedTime(last) ? event : last), null);
  const resolved = latest && !pending.some(event => event.id === latest.id);
  const confirmation = pending.filter(event => event.status === 'awaitingConfirmation')
    .reduce((last, event) => (!last || confirmationTime(event) >= confirmationTime(last) ? event : last), null);
  const shown = pending.filter(event => event.status !== 'awaitingConfirmation' || event === confirmation);
  // Pawn names only when they tell actions apart: not the selected pawn, or several pawns while none is selected.
  const named = shown.some(event => event.actor?.placementId !== (selected || shown[0].actor?.placementId));
  return (resolved ? [...shown, latest] : shown).map(event => {
    const cancel = cancelState?.(event);
    const active = !['done', 'cancelled', 'awaitingConfirmation'].includes(event.status);
    const working = busy || cancel?.busy;
    return (
      <section className="gc-status-card" aria-label="Stato dell’azione" key={event.id || event.combatId}>
        <div className="gc-flex">
          <FaClock aria-hidden="true" />
          <div>
            <strong>{[named && event.actor?.name, event.action?.name || 'Azione'].filter(Boolean).join(' · ')}</strong>
            <p role="status">{eventResult(event)}</p>
          </div>
        </div>
        {needsCancellationReview(event, isManager) && <p className="gc-hint gc-cancel-review">Effetti da verificare al tavolo.</p>}
        {active && event.pendingDamage && onRollDamage && !isRollRecorded?.(event, null) && (
          <button type="button" className="gc-secondary" disabled={working} onClick={() => onRollDamage(event, null)}>
            Danno {event.pendingDamage.expr} · vai al tiro sulla mappa
          </button>
        )}
        {active && (
          <ul>
            {(event.targets || []).map(target => (
              <li key={target.placementId}>
                <div>
                  <strong>{combatTargetName(target, event.targets)}</strong>
                  {target.attack && <small>{target.attack.label} · {formatCombatRoll(target.attack)}</small>}
                </div>
                {isRollRecorded?.(event, target) ? <small>Tiro registrato</small> : target.pendingDamage && onRollDamage ? (
                  <button type="button" className="gc-secondary" disabled={working} onClick={() => onRollDamage(event, target)}>
                    Danno contro {combatTargetName(target, event.targets)} · vai al tiro sulla mappa
                  </button>
                ) : target.status === 'retry' && onRetry ? (
                  <button type="button" className="gc-secondary" disabled={working} onClick={() => onRetry(event, target)}>
                    Rilancia contro {combatTargetName(target, event.targets)}
                  </button>
                ) : (
                  <small>{target.status === 'waiting' ? 'Tocca al proprietario' : combatOutcomeLabel(target.outcome, event.kind, event.action?.hands)}</small>
                )}
              </li>
            ))}
          </ul>
        )}
        {onCancel && canCancel(event) && <CancelCombat {...{ event, onCancel }} state={cancel} />}
      </section>
    );
  });
}
