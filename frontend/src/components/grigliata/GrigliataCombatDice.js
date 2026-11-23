import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiArrowRight, FiX } from 'react-icons/fi';
import { FaDiceD20 } from 'react-icons/fa';
import { GiD4, GiD10, GiD12, GiDiceEightFacesEight, GiDiceTwentyFacesTwenty, GiPerspectiveDiceSixFacesThree } from 'react-icons/gi';
import { attackDiceNotation, COMBAT_CONFIRMATION_STATUS } from './combatPresentation';
import { buildPlacementDocId, getGridCellPositionPx } from './boardUtils';
import './grigliataCombat.css';

// The defense receipt shows a few standard dice.
const RENDERED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);
const DIE_ICONS = { 4: GiD4, 6: GiPerspectiveDiceSixFacesThree, 8: GiDiceEightFacesEight, 10: GiD10, 12: GiD12, 20: GiDiceTwentyFacesTwenty };
const MAX_RENDERED_SOLIDS = 12;
// The map shows every die of every pool the server rolls: at most 8 terms of 20 dice, 320 solids when they are d100
// (two d10 each). Only a malformed receipt could pass this bound; it would then show no dice, never part of them.
const MAX_MAP_SOLIDS = 320;
// A reply whose throw the page never showed, older than this, lands already settled.
const STALE_THROW = 2000;
const NO_ROLLS = [];
const HUE = { attack: 172, damage: 35, defense: 210 };
const playback = new WeakMap();
// Map throws by tray: the first sight of a throw fixes its timeline, so a remount continues it.
const throws = new WeakMap();
const FILL = { width: '100%', height: '100%' };

const validRoll = die => Number.isInteger(die?.sides) && die.sides >= 2
  && Number.isInteger(die.value) && die.value >= 1 && die.value <= die.sides;

export const combatDiceFaces = rolls => Array.isArray(rolls) ? rolls.filter(validRoll) : NO_ROLLS;
const solidCount = rolls => rolls.reduce((count, die) => count + (die.sides === 100 ? 2 : 1), 0);

// The dice the server rolls for a notation, in formula order, as dicePlan in functions/src/grigliataCombatCore.ts
// reads it: constants are folded into the total and never thrown; other text throws nothing.
const DICE_TERM = String.raw`(?:\d*d\d+|\d+)`;
const WHOLE_DICE_SUM = new RegExp(String.raw`^${DICE_TERM}(?:\s*[+-]\s*${DICE_TERM})*$`, 'i');
const SIGNED_DICE_TERM = new RegExp(String.raw`[+-]?\s*${DICE_TERM}`, 'gi');
export function planCombatDice(expression) {
  if (typeof expression !== 'string' || !WHOLE_DICE_SUM.test(expression)) return NO_ROLLS;
  const terms = expression.match(SIGNED_DICE_TERM).map(term => {
    const [count, sides] = term.replace(/[+\-\s]/g, '').toLowerCase().split('d');
    return { sign: term.startsWith('-') ? -1 : 1, count: Number(count || 1), sides: sides === undefined ? null : Number(sides) };
  });
  const valid = terms.length <= 8 && terms.every(({ count, sides }) => count >= 1
    && (sides === null ? count <= 9999 : count <= 20 && sides >= 2 && sides <= 1000));
  return valid ? terms.flatMap(({ sign, count, sides }) => (sides === null ? NO_ROLLS
    : Array.from({ length: count }, () => (sign < 0 ? { sides, sign: -1 } : { sides })))) : NO_ROLLS;
}

function canAnimateCombatDice(rolls) {
  return rolls.length > 0 && rolls.every(die => RENDERED_SIDES.has(die.sides))
    && solidCount(rolls) <= MAX_RENDERED_SOLIDS;
}

const preference = (query) => window.matchMedia?.(query);
const allowAnimation = (motion, data) => !motion?.matches && !data?.matches && !navigator.connection?.saveData;

// Reduced motion, reduced data and Save-Data leave the dice to the tray's text.
function useDiceMotion() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const motion = preference('(prefers-reduced-motion: reduce)');
    const data = preference('(prefers-reduced-data: reduce)');
    const connection = navigator.connection;
    const update = () => setAllowed(allowAnimation(motion, data));
    update();
    motion?.addEventListener?.('change', update);
    data?.addEventListener?.('change', update);
    connection?.addEventListener?.('change', update);
    return () => {
      motion?.removeEventListener?.('change', update);
      data?.removeEventListener?.('change', update);
      connection?.removeEventListener?.('change', update);
    };
  }, []);
  return allowed;
}

export function CombatDiceCanvas({ rolls, kind }) {
  const canvas = useRef(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!canAnimateCombatDice(rolls) || typeof CanvasRenderingContext2D === 'undefined') return undefined;
    const motion = preference('(prefers-reduced-motion: reduce)');
    const data = preference('(prefers-reduced-data: reduce)');
    const connection = navigator.connection;
    const update = () => setActive(allowAnimation(motion, data));
    update();
    motion?.addEventListener?.('change', update);
    data?.addEventListener?.('change', update);
    connection?.addEventListener?.('change', update);
    return () => {
      motion?.removeEventListener?.('change', update);
      data?.removeEventListener?.('change', update);
      connection?.removeEventListener?.('change', update);
    };
  }, [rolls]);
  const canProject = active && canAnimateCombatDice(rolls);
  useEffect(() => {
    if (!canProject) return undefined;
    const surface = canvas.current;
    let live = true;
    let stop;
    import('./combatDiceCanvas').then(({ animateCombatDice }) => {
      if (!live) return;
      const now = performance.now();
      const startedAt = playback.get(rolls) ?? now;
      playback.set(rolls, startedAt);
      stop = animateCombatDice(surface, rolls, HUE[kind], { startedAt });
      if (!stop) setActive(false);
    }).catch(() => { if (live) setActive(false); });
    return () => {
      live = false;
      stop?.();
    };
  }, [canProject, rolls, kind]);
  return canProject ? <canvas className="gc-dice-canvas"
    data-pool={solidCount(rolls) > 4 ? 'large' : undefined} ref={canvas} aria-hidden="true" /> : null;
}

export function CombatDieButton({ label, notation, type = 'button', disabled, busy, onClick, buttonRef }) {
  const paint = useId();
  const sides = notation?.match(/d(\d+)/i)?.[1];
  const Icon = sides ? DIE_ICONS[sides] : FaDiceD20;
  return (
    <button className="gc-die-button" type={type} ref={buttonRef} aria-label={label} title={label}
      disabled={disabled} aria-disabled={busy || undefined} onClick={busy ? event => event.preventDefault() : onClick}>
      <svg className="gc-die-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <defs><linearGradient id={paint} x1="0" y1="0" x2="0.85" y2="1">
          <stop stopColor="#ebfff7" />
          <stop offset=".48" stopColor="#85ead6" />
          <stop offset="1" stopColor="#38a9a4" />
        </linearGradient></defs>
        {Icon ? <Icon size={48} fill={'url(#' + paint + ')'} /> : <>
          <path d="M24 2 43 13 46 30 24 46 2 30 5 13Z" fill={'url(#' + paint + ')'} />
          <path d="M5 13 24 8 43 13 38 33 24 46 10 33Z" fill="none" stroke="#217d79" strokeWidth="1.5" />
          <text x="24" y="28" textAnchor="middle" fill="#103b41" fontFamily="system-ui, sans-serif"
            fontWeight="700" fontSize={sides.length > 2 ? 12 : 15}>{sides === '100' ? '%' : sides}</text>
        </>}
      </svg>
    </button>
  );
}

export function CombatDiceFaces({ rolls }) {
  return (
    <ul className="gc-dice-faces" aria-label="Risultati dei dadi" tabIndex={rolls.length > 8 ? 0 : undefined}>
      {rolls.map(({ sides, value, sign }, index) => (
        <li key={index}><span>d{sides}</span> <strong>{sign === -1 ? '−' : ''}{value}</strong></li>
      ))}
    </ul>
  );
}

const RESULT_STATUS = {
  waiting: 'In attesa di risposta',
  retry: 'Parità',
  awaitingDamage: 'In attesa del tiro di danno',
  awaitingConfirmation: COMBAT_CONFIRMATION_STATUS,
};

export function CombatMapAction({ action, buttonRef, kind }) {
  return <button type="button" ref={buttonRef} className="gc-next-roll" data-kind={kind}
    disabled={action.disabled} onClick={action.prepare}>{action.label}<FiArrowRight aria-hidden="true" /></button>;
}

// The band the map dice land in: centred on the board viewport whatever the pool or the target, in whole pixels.
export function getCombatDiceMapPosition({ stageSize }) {
  const { width, height } = stageSize;
  const margin = Math.min(width, height, 24) / 2;
  const bandWidth = Math.max(0, Math.floor(Math.min(width - 2 * margin, 640)));
  const bandHeight = Math.max(0, Math.floor(Math.min(height - 2 * margin, Math.max(112, Math.round(0.62 * height)), 420)));
  return { left: Math.floor((width - bandWidth) / 2), top: Math.floor((height - bandHeight) / 2), width: bandWidth, height: bandHeight };
}

// Throw toward the target's visible pawn, or its aimed cell.
export function getCombatDiceThrowSide({ anchor, visibleTokens, grid, viewport, stageSize }) {
  const visible = new Map(visibleTokens.map(token => [buildPlacementDocId(anchor?.backgroundId, token.tokenId), token.renderPosition]));
  const target = anchor?.targetIds?.map(id => visible.get(id)).find(Boolean);
  const point = target
    ? { x: target.x + target.size / 2, y: target.y + target.size / 2 }
    : anchor?.point && getGridCellPositionPx(anchor.point, grid, 'center');
  return point && point.x * viewport.scale + viewport.x < stageSize.width / 2 ? -1 : 1;
}

// The timeline of a throw, fixed when it is first seen and kept by tray: a re-render, a resize or a remount continues
// it, and a resend (a new release) is a new throw. Its first painted frame is kept with it too.
const throwId = tray => (tray.id && typeof tray.id === 'object' ? tray.id : tray);
function paintThrow(tray, key, at) {
  const record = throws.get(throwId(tray));
  if (record?.key === key && record.paintedAt == null) record.paintedAt = at;
}
function mapThrow(tray, side) {
  const now = performance.now();
  const id = throwId(tray);
  const known = throws.get(id);
  if (known && known.releasedAt === tray.releasedAt) {
    if (tray.phase !== 'result' || known.resolvedAt !== null) return known;
    const resolved = { ...known, resolvedAt: now };
    throws.set(id, resolved);
    return resolved;
  }
  const sending = tray.phase === 'sending';
  // A reply this page never saw thrown plays from its receipt; an older one is shown at rest.
  const fresh = sending || (Number.isFinite(tray.releasedAt) && now - tray.releasedAt < STALE_THROW);
  const record = {
    key: {}, releasedAt: tray.releasedAt, watched: sending, direction: side(), paintedAt: null,
    startedAt: fresh ? tray.releasedAt : -Infinity, resolvedAt: sending ? null : fresh ? now : -Infinity,
  };
  throws.set(id, record);
  return record;
}

// One controller per throw: the receipt updates it, so the motion continues instead of restarting.
function MapDiceCanvas({ scene, throwKey, hue, onSettled, onPaint }) {
  const canvas = useRef(null);
  const controller = useRef(null);
  const latest = useRef({});
  const [failed, setFailed] = useState(false);
  const drawable = !failed && typeof CanvasRenderingContext2D !== 'undefined';
  useEffect(() => { Object.assign(latest.current, { onSettled, onPaint }); });
  useEffect(() => {
    if (!drawable) return undefined;
    let live = true;
    let run;
    import('./combatDiceCanvas').then(({ throwCombatDice }) => {
      if (!live) return;
      run = throwCombatDice(canvas.current, latest.current.scene, {
        hue, onSettled: () => latest.current.onSettled?.(), onPaint: at => latest.current.onPaint?.(at),
      });
      if (run) controller.current = run;
      else setFailed(true);
    }).catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      run?.stop();
    };
  }, [drawable, throwKey, hue]);
  useEffect(() => {
    latest.current.scene = scene;
    controller.current?.update(scene);
  }, [scene]);
  return drawable ? <canvas className="gc-dice-canvas" ref={canvas} aria-hidden="true" style={FILL} /> : null;
}

// Every die is thrown on the map from the release: the pool the notation names tumbles until the reply, whose dice
// then take their places (a die the notation could not foresee is thrown in) and settle in rows at the centre.
export function CombatMapDice({ tray, visibleTokens, grid, viewport, stageSize }) {
  const motion = useDiceMotion();
  const [settled, setSettled] = useState(null);
  // A throw with no preview in its tray must not start late.
  useEffect(() => { import('./combatDiceCanvas').catch(() => {}); }, []);
  const notation = tray?.notation;
  const pool = useMemo(() => planCombatDice(notation), [notation]);
  const rolls = tray?.rolls;
  const faces = useMemo(() => combatDiceFaces(rolls), [rolls]);
  const result = tray?.phase === 'result';
  const record = result || tray?.phase === 'sending'
    ? mapThrow(tray, () => getCombatDiceThrowSide({ anchor: tray.anchor, visibleTokens, grid, viewport, stageSize }))
    : null;
  // The planner never names more than MAX_MAP_SOLIDS solids; a receipt past it is malformed.
  const planned = record?.watched ? pool : NO_ROLLS;
  const receipt = result ? faces : null;
  const scene = useMemo(() => record && {
    planned, receipt, releasedAt: record.startedAt, resolvedAt: record.resolvedAt, paintedAt: record.paintedAt,
    direction: record.direction,
  }, [record, planned, receipt]);
  const shown = solidCount(receipt || planned);
  if (!motion || !scene || !stageSize.width || !stageSize.height || (receipt && shown > MAX_MAP_SOLIDS)
    || (!shown && !(receipt && planned.length))) return null;
  return (
    <div className="gc-map-dice" aria-hidden="true" data-testid="grigliata-board-dice-projection"
      style={getCombatDiceMapPosition({ stageSize })} data-dice={shown}
      data-phase={record.resolvedAt === -Infinity || settled === record.key ? 'settled' : 'rolling'}>
      <MapDiceCanvas scene={scene} throwKey={record.key} hue={HUE[tray.kind]} onSettled={() => setSettled(record.key)}
        onPaint={at => paintThrow(tray, record.key, at)} />
    </div>
  );
}

export default function GrigliataCombatDiceTray({ tray, lastFocusedTray, nextDamage, nextRetry, resultStatus, resultOutcomes = NO_ROLLS }) {
  const { id, title, notation, kind, phase, error, close, throwDice } = tray;
  const rolls = useMemo(() => combatDiceFaces(tray.rolls), [tray.rolls]);
  const headingId = useId();
  const section = useRef(null);
  const trigger = useRef(null);
  const closeButton = useRef(null);
  const retryButton = useRef(null);
  const damageButton = useRef(null);
  const lastFocused = useRef(null);
  const sending = phase === 'sending';
  const result = phase === 'result';
  const shownNotation = result && kind === 'attack' && rolls.length > 0 && rolls.every(die => die.sides === rolls[0].sides)
    ? attackDiceNotation(rolls[0].sides, rolls.length) : notation;
  const finished = result || phase === 'rejected';
  const canRetry = Boolean(result && nextRetry && !nextRetry.disabled);
  const canRollDamage = Boolean(result && nextDamage && !nextDamage.disabled);
  useLayoutEffect(() => {
    if (!trigger.current || (lastFocusedTray && lastFocusedTray.current === id)) return;
    // Closing the aim restores its launcher. Only a newly prepared throw should take that focus.
    if (lastFocusedTray) lastFocusedTray.current = id;
    const rect = section.current.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) section.current.scrollIntoView?.({ block: 'nearest' });
    trigger.current?.focus({ preventScroll: true });
  }, [id, lastFocusedTray]);
  useLayoutEffect(() => {
    if (!finished) return;
    const active = document.activeElement;
    if (active === closeButton.current || (active === document.body && lastFocused.current && !lastFocused.current.isConnected)) {
      (canRetry ? retryButton : canRollDamage ? damageButton : closeButton).current?.focus({ preventScroll: true });
    }
  }, [finished, canRetry, canRollDamage]);

  const outcomes = <ul className="gc-dice-outcomes" aria-label="Esiti dei bersagli"
    tabIndex={resultOutcomes.length > 4 ? 0 : undefined}>
    {resultOutcomes.map(({ id, name, label }) => <li key={id}>{name} · {label}</li>)}
  </ul>;

  return (
    <section className="gc-map-step gc-dice-tray" aria-labelledby={headingId} ref={section} data-kind={kind}
      onFocusCapture={event => { lastFocused.current = event.target; }}
      onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) lastFocused.current = null; }}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (!sending) close();
      }}>
      <header className="gc-dice-head">
        <h3 id={headingId}>{title}</h3>
        <button type="button" className="gc-dice-close" aria-label="Chiudi il vassoio" ref={closeButton}
          aria-disabled={sending} onClick={() => { if (!sending) close(); }}><FiX aria-hidden="true" /></button>
      </header>
      <p className="gc-dice-notation">{result ? 'Esito del tiro' : kind === 'damage' ? 'Tiro di danno' : 'Tiro di attacco'} · <code>{shownNotation}</code></p>
      <div className="gc-dice-result" role="status">
        {result && <>
          {rolls.length ? <CombatDiceFaces rolls={rolls} /> : <p>Azione registrata.</p>}
          {Number.isFinite(tray.damage) && <p className="gc-dice-total">{tray.damage} danni proposti</p>}
          {RESULT_STATUS[resultStatus] && <p>{RESULT_STATUS[resultStatus]}</p>}
          {resultOutcomes.length === 1 && outcomes}
        </>}
        {sending && <p>Attendi l’esito del tiro…</p>}
      </div>
      {result && resultOutcomes.length > 1 && <details className="gc-outcome-details" key={tray.combatId}>
        <summary>Esiti dei bersagli · {resultOutcomes.length}</summary>
        {outcomes}
      </details>}
      {error && <p role="alert" className="gc-error">{error}</p>}
      {!finished && <CombatDieButton label={phase === 'error' ? 'Riprova il tiro' : 'Tira i dadi'}
        notation={notation} buttonRef={trigger} busy={sending} onClick={() => throwDice()} />}
      {result && nextRetry && <CombatMapAction action={nextRetry} kind="attack" buttonRef={retryButton} />}
      {result && nextDamage && <CombatMapAction action={nextDamage} kind="damage" buttonRef={damageButton} />}
    </section>
  );
}
