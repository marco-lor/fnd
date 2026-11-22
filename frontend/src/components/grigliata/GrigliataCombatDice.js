import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import { attackDiceNotation, COMBAT_CONFIRMATION_STATUS } from './combatPresentation';
import { buildPlacementDocId, getGridCellPositionPx } from './boardUtils';
import './grigliataCombat.css';

// The defense receipt and the throw handle's preview show a few standard dice.
const RENDERED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);
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
const exampleFor = notation => {
  const sides = Number(notation?.match(/d(\d+)/i)?.[1]);
  return RENDERED_SIDES.has(sides) ? [{ sides, value: sides }] : NO_ROLLS;
};

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

export function CombatDiceCanvas({ rolls, kind, gesture, preview = false, pending = false, releasedAt }) {
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
      const startedAt = pending ? releasedAt : playback.get(rolls) ?? Math.max(releasedAt ?? now, now - 700);
      if (!preview && !pending) playback.set(rolls, startedAt);
      stop = animateCombatDice(surface, rolls, HUE[kind], { gesture, preview, pending, startedAt });
      if (!stop) setActive(false);
    }).catch(() => { if (live) setActive(false); });
    return () => {
      live = false;
      stop?.();
    };
  }, [canProject, rolls, kind, gesture, preview, pending, releasedAt]);
  return canProject ? <canvas className="gc-dice-canvas" data-preview={preview || undefined}
    data-pool={solidCount(rolls) > 4 ? 'large' : undefined} ref={canvas} aria-hidden="true" /> : null;
}

// A throw reads just the horizontal swipe. The native button beside it is also the keyboard and tap control.
export function CombatDiceDrag({ disabled, kind, notation, onThrow }) {
  const pointer = useRef(null);
  const preview = useMemo(() => exampleFor(notation), [notation]);
  return (
    <div className="gc-dice-drag" aria-hidden="true" data-disabled={disabled || undefined}
      onPointerDown={event => {
        if (disabled || event.isPrimary === false || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={event => {
        const start = pointer.current;
        if (!start || event.pointerId !== start.id) return;
        pointer.current = null;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!disabled && Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy)) {
          onThrow({ direction: Math.sign(dx), power: Math.min(1.25, 0.78 + Math.abs(dx) / 320) });
        }
      }}
      onPointerCancel={() => { pointer.current = null; }}
      onLostPointerCapture={() => { pointer.current = null; }}
    >
      {preview.length > 0 && <CombatDiceCanvas rolls={preview} kind={kind} preview />}
      Trascina per tirare
    </div>
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
  retry: 'Parità · rilancio nel pannello Combattimento',
  awaitingDamage: 'In attesa del tiro di danno',
  awaitingConfirmation: COMBAT_CONFIRMATION_STATUS,
};

export function CombatMapDamage({ nextDamage }) {
  return <button type="button" className="gc-secondary" disabled={nextDamage.disabled} onClick={nextDamage.prepare}>{nextDamage.label}</button>;
}

// The band the map dice land in: centred on the board viewport whatever the pool or the target, in whole pixels.
export function getCombatDiceMapPosition({ stageSize }) {
  const { width, height } = stageSize;
  const margin = Math.min(width, height, 24) / 2;
  const bandWidth = Math.max(0, Math.floor(Math.min(width - 2 * margin, 640)));
  const bandHeight = Math.max(0, Math.floor(Math.min(height - 2 * margin, Math.max(112, Math.round(0.62 * height)), 420)));
  return { left: Math.floor((width - bandWidth) / 2), top: Math.floor((height - bandHeight) / 2), width: bandWidth, height: bandHeight };
}

// Without a swipe the dice are thrown toward the side of the board the target lies on: its visible pawn, else the
// aimed cell.
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
  const { direction = side(), power = 1 } = tray.gesture || {};
  const sending = tray.phase === 'sending';
  // A reply this page never saw thrown plays from its receipt; an older one is shown at rest.
  const fresh = sending || (Number.isFinite(tray.releasedAt) && now - tray.releasedAt < STALE_THROW);
  const record = {
    key: {}, releasedAt: tray.releasedAt, watched: sending, direction, power, paintedAt: null,
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
    direction: record.direction, power: record.power,
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

export default function GrigliataCombatDiceTray({ tray, nextDamage, resultStatus, resultOutcomes = NO_ROLLS }) {
  const { id, title, notation, kind, phase, error, close, throwDice } = tray;
  const rolls = useMemo(() => combatDiceFaces(tray.rolls), [tray.rolls]);
  const headingId = useId();
  const section = useRef(null);
  const trigger = useRef(null);
  const closeButton = useRef(null);
  const sending = phase === 'sending';
  const result = phase === 'result';
  const shownNotation = result && kind === 'attack' && rolls.length > 0 && rolls.every(die => die.sides === rolls[0].sides)
    ? attackDiceNotation(rolls[0].sides, rolls.length) : notation;
  const canCloseOnly = result || phase === 'rejected';
  useLayoutEffect(() => {
    section.current?.scrollIntoView?.({ block: 'nearest' });
    trigger.current?.focus({ preventScroll: true });
  }, [id]);
  useLayoutEffect(() => {
    if (canCloseOnly && (document.activeElement === document.body || section.current?.contains(document.activeElement))) {
      closeButton.current?.focus({ preventScroll: true });
    }
  }, [canCloseOnly]);

  return (
    <section className="gc-dice-tray" aria-labelledby={headingId} ref={section} data-kind={kind}>
      <div className="gc-dice-bar">
        <button type="button" className="gc-dice-close" aria-label="Chiudi il vassoio" ref={closeButton}
          aria-disabled={sending} onClick={close}><FaTimes aria-hidden="true" /></button>
        <div className="gc-dice-main" data-multiple-outcomes={result && resultOutcomes.length > 1 ? '' : undefined}>
          <header className="gc-dice-head">
            <h3 id={headingId}>{title}</h3>
            <code>{shownNotation}</code>
          </header>
          {!canCloseOnly && (
            <div className="gc-dice-controls">
              <CombatDiceDrag disabled={sending} kind={kind} notation={notation} onThrow={throwDice} />
              <button type="button" className="gc-primary" ref={trigger} aria-disabled={sending}
                onClick={() => throwDice()}>{phase === 'error' ? 'Riprova il tiro' : 'Tira i dadi'}</button>
            </div>
          )}
          <div className="gc-dice-result" role="status">
            {result && (
              <>
                {rolls.length ? <CombatDiceFaces rolls={rolls} /> : <p>Azione registrata.</p>}
                {Number.isFinite(tray.damage) && <p className="gc-dice-total">{tray.damage} danni proposti</p>}
                {RESULT_STATUS[resultStatus] && <p>{RESULT_STATUS[resultStatus]}</p>}
                {resultOutcomes.length > 0 && <ul className="gc-dice-outcomes" aria-label="Esiti dei bersagli"
                  tabIndex={resultOutcomes.length > 4 ? 0 : undefined}>
                  {resultOutcomes.map(({ id, name, label }) => <li key={id}>{name} · {label}</li>)}
                </ul>}
              </>
            )}
            {sending && <p>Attendi l’esito del tiro…</p>}
          </div>
          {result && nextDamage && <CombatMapDamage nextDamage={nextDamage} />}
          {error && <p role="alert" className="gc-error">{error}</p>}
        </div>
      </div>
    </section>
  );
}
