import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataCombatDiceTray, {
  CombatMapDice, getCombatDiceMapPosition, getCombatDiceThrowSide, planCombatDice,
} from './GrigliataCombatDice';
import {
  animateCombatDice, combatDiceLayout, combatPieceBox, combatThrowFrame, combatThrowModel, mesh, percentileSolids,
  throwCombatDice,
} from './combatDiceCanvas';

const tray = { id: {}, phase: 'ready', kind: 'attack', title: 'Spada', notation: 'd12', close: () => {} };
const dice = (count, sides, extra) => Array.from({ length: count }, () => ({ sides, ...extra }));
const faces = (sides, ...values) => values.map(value => ({ sides, value }));
const BAND = { width: 640, height: 420 };
const PHONE = { width: 336, height: 298 };

test.each([['1d100', '%'], ['4d62 - 1d62', '62']])('the roll control identifies %s on its face', (notation, face) => {
  render(<GrigliataCombatDiceTray tray={{ ...tray, notation }} />);
  const button = screen.getByRole('button', { name: 'Tira i dadi' });
  expect(button.querySelector('svg text')).toHaveTextContent(face);
});

const fakeContext = () => {
  const gradient = { addColorStop: jest.fn() };
  const ctx = { createLinearGradient: jest.fn(() => gradient), createRadialGradient: jest.fn(() => gradient) };
  for (const method of ['setTransform', 'clearRect', 'save', 'translate', 'scale', 'fillRect', 'restore',
    'beginPath', 'lineTo', 'moveTo', 'closePath', 'fill', 'stroke', 'transform', 'strokeText', 'fillText']) {
    ctx[method] = jest.fn();
  }
  return ctx;
};
const reset = ctx => Object.values(ctx).forEach(method => method.mockClear?.());
const texts = ctx => ctx.fillText.mock.calls.map(([text]) => text);
// Each painted piece casts one shadow.
const painted = ctx => ctx.createRadialGradient.mock.calls.length;

// A controllable clock and frame loop.
let clock;
let frames;
const runFrames = (until, step = 33) => {
  while (clock < until && frames.length) {
    clock = Math.min(until, clock + step);
    for (const callback of frames.splice(0)) callback(clock);
  }
};
const useClock = () => {
  const now = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { frames = []; });
  return () => [now, raf, cancel].forEach(spy => spy.mockRestore());
};
beforeEach(() => {
  clock = 0;
  frames = [];
});

const boxesOf = frame => frame.map(combatPieceBox);
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const minGapX = frame => {
  const boxes = boxesOf(frame).sort((a, b) => a.left - b.left);
  return Math.min(...boxes.slice(1).map((box, i) => box.left - boxes[i].right));
};
const unchanged = (frame, before) => frame
  .filter((piece, i) => JSON.stringify(piece.matrix) === JSON.stringify(before[i].matrix)).length;
const centreOf = frame => {
  const boxes = boxesOf(frame);
  return [
    (Math.min(...boxes.map(box => box.left)) + Math.max(...boxes.map(box => box.right))) / 2,
    (Math.min(...boxes.map(box => box.top)) + Math.max(...boxes.map(box => box.bottom))) / 2,
  ];
};

test.each([
  ['nextDamage', 'Tiro di danno · Talpa', 'awaitingDamage'],
  ['nextRetry', 'Rilancia contro Talpa', 'retry'],
])('moves focus to %s when the player is still interacting with the throw', (prop, label, status) => {
  const followUp = { label, prepare: jest.fn() };
  const { rerender } = render(<GrigliataCombatDiceTray tray={tray} />);
  expect(screen.getByRole('button', { name: 'Tira i dadi' })).toHaveFocus();
  const result = { ...tray, phase: 'result', rolls: [{ sides: 12, value: 7 }] };
  rerender(<GrigliataCombatDiceTray tray={result} resultStatus={status} {...{ [prop]: followUp }} />);
  const next = screen.getByRole('button', { name: label });
  expect(next).toHaveFocus();
  fireEvent.click(next);
  expect(followUp.prepare).toHaveBeenCalledTimes(1);
});

test('a damage step arriving after the result can be followed without leaving the tray', () => {
  const { rerender } = render(<GrigliataCombatDiceTray tray={tray} />);
  const result = { ...tray, phase: 'result', rolls: [{ sides: 12, value: 7 }] };
  rerender(<GrigliataCombatDiceTray tray={result} resultStatus="waiting" />);
  expect(screen.getByRole('button', { name: 'Chiudi il vassoio' })).toHaveFocus();
  const nextDamage = { label: 'Tiro di danno · Talpa', prepare: jest.fn() };
  rerender(<GrigliataCombatDiceTray tray={result} resultStatus="awaitingDamage" nextDamage={nextDamage} />);
  expect(screen.getByRole('button', { name: nextDamage.label })).toHaveFocus();
});

test('the result offers both a tie and damage when different targets are ready', () => {
  const nextRetry = { label: 'Rilancia contro Guardia', prepare: jest.fn() };
  const nextDamage = { label: 'Tiro di danno · Talpa', prepare: jest.fn() };
  render(<GrigliataCombatDiceTray tray={{ ...tray, phase: 'result' }} resultStatus="retry"
    nextRetry={nextRetry} nextDamage={nextDamage} />);
  fireEvent.click(screen.getByRole('button', { name: nextDamage.label }));
  expect(nextDamage.prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: nextRetry.label })).toBeEnabled();
});

test('an incoming result leaves focus on a board control the player moved to', () => {
  const nextDamage = { label: 'Tiro di danno · Talpa', prepare: jest.fn() };
  const view = phase => <>
    <button type="button">Zoom</button>
    <GrigliataCombatDiceTray tray={{ ...tray, phase }} nextDamage={nextDamage} />
  </>;
  const { rerender } = render(view('ready'));
  const zoom = screen.getByRole('button', { name: 'Zoom' });
  zoom.focus();
  rerender(view('sending'));
  rerender(view('result'));
  expect(screen.getByRole('button', { name: nextDamage.label })).toBeInTheDocument();
  expect(zoom).toHaveFocus();
});

test('Escape closes only from within the tray and keeps a throw in flight open', () => {
  const close = jest.fn();
  const view = phase => <>
    <button type="button">Zoom</button>
    <GrigliataCombatDiceTray tray={{ ...tray, phase, close }} />
  </>;
  const { rerender } = render(view('ready'));
  const zoom = screen.getByRole('button', { name: 'Zoom' });
  zoom.focus();
  expect(fireEvent.keyDown(zoom, { key: 'Escape' })).toBe(true);
  expect(close).not.toHaveBeenCalled();

  const dismiss = screen.getByRole('button', { name: 'Chiudi il vassoio' });
  dismiss.focus();
  fireEvent.keyDown(dismiss, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
  rerender(view('sending'));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chiudi il vassoio' }), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
});

test.each([['ready', 'Tira i dadi'], ['error', 'Riprova il tiro']])('the %s die button throws once on activation and ignores swipes', (phase, label) => {
  const throwDice = jest.fn();
  const oldPointerEvent = window.PointerEvent;
  window.PointerEvent = MouseEvent;
  try {
    const { rerender } = render(<GrigliataCombatDiceTray tray={{ ...tray, phase, throwDice }} />);
    const roll = screen.getByRole('button', { name: label });
    expect(roll.tagName).toBe('BUTTON');
    expect(roll).toHaveFocus();
    expect(screen.queryByText(/Trascina per tirare/i)).not.toBeInTheDocument();
    fireEvent.pointerDown(roll, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(roll, { clientX: 120, clientY: 20 });
    expect(throwDice).not.toHaveBeenCalled();
    fireEvent.click(roll);
    expect(throwDice).toHaveBeenCalledTimes(1);
    rerender(<GrigliataCombatDiceTray tray={{ ...tray, phase: 'sending', throwDice }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
    expect(throwDice).toHaveBeenCalledTimes(1);
  } finally {
    window.PointerEvent = oldPointerEvent;
  }
});

test('every numbered mesh has its own complete set of faces, other dice are counters, and d100 displays tens and units', () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    expect(mesh(sides).map(face => face.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: sides }, (_, i) => i + 1));
  }
  // An octagonal counter: two caps and eight rim faces, the value on one cap.
  for (const sides of [2, 3, 62, 1000]) {
    expect(mesh(sides)).toHaveLength(10);
    expect(mesh(sides).filter(face => face.cap)).toHaveLength(1);
  }
  const marks = value => percentileSolids({ value }).map(die => die.format(die.value));
  expect(marks(100)).toEqual(['00', '0']);
  expect(marks(37)).toEqual(['30', '7']);
  expect(marks(80)).toEqual(['80', '0']);
});

test('the planner throws exactly the dice the server rolls for a notation, in formula order', () => {
  expect(planCombatDice('3d4')).toEqual(dice(3, 4));
  expect(planCombatDice('d12')).toEqual([{ sides: 12 }]);
  expect(planCombatDice('2d6 + 1d4 - 1d8 + 3')).toEqual([{ sides: 6 }, { sides: 6 }, { sides: 4 }, { sides: 8, sign: -1 }]);
  expect(planCombatDice('d100')).toEqual([{ sides: 100 }]);
  expect(planCombatDice('5D62')).toEqual(dice(5, 62));
  expect(planCombatDice('20d100+5d100')).toEqual(dice(25, 100));
  expect(planCombatDice('8d20 - 4')).toEqual(dice(8, 20));
  // Outside the grammar the card stays manual: nothing is thrown.
  for (const text of ['21d6', Array(9).fill('1d4').join('+'), '100d100', '1d1001', '1d1', '0d6', '2d6 fuoco',
    'Dado Anima', '', '+1d4', '1d4 *2', undefined]) {
    expect(planCombatDice(text)).toEqual([]);
  }
});

test('the layout gives every pool up to 320 solids its own cell inside the band, centred, at desktop and phone sizes', () => {
  const bands = [
    getCombatDiceMapPosition({ stageSize: { width: 1280, height: 720 } }),
    getCombatDiceMapPosition({ stageSize: { width: 360, height: 560 } }),
    PHONE,
  ];
  expect(bands.slice(0, 2)).toEqual([{ left: 320, top: 150, ...BAND }, { left: 12, top: 106, width: 336, height: 347 }]);
  for (const { width, height } of bands) {
    for (const count of [1, 3, 12, 24, 48, 50, 160, 320]) {
      const { slots, size, pitch, columns, rows } = combatDiceLayout(count, width, height);
      expect(slots).toHaveLength(count);
      expect(columns * rows).toBeGreaterThanOrEqual(count);
      expect(pitch).toBeGreaterThanOrEqual(2.06 * size);
      for (const { x, y } of slots) {
        expect(x - 1.03 * size).toBeGreaterThanOrEqual(0);
        expect(x + 1.03 * size).toBeLessThanOrEqual(width);
        expect(y - 1.03 * size).toBeGreaterThanOrEqual(0);
        expect(y + 1.03 * size).toBeLessThanOrEqual(height);
      }
      let nearest = Infinity;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          nearest = Math.min(nearest, Math.max(Math.abs(slots[i].x - slots[j].x), Math.abs(slots[i].y - slots[j].y)));
        }
      }
      expect(nearest).toBeGreaterThan(pitch - 0.001);
      const xs = slots.map(slot => slot.x);
      const ys = slots.map(slot => slot.y);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(width / 2, 6);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(height / 2, 6);
    }
  }
  // Small pools keep large dice in a single row.
  expect(combatDiceLayout(3, BAND.width, BAND.height)).toMatchObject({ columns: 3, rows: 1, pitch: 96 });
});

test('a pending 3d4 tumbles as three separate, unnumbered, ever-changing pieces for as long as the reply takes', () => {
  const model = combatThrowModel({ planned: dice(3, 4), releasedAt: 1000 });
  let previous;
  let seen = 0;
  let gap = Infinity;
  let still = 0;
  for (let t = 1000; t <= 9000; t += 10) {
    const frame = combatThrowFrame(model, t, BAND.width, BAND.height);
    expect(frame.length).toBeLessThanOrEqual(3);
    expect(frame.some(piece => piece.numbered)).toBe(false);
    gap = Math.min(gap, minGapX(frame));
    if (frame.length === 3 && frame.every(piece => piece.alpha === 1)) {
      seen++;
      still += previous ? unchanged(frame, previous) : 0;
      previous = frame;
    }
  }
  expect(seen).toBeGreaterThan(700);
  expect(gap).toBeGreaterThanOrEqual(4);
  // Their silhouettes keep changing: the reader counts a piece as moving only if its outline does.
  expect(still).toBe(0);
  expect(model.doneAt).toBe(Infinity);
});

test('the receipt continues the same throw: no jump, one landing, numbers only as it lands, then a still frame', () => {
  const planned = dice(3, 4);
  const receipt = faces(4, 1, 3, 4);
  const releasedAt = 1000;
  const pending = combatThrowModel({ planned, releasedAt });
  for (const resolvedAt of [1015, 1600, 4000]) {
    const resolved = combatThrowModel({ planned, receipt, releasedAt, resolvedAt });
    const before = combatThrowFrame(pending, resolvedAt - 0.01, BAND.width, BAND.height);
    const after = combatThrowFrame(resolved, resolvedAt, BAND.width, BAND.height);
    expect(after).toHaveLength(before.length);
    after.forEach((piece, i) => {
      expect(Math.abs(piece.x - before[i].x)).toBeLessThan(1);
      expect(Math.abs(piece.y - before[i].y)).toBeLessThan(1);
      expect(Math.abs(piece.size - before[i].size)).toBeLessThan(0.1);
    });
    // An instant reply still reads as a roll.
    expect(resolved.landAt).toBeGreaterThanOrEqual(Math.max(resolvedAt, releasedAt + 900));
    let landing;
    let gap = Infinity;
    const numberedCounts = new Set();
    for (let t = resolvedAt; t <= resolved.doneAt; t += 5) {
      const frame = combatThrowFrame(resolved, t, BAND.width, BAND.height);
      gap = Math.min(gap, minGapX(frame));
      const numbered = frame.filter(piece => piece.numbered).length;
      numberedCounts.add(numbered);
      if (numbered && landing === undefined) landing = t;
    }
    expect(gap).toBeGreaterThanOrEqual(4);
    // All three are numbered together, from the one landing on.
    expect([...numberedCounts].sort()).toEqual([0, 3]);
    expect(landing).toBeGreaterThanOrEqual(resolved.landAt);
    const still = combatThrowFrame(resolved, resolved.doneAt, BAND.width, BAND.height);
    expect(still.every(piece => piece.numbered && piece.alpha === 1)).toBe(true);
    expect(combatThrowFrame(resolved, resolved.doneAt + 60000, BAND.width, BAND.height)).toEqual(still);
    const [x, y] = centreOf(still);
    expect(Math.abs(x - BAND.width / 2)).toBeLessThan(1);
    expect(Math.abs(y - BAND.height / 2)).toBeLessThan(1);
  }
});

test('a die only the receipt holds ramps in after the receipt, in its own lane, and lands with the others', () => {
  const releasedAt = 1000;
  const resolvedAt = 1080;
  const model = combatThrowModel({ planned: dice(1, 20), receipt: faces(20, 5, 17), releasedAt, resolvedAt });
  const joiner = model.pieces.find(piece => piece.from === null);
  expect(joiner.bornAt).toBeGreaterThanOrEqual(resolvedAt);
  let alpha = 0;
  let early = 0;
  let dimmed = 0;
  let gap = Infinity;
  let together = 0;
  for (let t = releasedAt; t <= model.doneAt; t += 5) {
    const frame = combatThrowFrame(model, t, BAND.width, BAND.height);
    const late = frame.find(piece => piece.seed === 1);
    if (late && t < resolvedAt) early++;
    if (late && late.alpha < alpha) dimmed++;
    if (late) alpha = late.alpha;
    gap = Math.min(gap, minGapX(frame));
    if (frame.length === 2 && frame.every(piece => piece.alpha === 1) && t < model.landAt) together += 5;
  }
  expect(early).toBe(0);
  expect(dimmed).toBe(0);
  expect(alpha).toBe(1);
  expect(gap).toBeGreaterThanOrEqual(4);
  // Both dice are visibly tumbling at the same time before the one landing.
  expect(together).toBeGreaterThanOrEqual(500);
  const still = combatThrowFrame(model, model.doneAt, BAND.width, BAND.height);
  expect(still.map(piece => piece.die.value)).toEqual([5, 17]);
});

test('a planned piece the receipt does not hold fades out in place before the others move', () => {
  const model = combatThrowModel({ planned: dice(3, 6), receipt: faces(6, 2, 5), releasedAt: 1000, resolvedAt: 2000 });
  let alpha = 1;
  let brightened = 0;
  let shown = 0;
  for (let t = 2000; t <= model.doneAt; t += 5) {
    const frame = combatThrowFrame(model, t, BAND.width, BAND.height);
    const leaving = frame.find(piece => piece.seed === 2);
    if (leaving && leaving.alpha > alpha) brightened++;
    if (leaving) {
      alpha = leaving.alpha;
      shown++;
    }
    expect(minGapX(frame)).toBeGreaterThanOrEqual(4);
  }
  expect(shown).toBeGreaterThan(0);
  expect(brightened).toBe(0);
  expect(combatThrowFrame(model, model.doneAt, BAND.width, BAND.height)).toHaveLength(2);
});

test.each([[BAND], [PHONE]])('settled bodies are one piece per solid inside the %o band, apart, and centred within 1px', size => {
  const pools = {
    '1d4 on each face': [1, 2, 3, 4].map(value => faces(4, value)),
    '3d4': [faces(4, 1, 3, 4)],
    '5d62 with a subtracted die': [[42, 1, 15, 62, 28].map((value, i) => ({ sides: 62, value, ...(i === 4 && { sign: -1 }) }))],
    '24d20': [Array.from({ length: 24 }, (_, i) => ({ sides: 20, value: 1 + i % 20 }))],
    mixed: [[...faces(6, 3, 6), { sides: 4, value: 2 }, { sides: 8, value: 7, sign: -1 }, { sides: 100, value: 37 }, { sides: 62, value: 9 }]],
    '20d100+5d100': [Array.from({ length: 25 }, (_, i) => ({ sides: 100, value: 1 + i * 4 }))],
    '160d6': [Array.from({ length: 160 }, (_, i) => ({ sides: 6, value: 1 + i % 6 }))],
    '160d100': [Array.from({ length: 160 }, (_, i) => ({ sides: 100, value: 1 + i % 100 }))],
  };
  const solids = rolls => rolls.reduce((count, die) => count + (die.sides === 100 ? 2 : 1), 0);
  for (const [name, sets] of Object.entries(pools)) {
    for (const receipt of sets) {
      const model = combatThrowModel({ receipt });
      const frame = combatThrowFrame(model, 0, size.width, size.height);
      expect([name, frame.length]).toEqual([name, solids(receipt)]);
      expect(frame.every(piece => piece.numbered)).toBe(true);
      const boxes = boxesOf(frame);
      const outside = boxes.filter(box => box.left < 0 || box.top < 0 || box.right > size.width || box.bottom > size.height);
      expect([name, outside]).toEqual([name, []]);
      let touching = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) touching++;
      }
      expect([name, touching]).toEqual([name, 0]);
      const [x, y] = centreOf(frame);
      expect([name, Math.abs(x - size.width / 2) < 1, Math.abs(y - size.height / 2) < 1]).toEqual([name, true, true]);
    }
  }
});

describe('the throw controller', () => {
  let restore;
  const surface = ctx => ({ clientWidth: BAND.width, clientHeight: BAND.height, getContext: () => ctx });
  beforeEach(() => { restore = useClock(); });
  afterEach(() => restore());

  test('a renderer that arrives long after an instant reply still shows a whole roll, then one still frame', () => {
    const ctx = fakeContext();
    const onPaint = jest.fn();
    const onSettled = jest.fn();
    const scene = { planned: dice(3, 4), receipt: faces(4, 2, 3, 1), releasedAt: 120, resolvedAt: 135 };
    clock = 2200;
    const run = throwCombatDice(surface(ctx), scene, { hue: 35, onPaint, onSettled });
    expect(onPaint).toHaveBeenCalledWith(2200);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    runFrames(2500);
    expect(painted(ctx)).toBeGreaterThan(0);
    expect(ctx.fillText).not.toHaveBeenCalled();
    let landed;
    while (frames.length) {
      reset(ctx);
      runFrames(clock + 33);
      expect(painted(ctx)).toBe(3);
      if (landed === undefined && ctx.fillText.mock.calls.length) landed = clock;
    }
    // Numbers come only with the landing, a whole roll after the first painted frame; then no further frame.
    expect(landed).toBeGreaterThanOrEqual(2200 + 900);
    expect(texts(ctx)).toEqual(expect.arrayContaining(['2', '3', '1']));
    expect(frames).toHaveLength(0);
    expect(onSettled).toHaveBeenCalledTimes(1);
    run.stop();

    // The same throw recreated after it settled is drawn at rest at once.
    clock = 9000;
    const again = fakeContext();
    throwCombatDice(surface(again), { ...scene, paintedAt: 2200 }, { hue: 35, onSettled });
    expect(texts(again)).toEqual(expect.arrayContaining(['2', '3', '1']));
    expect(frames).toHaveLength(0);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  test('the receipt updates the running throw instead of restarting it', () => {
    const ctx = fakeContext();
    const scene = { planned: dice(3, 4), releasedAt: 0 };
    const run = throwCombatDice(surface(ctx), scene, { hue: 35 });
    runFrames(600);
    reset(ctx);
    run.update({ ...scene, receipt: faces(4, 4, 4, 4), resolvedAt: 600 });
    // Still three pieces in mid roll, one frame loop.
    expect(painted(ctx)).toBe(3);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    runFrames(5000);
    expect(texts(ctx)).toContain('4');
    expect(frames).toHaveLength(0);
    run.stop();
  });

  test('a counter shows its value and die type; a subtracted die carries its minus', () => {
    const ctx = fakeContext();
    throwCombatDice(surface(ctx), { receipt: [{ sides: 62, value: 42 }, { sides: 62, value: 28, sign: -1 }, { sides: 6, value: 6, sign: -1 }] });
    expect(texts(ctx)).toEqual(expect.arrayContaining(['42', 'd62', '−28', '−', '6']));
    // The 6 keeps its underline beside the minus.
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(3);
    expect(frames).toHaveLength(0);
  });

  test('a dense pool moves as lite solids and is drawn in full once at rest', () => {
    const ctx = fakeContext();
    clock = 1000;
    throwCombatDice(surface(ctx), { planned: dice(48, 20), releasedAt: 500, paintedAt: 500 }, { hue: 35 });
    expect(painted(ctx)).toBe(48);
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
    const still = fakeContext();
    throwCombatDice(surface(still), { receipt: Array.from({ length: 48 }, (_, i) => ({ sides: 20, value: 1 + i % 20 })) });
    expect(still.createLinearGradient).toHaveBeenCalled();
    expect(still.fillText).toHaveBeenCalled();
  });

  test('the legacy projection cancels its frame and disconnects its resize observer', () => {
    const ctx = fakeContext();
    const canvas = { clientWidth: 400, clientHeight: 96, getContext: () => ctx };
    const oldResize = window.ResizeObserver;
    const disconnect = jest.fn();
    window.ResizeObserver = class {
      observe() {}
      disconnect() { disconnect(); }
    };
    try {
      const release = animateCombatDice(canvas, [{ sides: 6, value: 2 }], 35);
      expect(ctx.fillText).toHaveBeenCalled();
      expect(frames).toHaveLength(1);
      release();
      expect(frames).toHaveLength(0);
      expect(disconnect).toHaveBeenCalledTimes(1);
      reset(ctx);
      const cancelPending = animateCombatDice(canvas, [{ sides: 6, value: 2 }], 35, { pending: true });
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.fillText).not.toHaveBeenCalled();
      cancelPending();
    } finally {
      window.ResizeObserver = oldResize;
    }
  });
});

test('the band is centred on the board viewport, whatever the target, and the target only sets the throw side', () => {
  const stageSize = { width: 600, height: 500 };
  const input = {
    anchor: { backgroundId: 'map', targetIds: ['map__hidden', 'map__visible'] },
    visibleTokens: [{ tokenId: 'visible', renderPosition: { x: 200, y: 190, size: 20 } }],
    viewport: { x: -50, y: -20, scale: 1.5 },
    stageSize,
  };
  expect(getCombatDiceMapPosition({ stageSize })).toEqual({ left: 12, top: 95, width: 576, height: 310 });
  expect(getCombatDiceMapPosition({ stageSize: { width: 1281, height: 721 } })).toEqual({ left: 320, top: 150, ...BAND });
  // The visible pawn is left of centre; without it the throw keeps its default side.
  expect(getCombatDiceThrowSide(input)).toBe(-1);
  expect(getCombatDiceThrowSide({ ...input, viewport: { x: 400, y: 0, scale: 1 } })).toBe(1);
  expect(getCombatDiceThrowSide({ ...input, visibleTokens: [] })).toBe(1);
  expect(getCombatDiceThrowSide({ ...input, visibleTokens: [], anchor: { point: { col: 0, row: 0 } }, grid: { cellSizePx: 50 } })).toBe(-1);
});

describe('the map dice', () => {
  let restore;
  let ctx;
  let contexts;
  const stageSize = { width: 1280, height: 720 };
  const mapTray = extra => ({ ...tray, id: {}, kind: 'damage', notation: '3d4', ...extra });
  const mapDice = (current, extra) => (
    <CombatMapDice tray={current} visibleTokens={[]} grid={{ cellSizePx: 50 }} viewport={{ x: 0, y: 0, scale: 1 }}
      stageSize={stageSize} {...extra} />
  );
  const projection = () => screen.queryByTestId('grigliata-board-dice-projection');
  // Lets the renderer's lazy import resolve.
  const flush = () => act(async () => { await Promise.resolve(); });
  const advance = until => act(() => runFrames(until));
  beforeEach(() => {
    restore = useClock();
    contexts = [];
    window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      ctx = fakeContext();
      contexts.push(ctx);
      return ctx;
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => BAND.width });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => BAND.height });
  });
  afterEach(() => {
    restore();
    HTMLCanvasElement.prototype.getContext.mockRestore();
    delete HTMLCanvasElement.prototype.clientWidth;
    delete HTMLCanvasElement.prototype.clientHeight;
    delete window.CanvasRenderingContext2D;
    delete window.matchMedia;
  });

  test('throws the whole pool its notation names from the release and lands it at the centre of the board', async () => {
    clock = 100;
    const sending = mapTray({ phase: 'sending', releasedAt: 100 });
    const { rerender } = render(mapDice(sending));
    await flush();
    const surface = projection();
    expect(surface).toHaveAttribute('aria-hidden', 'true');
    expect(surface).toHaveAttribute('data-dice', '3');
    expect(surface).toHaveAttribute('data-phase', 'rolling');
    expect(surface.style).toMatchObject({ left: '320px', top: '150px', width: '640px', height: '420px' });
    // One canvas: the reader takes the wrapper's canvas strictly.
    expect(surface.innerHTML.match(/<canvas\b/g)).toHaveLength(1);
    advance(1500);
    reset(ctx);
    advance(1540);
    expect(painted(ctx)).toBe(3);
    expect(ctx.fillText).not.toHaveBeenCalled();

    clock = 1600;
    rerender(mapDice({ ...sending, phase: 'result', rolls: faces(4, 3, 1, 4) }));
    await flush();
    expect(contexts).toHaveLength(1);
    expect(projection()).toHaveAttribute('data-phase', 'rolling');
    advance(5000);
    expect(projection()).toHaveAttribute('data-phase', 'settled');
    expect(texts(ctx)).toEqual(expect.arrayContaining(['3', '1', '4']));
    expect(frames).toHaveLength(0);
  });

  test('a renderer loaded only after the reply still rolls in full, and a remount after the landing does not replay it', async () => {
    clock = 120;
    const sending = mapTray({ phase: 'sending', releasedAt: 120 });
    const { rerender, unmount } = render(mapDice(sending));
    // The reply comes before the renderer's chunk: no microtask has run yet.
    clock = 135;
    const result = { ...sending, phase: 'result', rolls: faces(4, 2, 4, 3) };
    rerender(mapDice(result));
    clock = 2200;
    await flush();
    expect(contexts).toHaveLength(1);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(frames.length).toBeGreaterThan(0);
    expect(projection()).toHaveAttribute('data-phase', 'rolling');
    advance(2200 + 850);
    expect(projection()).toHaveAttribute('data-phase', 'rolling');
    expect(ctx.fillText).not.toHaveBeenCalled();
    advance(6000);
    expect(projection()).toHaveAttribute('data-phase', 'settled');
    expect(texts(ctx)).toEqual(expect.arrayContaining(['2', '4', '3']));
    unmount();

    clock = 9000;
    render(mapDice(result));
    await flush();
    expect(contexts).toHaveLength(2);
    expect(texts(ctx)).toEqual(expect.arrayContaining(['2', '4', '3']));
    expect(frames).toHaveLength(0);
    expect(projection()).toHaveAttribute('data-phase', 'settled');
  });

  test('20d100+5d100 throws all fifty d10 while it waits and at the result', async () => {
    clock = 0;
    const sending = mapTray({ phase: 'sending', releasedAt: 0, notation: '20d100+5d100' });
    const { rerender } = render(mapDice(sending));
    await flush();
    expect(projection()).toHaveAttribute('data-dice', '50');
    advance(600);
    reset(ctx);
    advance(640);
    expect(painted(ctx)).toBe(50);
    clock = 700;
    rerender(mapDice({ ...sending, phase: 'result', rolls: Array.from({ length: 25 }, (_, i) => ({ sides: 100, value: 1 + i * 4 })) }));
    await flush();
    expect(projection()).toHaveAttribute('data-dice', '50');
    advance(5000);
    expect(projection()).toHaveAttribute('data-phase', 'settled');
    expect(painted(ctx)).toBeGreaterThanOrEqual(50);
  });

  test('a notation that names no dice waits with an empty map, then the receipt is thrown in full', async () => {
    clock = 0;
    const sending = mapTray({ phase: 'sending', releasedAt: 0, kind: 'attack', notation: 'Dado Anima' });
    const { rerender } = render(mapDice(sending));
    await flush();
    expect(projection()).toBeNull();
    clock = 400;
    rerender(mapDice({ ...sending, phase: 'result', rolls: faces(20, 11, 7) }));
    await flush();
    expect(projection()).toHaveAttribute('data-dice', '2');
    advance(5000);
    expect(projection()).toHaveAttribute('data-phase', 'settled');
    expect(texts(ctx)).toEqual(expect.arrayContaining(['11', '7']));
  });

  test('the band is the same for any target, and a result seen for the first time long after its release lands at rest', async () => {
    clock = 50000;
    const result = { phase: 'result', releasedAt: 100, notation: 'd12', kind: 'attack', rolls: faces(12, 7) };
    const left = mapTray({ ...result, anchor: { point: { col: 1, row: 1 } } });
    const right = mapTray({ ...result, anchor: { point: { col: 24, row: 1 } } });
    const { rerender } = render(mapDice(left));
    await flush();
    const leftStyle = projection().getAttribute('style');
    expect(projection()).toHaveAttribute('data-phase', 'settled');
    expect(frames).toHaveLength(0);
    rerender(mapDice(right));
    await flush();
    expect(projection().getAttribute('style')).toBe(leftStyle);
  });

  test('reduced motion leaves the map empty while the tray lists every signed face as text', async () => {
    window.matchMedia = query => ({ matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} });
    const ready = mapTray({ phase: 'ready', throwDice: jest.fn() });
    const { rerender } = render(<>{mapDice(ready)}<GrigliataCombatDiceTray tray={ready} /></>);
    const roll = screen.getByRole('button', { name: 'Tira i dadi' });
    expect(roll).toBeVisible();
    expect(roll.querySelector('svg, img')).toBeVisible();
    fireEvent.click(roll);
    expect(ready.throwDice).toHaveBeenCalledTimes(1);
    const rolls = [42, 1, 15, 62, 28].map((value, i) => ({ sides: 62, value, ...(i === 4 && { sign: -1 }) }));
    const result = mapTray({ phase: 'result', releasedAt: 0, rolls, notation: '4d62 - 1d62' });
    rerender(<>{mapDice(result)}<GrigliataCombatDiceTray tray={result} /></>);
    await flush();
    expect(projection()).toBeNull();
    expect(contexts).toHaveLength(0);
    const list = screen.getByRole('list', { name: 'Risultati dei dadi' });
    expect(within(list).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['d62 42', 'd62 1', 'd62 15', 'd62 62', 'd62 −28']);
  });
});

test('displays all signed d62 results as text, and the map throws every one of them', () => {
  const rolls = [42, 1, 15, 62, 28].map((value, i) => ({ sides: 62, value, sign: i === 4 ? -1 : 1 }));
  const result = { ...tray, phase: 'result', kind: 'damage', rolls };
  render(<>
    <GrigliataCombatDiceTray tray={result} />
    <CombatMapDice tray={result} visibleTokens={[]} grid={{}} viewport={{ x: 0, y: 0, scale: 1 }} stageSize={{ width: 800, height: 600 }} />
  </>);
  const list = screen.getByRole('list', { name: 'Risultati dei dadi' });
  const items = within(list).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual(['d62 42', 'd62 1', 'd62 15', 'd62 62', 'd62 −28']);
  expect(screen.getByTestId('grigliata-board-dice-projection')).toHaveAttribute('data-dice', '5');
});
