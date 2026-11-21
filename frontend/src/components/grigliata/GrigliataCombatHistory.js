import React, { useState } from 'react';
import { FaArrowRight, FaClock, FaDiceD20, FaHistory } from 'react-icons/fa';
import {
  combatAppliedDamage, combatCardText, combatDamageProposal, combatOutcomeLabel, combatPointLabel, combatSpentLabel, combatTargetName,
  combatTime, formatCombatRoll, signedCombatModifier,
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
  if (event.status === 'waiting') return 'In attesa di risposta';
  if (event.status === 'retry') return 'Parità · rilancio';
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

function DetailRow({ label, children }) {
  if (children === '' || children == null) return null;
  return (
    <div className="gc-rule-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LoggedRoll({ roll }) {
  return roll && <DetailRow label={roll.label || 'Tiro'}>{formatCombatRoll(roll)}</DetailRow>;
}

function CriticalInput({ critical, onCritical, busy }) {
  const [score, setScore] = useState(null);
  const value = score ?? critical?.score ?? '';
  const row = Number(value);
  const canSubmit = Number.isInteger(row) && row >= 1 && row <= 41 && row !== critical?.score;

  function submit(event) {
    event.preventDefault();
    if (canSubmit && !busy) onCritical(row);
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
          {critical ? 'Aggiorna il critico' : 'Calcola il critico'}
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

function TargetRolls({ target, targets, kind, hands, busy, onCritical, proposal, damage = IDLE, onApplyDamage }) {
  const name = combatTargetName(target, targets);
  // What the server recorded wins; the reply to this viewer's own request covers the moments before its snapshot arrives.
  const applied = combatAppliedDamage(target) || damage.applied || null;
  const pending = target.status === 'waiting' ? 'In attesa' : target.status === 'retry' ? 'Parità · rilancio' : '';
  const result = pending || combatOutcomeLabel(target.outcome, kind, hands);
  const trials = target.trials || [];
  const latest = trials[trials.length - 1];
  const showCurrent = !latest || target.round !== latest.round;
  return (
    <div className="gc-log-target">
      <strong>{name}{result && ' · ' + result}</strong>
      {trials.map((trial, index) => (
        <dl key={trial.round ?? index}>
          <DetailRow label={'Prova ' + (trial.round ?? index + 1)}>{combatOutcomeLabel(trial.outcome, kind, hands)}</DetailRow>
          <LoggedRoll roll={trial.attack} />
          <LoggedRoll roll={trial.defense} />
          <DetailRow label="Danno proposto">{trial.damage}</DetailRow>
        </dl>
      ))}
      {showCurrent && <dl><LoggedRoll roll={target.attack} /><LoggedRoll roll={target.defense} /></dl>}
      {target.critical && <CriticalResult critical={target.critical} />}
      {/* Once damage is applied the critical behind it is final; while it is being applied it holds still. */}
      {onCritical && !applied && target.status === 'done' && target.outcome === 'hit' && (
        <CriticalInput critical={target.critical} onCritical={onCritical} busy={busy || Boolean(damage.busy)} />
      )}
      {onApplyDamage && (applied || (proposal && (!damage.unavailable || damage.busy)))
        ? <TargetDamage name={name} proposal={proposal} criticalScore={target.critical?.score ?? null}
            applied={applied} state={damage} onApply={onApplyDamage} />
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

function CombatHistoryEntry({ event, busy, onCritical, onApplyDamage, canApplyDamage, damageState }) {
  const { actor, action, targets = [], affected = [], cost, effects = [] } = event;
  const destination = eventDestinations(event);
  // Per target: the DM answers for every pawn, a player only for their own.
  const damageCommand = target => (onApplyDamage && event.id && (!canApplyDamage || canApplyDamage(event, target))
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
          <span>{eventResult(event)}</span>
        </span>
      </summary>
      <div className="gc-log-detail">
        {/* A private summary: the outcome on the viewer's own pawns, never the attacker or the other targets. */}
        {event.ownerPrivate && <p className="gc-hint">Riepilogo privato: solo l’esito sulle tue pedine.</p>}
        {targets.map(target => (
          <TargetRolls
            key={target.placementId}
            {...{ target, targets, busy }}
            kind={event.kind}
            hands={action?.hands}
            onCritical={onCritical && action?.hands > 0 ? score => onCritical(event, target, score) : undefined}
            proposal={combatDamageProposal(event, target)}
            damage={damageState?.(event, target)}
            onApplyDamage={damageCommand(target)}
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
        {instruction && <p className="gc-source">{instruction}</p>}
      </div>
    </details>
  );
}

export function GrigliataCombatHistory({
  events, actor, currentUserId, busy, onCritical, onApplyDamage, canApplyDamage, damageState,
}) {
  const isOwner = event => currentUserId
    ? (event.actorUid || event.actor?.ownerUid) === currentUserId
    : Boolean(actor?.placementId && event.actor?.placementId === actor.placementId);
  return (
    <details className="gc-surface gc-details gc-history">
      <summary><FaHistory aria-hidden="true" />Registro{events.length > 0 && <small>{events.length}</small>}</summary>
      {events.length > 0 ? (
        <div className="gc-log-list">
          {events.map(event => (
            <CombatHistoryEntry
              key={event.id || event.combatId}
              event={event}
              {...{ busy, onApplyDamage, canApplyDamage, damageState }}
              onCritical={isOwner(event) ? onCritical : undefined}
            />
          ))}
        </div>
      ) : <p className="gc-empty">Nessuna azione registrata.</p>}
    </details>
  );
}

const resolvedTime = event => combatTime(event.resolvedAt || event.createdAt);

// `pending` is every unresolved action of the signed-in player on this map, whichever pawn launched it:
// it stays until answered. The journal only adds the selected pawn's latest result: the action answered
// last, so an old attack answered late shows its outcome even after newer ones.
export function GrigliataCombatStatus({ actor, pending, events, busy, onRetry }) {
  const selected = actor?.placementId;
  const latest = selected && events.filter(event => event.actor?.placementId === selected && event.status === 'done')
    .reduce((last, event) => (!last || resolvedTime(event) > resolvedTime(last) ? event : last), null);
  const resolved = latest && !pending.some(event => event.id === latest.id);
  // Pawn names only when they tell actions apart: not the selected pawn, or several pawns while none is selected.
  const named = pending.some(event => event.actor?.placementId !== (selected || pending[0].actor?.placementId));
  return (resolved ? [...pending, latest] : pending).map(event => (
    <section className="gc-status-card" aria-label="Stato dell’azione" key={event.id || event.combatId}>
      <div className="gc-flex">
        <FaClock aria-hidden="true" />
        <div>
          <strong>{[named && event.actor?.name, event.action?.name || 'Azione'].filter(Boolean).join(' · ')}</strong>
          <p role="status">{eventResult(event)}</p>
        </div>
      </div>
      {event.status !== 'done' && (
        <ul>
          {(event.targets || []).map(target => (
            <li key={target.placementId}>
              <div>
                <strong>{combatTargetName(target, event.targets)}</strong>
                {target.attack && <small>{target.attack.label} · {formatCombatRoll(target.attack)}</small>}
              </div>
              {target.status === 'retry' && onRetry ? (
                <button
                  type="button"
                  className="gc-secondary"
                  disabled={busy}
                  onClick={() => onRetry(event, target)}
                >
                  Rilancia contro {combatTargetName(target, event.targets)}
                </button>
              ) : (
                <small>{target.status === 'waiting' ? 'Tocca al proprietario' : combatOutcomeLabel(target.outcome, event.kind, event.action?.hands)}</small>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  ));
}
