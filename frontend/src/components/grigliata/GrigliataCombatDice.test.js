import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataCombatDiceTray, { canAnimateCombatDice, getCombatDiceMapPosition } from './GrigliataCombatDice';
import { animateCombatDice, mesh, percentileSolids } from './combatDiceCanvas';

const tray = { id: {}, phase: 'ready', kind: 'attack', title: 'Spada', notation: 'd12', close: () => {} };

test('short movement and vertical scrolling stay inert; horizontal release or the button can throw', () => {
  const throwDice = jest.fn();
  const oldPointerEvent = window.PointerEvent;
  window.PointerEvent = MouseEvent;
  try {
    render(<GrigliataCombatDiceTray tray={{ ...tray, throwDice }} />);
    const handle = screen.getByText('Trascina per tirare');
    fireEvent.pointerDown(handle, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(handle, { clientX: 24, clientY: 20 });
    fireEvent.pointerDown(handle, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(handle, { clientX: 22, clientY: 85 });
    expect(throwDice).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { clientX: 90, clientY: 20 });
    fireEvent.pointerUp(handle, { clientX: 30, clientY: 20 });
    expect(throwDice).toHaveBeenCalledWith({ direction: -1, power: expect.any(Number) });
    fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
    expect(throwDice).toHaveBeenCalledTimes(2);
  } finally {
    window.PointerEvent = oldPointerEvent;
  }
});

test('every numbered mesh has its own complete set of faces and d100 displays tens and units', () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    expect(mesh(sides).map(face => face.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: sides }, (_, i) => i + 1));
  }
  const marks = value => percentileSolids({ value }).map(die => die.format(die.value));
  expect(marks(100)).toEqual(['00', '0']);
  expect(marks(37)).toEqual(['30', '7']);
  expect(marks(80)).toEqual(['80', '0']);
});

test('uses real standard solids for a 12d6 pool and displays all unsupported signed results as text', () => {
  expect(canAnimateCombatDice(Array.from({ length: 12 }, () => ({ sides: 6, value: 2 })))).toBe(true);
  const rolls = [42, 1, 15, 62, 28].map((value, i) => ({ sides: 62, value, sign: i === 4 ? -1 : 1 }));
  expect(canAnimateCombatDice(rolls)).toBe(false);
  render(<GrigliataCombatDiceTray tray={{ ...tray, phase: 'result', kind: 'damage', rolls }} />);
  const list = screen.getByRole('list', { name: 'Risultati dei dadi' });
  const items = within(list).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual(['d62 42', 'd62 1', 'd62 15', 'd62 62', 'd62 −28']);
  expect(document.querySelector('canvas')).toBeNull();
});

test('removing a live projection cancels its frame and disconnects its resize observer', () => {
  const canvas = { clientWidth: 400, clientHeight: 96 };
  const gradient = { addColorStop: jest.fn() };
  const ctx = { createLinearGradient: () => gradient, createRadialGradient: () => gradient };
  for (const method of ['setTransform', 'clearRect', 'save', 'translate', 'scale', 'fillRect', 'restore',
    'beginPath', 'lineTo', 'moveTo', 'closePath', 'fill', 'stroke', 'transform', 'strokeText', 'fillText']) {
    ctx[method] = jest.fn();
  }
  canvas.getContext = () => ctx;
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(15);
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const oldResize = window.ResizeObserver;
  const disconnect = jest.fn();
  window.ResizeObserver = class {
    observe() {}
    disconnect() { disconnect(); }
  };
  try {
    const release = animateCombatDice(canvas, [{ sides: 6, value: 2 }], 35);
    expect(ctx.fillText).toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    release();
    expect(cancel).toHaveBeenCalledWith(15);
    expect(disconnect).toHaveBeenCalledTimes(1);
    ctx.fillText.mockClear();
    ctx.fill.mockClear();
    const cancelPending = animateCombatDice(canvas, [{ sides: 6, value: 2 }], 35, { pending: true });
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    cancelPending();
  } finally {
    raf.mockRestore();
    cancel.mockRestore();
    window.ResizeObserver = oldResize;
  }
});

test('a map result transforms the visible target, skips hidden IDs and clamps the landing area', () => {
  const input = {
    anchor: { backgroundId: 'map', targetIds: ['map__hidden', 'map__visible'] },
    visibleTokens: [{ tokenId: 'visible', renderPosition: { x: 200, y: 190, size: 20 } }],
    viewport: { x: -50, y: -20, scale: 1.5 },
    stageSize: { width: 600, height: 500 },
  };
  expect(getCombatDiceMapPosition(input)).toEqual({ left: 153, top: 176, width: 280, height: 104 });
  expect(getCombatDiceMapPosition({ ...input, visibleTokens: [] })).toEqual({ left: 160, top: 148, width: 280, height: 104 });
  expect(getCombatDiceMapPosition({ ...input, viewport: { x: -500, y: 600, scale: 1 } }))
    .toMatchObject({ left: 12, top: 384 });
});
