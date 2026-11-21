import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { FaArrowRight, FaBookOpen, FaBullseye, FaCheck, FaDiceD20, FaTint, FaUser, FaTimes } from 'react-icons/fa';
import { GiCrossedSwords, GiShield, GiSpellBook } from 'react-icons/gi';
import MediaImage from '../common/MediaImage';
import { GrigliataCombatHistory, GrigliataCombatStatus } from './GrigliataCombatHistory';
import {
  COMBAT_CONE_HINT,
  COMBAT_KIND_LABEL,
  COMBAT_RANGE_UNSET,
  combatBandLabel,
  combatBandSpan,
  combatCheckLabel,
  combatCostLabel,
  combatExtraCost,
  combatPointLabel,
  combatResourceConfirmLabel,
  combatRoleStep,
  combatStepRange,
  combatTargetName,
  formatCombatRange,
  getCombatLaunchBlock,
  signedCombatModifier,
} from './combatPresentation';
import { picksGround, picksMultiple } from './combatTargeting';
import './grigliataCombat.css';

const KIND_GLYPH = { weapon: GiCrossedSwords, spell: GiSpellBook, tecnica: FaBookOpen };
const LAUNCH_LABEL = { weapon: 'Attacca', spell: 'Lancia spell', tecnica: 'Usa tecnica' };
const EMPTY_ACTIONS = { spell: 'Nessuno spell appreso.', tecnica: 'Nessuna tecnica disponibile.' };
const HANDS = [
  { slot: 'weaponMain', label: 'Mano principale' },
  { slot: 'weaponOff', label: 'Mano secondaria' },
];

function HandSlots({ equipped, actions, selected, onSelectAction }) {
  return (
    <div className="gc-hands" role="group" aria-label="Armi impugnate">
      {HANDS.map(({ slot, label }, index) => {
        const action = actions.find(weapon => (weapon.slot || weapon.id) === slot);
        const item = equipped?.[slot] || action;
        const otherSlot = HANDS[1 - index].slot;
        const other = equipped?.[otherSlot] || actions.find(weapon => (weapon.slot || weapon.id) === otherSlot);
        const occupied = !item && other?.hands === 2;
        const Icon = action ? GiCrossedSwords : GiShield;
        const art = item?.art || action?.art;
        const media = item?.media || action?.media;
        const content = (
          <>
            {art || media ? (
              <span className="gc-portrait">
                <MediaImage media={media} src={art} alt="" variant="thumbnail" fallback={<Icon aria-hidden="true" />} />
              </span>
            ) : <Icon aria-hidden="true" />}
            <span>
              <small>{label}</small>
              <strong>{item?.name || (occupied ? 'Impugnatura a due mani' : 'Libera')}</strong>
              {action && <small>{[action.damageExpr, formatCombatRange(action)].filter(Boolean).join(' · ')}</small>}
            </span>
          </>
        );
        return action ? (
          <button key={slot} type="button" className="gc-hand" aria-pressed={selected?.id === action.id} onClick={() => onSelectAction(action)}>
            {content}
          </button>
        ) : (
          <div key={slot} className="gc-hand">{content}</div>
        );
      })}
    </div>
  );
}

function AbilityCards({ kind, actions, selected, onSelectAction }) {
  if (!actions.length) return <p className="gc-empty">{EMPTY_ACTIONS[kind]}</p>;
  const Icon = KIND_GLYPH[kind];
  return (
    <div className="gc-cards" role="group" aria-label={COMBAT_KIND_LABEL[kind] + ' disponibili'}>
      {actions.map(action => {
        const checked = selected?.id === action.id;
        return (
          <button
            className="gc-card"
            data-kind={kind}
            type="button"
            key={action.id}
            aria-pressed={checked}
            onClick={() => onSelectAction(action)}
          >
            <Icon className="gc-card-emblem" aria-hidden="true" />
            {(action.art || action.media) && (
              <MediaImage
                className="gc-card-art"
                media={action.media}
                mediaPurpose={kind === 'tecnica' ? 'technique' : kind}
                src={action.art}
                alt=""
                variant="card"
              />
            )}
            <span className="gc-card-scrim" aria-hidden="true" />
            <span className="gc-card-top">
              {checked && <FaCheck className="gc-card-check" aria-hidden="true" />}
              <small className="gc-card-price">{combatCostLabel(action)}</small>
            </span>
            <span className="gc-card-name">
              <strong>{action.name}</strong>
              {action.sourceItem && <small className="gc-card-source">{action.sourceItem}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CombatIdentity({ actor, turn }) {
  return (
    <div className="gc-identity">
      <div className="gc-flex">
        <span className="gc-portrait">
          {actor.imageUrl ? <MediaImage src={actor.imageUrl} alt="" variant="thumbnail" /> : <FaUser aria-hidden="true" />}
        </span>
        <div>
          <strong>{actor.name}</strong>
          {(turn?.isCurrent || turn?.name) && (
            <small>{turn.isCurrent ? 'Il tuo turno' : 'Turno di ' + turn.name}</small>
          )}
        </div>
      </div>
      {actor.mana != null && <span className="gc-mana"><FaTint aria-hidden="true" />{actor.mana} PM</span>}
    </div>
  );
}

function TargetControl({
  actor, action, point, selectedTargets, targetCount, picking, areaTargets, onBeginTargeting, onRemoveTarget,
}) {
  if (action.mode === 'self') {
    return <p className="gc-target-self"><FaBullseye aria-hidden="true" />Su di te · {actor.name}</p>;
  }
  if (action.mode === 'manual' && action.maxTargets === 0) return null;
  const pointAction = picksGround(action);
  const multi = picksMultiple(action);
  let title = 'Scegli bersaglio sulla mappa';
  if (action.mode === 'manual') title = 'Indica un bersaglio facoltativo';
  if (pointAction) title = 'Scegli casella sulla mappa';
  if (multi && !pointAction) title = 'Scegli bersagli sulla mappa';
  const range = combatStepRange(action, targetCount);
  const selection = point ? combatPointLabel(point) : null;
  const state = combatRoleStep(action, targetCount) || (picking ? 'Selezione sulla plancia' : '');
  const limit = action.maxTargets && multi && !action.targetRoles?.length ? 'Fino a ' + action.maxTargets + ' bersagli' : '';
  const detail = [state, range || limit].filter(Boolean).join(' · ');
  const banded = action.damageBands?.length ? selectedTargets.filter(target => Number.isFinite(target.distanceFt)) : [];
  return (
    <div className="gc-targets">
      {onBeginTargeting && (
        <button
          type="button"
          className="gc-target-control"
          aria-label={[title, selection].filter(Boolean).join(' · ')}
          aria-pressed={Boolean(picking)}
          onClick={() => onBeginTargeting(action)}
        >
          <FaBullseye aria-hidden="true" />
          <span>
            <strong>{selection || title}</strong>
            {detail && <small>{detail}</small>}
          </span>
          <FaArrowRight aria-hidden="true" />
        </button>
      )}
      {!onBeginTargeting && selection && <p>{selection}</p>}
      {selectedTargets.length > 0 && (
        <ul className="gc-target-chips" aria-label="Bersagli scelti">
          {selectedTargets.map((target, index) => {
            const label = [action.targetRoles?.[index], combatTargetName(target, selectedTargets)].filter(Boolean).join(' · ');
            return (
              <li key={target.placementId}>
                <span>{label}</span>
                {onRemoveTarget && (
                  <button type="button" aria-label={'Rimuovi ' + label} onClick={() => onRemoveTarget(target.placementId)}>
                    <FaTimes aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {point && areaTargets?.length > 0 && (
        <p className="gc-hint">Pedine nell’area · {areaTargets.map(target => combatTargetName(target, areaTargets)).join(', ')}</p>
      )}
      {action.area?.shape === 'cone' && <p className="gc-hint">{COMBAT_CONE_HINT}</p>}
      {banded.map(target => (
        <p key={target.placementId} className="gc-hint">
          {combatTargetName(target, selectedTargets)} · {combatBandLabel(action, target.distanceFt)}
        </p>
      ))}
    </div>
  );
}

function RuleRow({ label, children }) {
  return (
    <div className="gc-rule-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ActionRules({ action, check }) {
  const { attackLabel, attackDie, attackBonus, defenseStats, defenseDie, opposed, consent } = check;
  const die = action.die ? 'd' + action.die : 'Dado Anima';
  const attack = attackDie
    ? die + (attackBonus ? signedCombatModifier(attackBonus) : '')
    : (attackLabel && attackBonus != null ? String(attackBonus) : '');
  const defense = combatCheckLabel(defenseStats) + (defenseDie ? ' + Dado Anima' : '');
  // Spells and techniques that strike with the wielded weapon resolve like the weapon.
  const isWeapon = action.kind === 'weapon' || action.hands > 0;
  const damage = isWeapon && action.damageExpr
    ? [action.attackStat ?? 'Attacco', action.damageExpr].join(' + ')
      + (action.damageBonus ? signedCombatModifier(action.damageBonus) : '') + ' − RD'
    : action.damageExpr;
  const weaponRule = action.hands === 2 && isWeapon
    ? 'Due mani · ×1,5 sul danno netto, arrotondato per eccesso.'
    : '';
  const cost = [
    action.baseCost > 0 && action.baseCost + ' PM base' + (action.baseCost !== action.cost ? ' → ' + action.cost + ' PM' : ''),
    combatExtraCost(action.extraResource),
  ].filter(Boolean).join(' + ');
  const choosesTargets = action.mode !== 'self' && !(action.mode === 'manual' && action.maxTargets === 0);
  const range = formatCombatRange(action) || (choosesTargets ? COMBAT_RANGE_UNSET : '');
  const criticalDamage = action.criticalExpr && (
    action.criticalExpr + (action.criticalBonus ? signedCombatModifier(action.criticalBonus) : '')
  );
  return (
    <details className="gc-details gc-rules">
      <summary><FaBookOpen aria-hidden="true" />Regole dell’azione</summary>
      <div className="gc-details-body">
        <dl>
          {action.sourceItem && <RuleRow label="Concesso da">{action.sourceItem}</RuleRow>}
          {consent && <RuleRow label="Risposta richiesta">Consenso del bersaglio</RuleRow>}
          {attack && <RuleRow label={attackLabel || 'Prova'}><code>{attack}</code></RuleRow>}
          {opposed && !consent && <RuleRow label="Difesa"><code>{defense}</code></RuleRow>}
          {action.attackModifiers?.map(({ label, value }) => <RuleRow key={label} label={label}>{value}</RuleRow>)}
          {damage && <RuleRow label={isWeapon ? 'Danno base' : 'Danno'}><code>{damage}</code></RuleRow>}
          {action.damageBands?.map(band => (
            <RuleRow key={band.minFt + '-' + band.maxFt} label={'Danno a ' + combatBandSpan(band)}>
              <code>{band.expr}</code>{band.note && ' · ' + band.note}
            </RuleRow>
          ))}
          {criticalDamage && <RuleRow label="Danno critico"><code>{criticalDamage}</code></RuleRow>}
          {action.healExpr && <RuleRow label="Cura"><code>{action.healExpr}</code></RuleRow>}
          {cost && <RuleRow label="Costo">{cost}</RuleRow>}
          {action.actionEconomy && <RuleRow label="Azione del turno">{action.actionEconomy}</RuleRow>}
          {range && <RuleRow label="Gittata">{range}</RuleRow>}
          {action.turns > 0 && <RuleRow label="Durata">{action.turns} {action.turns === 1 ? 'turno' : 'turni'}</RuleRow>}
          {action.area?.shape === 'square' && action.area.sideSquares > 0 && (
            <RuleRow label="Area">{action.area.sideSquares} × {action.area.sideSquares} caselle</RuleRow>
          )}
          {action.area?.shape === 'cone' && <RuleRow label="Area">Cono</RuleRow>}
        </dl>
        {opposed && !consent && <p className="gc-hint gc-rule-note">In caso di parità, entrambi rilanciano.</p>}
        {weaponRule && <p>{weaponRule}</p>}
        {action.description && <p className="gc-source">{action.description}</p>}
        {typeof action.manualEffect === 'string' && action.manualEffect !== action.description && <p className="gc-source">{action.manualEffect}</p>}
      </div>
    </details>
  );
}

function CombatDraft({
  actor, action, selection, targets, turn, busy, arsenalSync, onBeginTargeting, onRemoveTarget, onLaunch, onPrepareLaunch,
}) {
  const unconfirmed = arsenalSync !== 'ready';
  const checks = action.checks || [];
  const [channel, setChannel] = useState('');
  const [variableCost, setVariableCost] = useState('');
  const [approvedHpCost, setApprovedHpCost] = useState(null);
  const [confirmExtra, setConfirmExtra] = useState(false);
  const check = checks.find(choice => choice.channel === (channel || action.channel)) || checks[0] || action;
  const point = picksGround(action) ? selection.point : null;
  const targetIds = point ? [] : selection.targetIds || [];
  const selectedTargets = targetIds.map(id => targets.find(target => target.placementId === id)).filter(Boolean);
  const due = action.variableCost ? Number(variableCost) || 0 : (action.cost ?? 0);
  const hpCost = Math.max(0, due - Math.max(0, actor.mana ?? 0));
  const targetKey = JSON.stringify([targetIds, point]);
  const approvalKey = JSON.stringify([targetKey, check.channel]);
  const [lastApprovalKey, setLastApprovalKey] = useState(approvalKey);
  const [lastHpCost, setLastHpCost] = useState(hpCost);
  if (approvalKey !== lastApprovalKey) {
    setLastApprovalKey(approvalKey);
    setApprovedHpCost(null);
    setConfirmExtra(false);
  }
  if (hpCost !== lastHpCost) {
    setLastHpCost(hpCost);
    setApprovedHpCost(null);
  }

  const confirmHp = hpCost > 0 && approvedHpCost === hpCost;
  const needsThrow = Boolean(onPrepareLaunch && check.attackDie);
  const block = getCombatLaunchBlock({
    actor, action, point, targetCount: targetIds.length, picking: selection.picking,
    turn, variableCost, hpCost, confirmHp, confirmExtra,
  }) || (needsThrow && !action.die ? 'Il Dado Anima della pedina non è configurato.' : '');
  const blockId = useId();
  const Icon = KIND_GLYPH[action.kind];
  const checkLabel = choice => choice.consent ? 'Consenso del bersaglio' : choice.channel;
  const cancelPrepared = useRef(null);
  const lastAim = useRef(null);
  // A prepared launch belongs to the exact declaration and approvals the player saw.
  const declaration = JSON.stringify([approvalKey, variableCost, confirmHp, hpCost, confirmExtra, block]);
  useLayoutEffect(() => () => {
    cancelPrepared.current?.();
    cancelPrepared.current = null;
  }, [declaration]);
  useLayoutEffect(() => {
    if (unconfirmed) cancelPrepared.current?.({ includeError: false });
  }, [unconfirmed]);

  const disabled = Boolean(block || busy || unconfirmed || !onLaunch);
  const launchOptions = () => ({
    targetPlacementIds: action.mode === 'self' ? [actor.placementId] : targetIds,
    point: point || undefined,
    channel: check.channel,
    confirmHp,
    maxHpCost: confirmHp ? hpCost : 0,
    variableCost: action.variableCost ? Number(variableCost) : undefined,
    confirmExtra,
  });
  // A completed pick gives the map the next interaction only if this form could already submit.
  useLayoutEffect(() => {
    const completed = selection.aimCompletion;
    if (!completed || completed === lastAim.current) return;
    lastAim.current = completed;
    if (needsThrow && !disabled) cancelPrepared.current = onPrepareLaunch(action, launchOptions(), completed.trigger);
    else completed.restoreFocus();
  });

  function launch(event) {
    event.preventDefault();
    if (disabled) return;
    if (needsThrow) cancelPrepared.current = onPrepareLaunch(action, launchOptions());
    else onLaunch(action, launchOptions());
  }

  return (
    <form className="gc-stack" onSubmit={launch}>
      <TargetControl
        {...{ actor, action, point, selectedTargets, onBeginTargeting, onRemoveTarget }}
        areaTargets={selection.areaTargets}
        targetCount={targetIds.length}
        picking={selection.picking}
      />
      {checks.length > 1 && (
        <label className="gc-field">
          <span>Prova</span>
          <select value={check.channel} onChange={event => setChannel(event.target.value)}>
            {checks.map(choice => <option key={choice.channel} value={choice.channel}>{checkLabel(choice)}</option>)}
          </select>
        </label>
      )}
      <ActionRules action={action} check={check} />
      {action.variableCost && (
        <label className="gc-field">
          <span>Mana da spendere</span>
          <input type="number" min="0" step="1" value={variableCost} required onChange={event => {
            setVariableCost(event.target.value);
            setApprovedHpCost(null);
          }} />
          {typeof action.variableCost === 'string' && <small>{action.variableCost}</small>}
        </label>
      )}
      {hpCost > 0 && hpCost <= actor.hp && (
        <label className="gc-confirm">
          <input type="checkbox" checked={confirmHp} onChange={event => setApprovedHpCost(event.target.checked ? hpCost : null)} />
          Spendi {hpCost} PF
        </label>
      )}
      {action.extraResource && (
        <label className="gc-confirm">
          <input type="checkbox" checked={confirmExtra} onChange={event => setConfirmExtra(event.target.checked)} />
          {combatResourceConfirmLabel(action.extraResource)}
        </label>
      )}
      {block && <p id={blockId} className="gc-hint">{block}</p>}
      <button
        className="gc-primary"
        type="submit"
        disabled={disabled}
        aria-describedby={block ? blockId : undefined}
      >
        <Icon aria-hidden="true" />{busy ? 'Invio in corso…' : arsenalSync === 'reloading' ? 'Aggiornamento…'
          : needsThrow ? 'Vai al tiro sulla mappa' : LAUNCH_LABEL[action.kind]}
      </button>
    </form>
  );
}

function Arsenal({
  actor, actions, equipped, targets, turn, selection, busy, arsenalSync, onSelectAction, onBeginTargeting, onRemoveTarget, onLaunch, onPrepareLaunch,
}) {
  // The selection is the only source: the tab shown is the selected action's kind (or an empty kind chosen).
  const action = actions.find(item => item.id === selection.actionId && (!selection.actionKind || item.kind === selection.actionKind));
  const kind = action?.kind || selection.actionKind || 'weapon';
  const options = actions.filter(item => item.kind === kind);
  // A changed definition starts a fresh form: no confirmation carries over to it.
  const draftKey = JSON.stringify([action?.kind, action?.id, action?.version]);

  function selectKind(nextKind) {
    if (nextKind !== kind) onSelectAction(actions.find(item => item.kind === nextKind) || { kind: nextKind });
  }

  return (
    <div className="gc-stack">
      <CombatIdentity actor={actor} turn={turn} />
      <div className="gc-categories" role="group" aria-label="Tipo di azione">
        {Object.entries(COMBAT_KIND_LABEL).map(([key, label]) => {
          const Icon = KIND_GLYPH[key];
          return (
            <button type="button" key={key} aria-pressed={kind === key} onClick={() => selectKind(key)}>
              <Icon aria-hidden="true" />{label}
            </button>
          );
        })}
      </div>
      {kind === 'weapon'
        ? <HandSlots equipped={equipped} actions={options} selected={action} onSelectAction={onSelectAction} />
        : <AbilityCards kind={kind} actions={options} selected={action} onSelectAction={onSelectAction} />}
      {action && (
        <CombatDraft
          key={draftKey}
          {...{ actor, action, selection, targets, turn, busy, arsenalSync, onBeginTargeting, onRemoveTarget, onLaunch, onPrepareLaunch }}
        />
      )}
    </div>
  );
}

export function GrigliataCombatPanel({
  actor, actions = [], equipped, targets = [], events = [], pending = [], turn, selection = {}, currentUserId,
  onSelectAction = () => {}, onBeginTargeting, onRemoveTarget, onLaunch, onPrepareLaunch, onRetry, onRollDamage, onCritical, onApplyDamage, canApplyDamage, damageState,
  busy = false, arsenalSync = 'ready', error, loading = false, isManager = false,
}) {
  const headingId = useId();
  return (
    <div className="gc-panel">
      <section className="gc-surface" aria-labelledby={headingId}>
        <header className="gc-heading">
          <FaDiceD20 aria-hidden="true" />
          <h2 id={headingId}>Comandi rapidi</h2>
        </header>
        <div className="gc-panel-body">
          {error && <p role="alert" className="gc-error">{error.message || error}</p>}
          {loading && <p role="status" className="gc-hint">Caricamento arsenale…</p>}
          {!loading && !actor && <p className="gc-hint">Seleziona una pedina che controlli per usare l’arsenale.</p>}
          {actor && (
            <Arsenal
              key={actor.placementId}
              {...{ actor, actions, equipped, targets, turn, selection, arsenalSync, onSelectAction, onBeginTargeting, onRemoveTarget, onLaunch, onPrepareLaunch }}
              busy={busy || loading}
            />
          )}
          <GrigliataCombatStatus {...{ actor, pending, events, busy, onRetry, onRollDamage }} />
        </div>
      </section>
      <GrigliataCombatHistory
        {...{ events, actor, currentUserId, busy, onCritical, onApplyDamage, onRollDamage, canApplyDamage, damageState, isManager }}
      />
    </div>
  );
}

export default GrigliataCombatPanel;
