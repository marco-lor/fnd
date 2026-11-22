import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GrigliataTokenStackControls from './GrigliataTokenStackControls';

const grid = { cellSizePx: 50, offsetXPx: 0, offsetYPx: 0 };
const tokensById = new Map([
  ['nyx', { tokenId: 'nyx', label: 'Nyx', canMove: true }],
  ['frusta', { tokenId: 'frusta', label: 'Frusta Magica', canMove: false }],
]);
const buildStack = (overrides = {}) => ({
  col: 5,
  row: 5,
  badgeCellKey: '5:5',
  tokenIds: ['frusta', 'nyx'],
  anchor: { x: 275, y: 275 },
  ...overrides,
});
const renderControls = ({ stack = buildStack(), viewport, stageSize = { width: 800, height: 600 }, choice = null } = {}) => (
  render(
    <GrigliataTokenStackControls
      stacks={[stack]}
      tokensById={tokensById}
      viewport={viewport}
      stageSize={stageSize}
      grid={grid}
      choice={choice}
      onChoose={jest.fn()}
    />
  )
);

const badgeRect = (badge) => {
  const left = Number.parseFloat(badge.style.left);
  const top = Number.parseFloat(badge.style.top);
  return {
    left,
    top,
    right: left + Number.parseFloat(badge.style.width),
    bottom: top + Number.parseFloat(badge.style.height),
  };
};
const cellRect = (col, row, viewport) => {
  const size = grid.cellSizePx * viewport.scale;
  const left = viewport.x + ((grid.offsetXPx + (col * grid.cellSizePx)) * viewport.scale);
  const top = viewport.y + ((grid.offsetYPx + (row * grid.cellSizePx)) * viewport.scale);
  return { left, top, right: left + size, bottom: top + size };
};
const rectCenter = (rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
const containsPoint = (rect, point) => (
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const toScreen = (point, viewport) => ({
  x: viewport.x + (point.x * viewport.scale),
  y: viewport.y + (point.y * viewport.scale),
});

// The hit area must stay inside its own cell, away from its center, and off
// every neighboring cell (so their token centers and bodies stay draggable).
const expectBadgeConfinedToOwnCell = (badge, viewport, { col = 5, row = 5 } = {}) => {
  const rect = badgeRect(badge);
  const own = cellRect(col, row, viewport);
  expect(rect.right - rect.left).toBeGreaterThanOrEqual(1);
  expect(rect.left).toBeGreaterThanOrEqual(own.left);
  expect(rect.top).toBeGreaterThanOrEqual(own.top);
  expect(rect.right).toBeLessThanOrEqual(own.right);
  expect(rect.bottom).toBeLessThanOrEqual(own.bottom);
  expect(containsPoint(rect, rectCenter(own))).toBe(false);

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      if (!rowOffset && !colOffset) continue;
      const neighbor = cellRect(col + colOffset, row + rowOffset, viewport);
      expect(overlaps(rect, neighbor)).toBe(false);
      expect(containsPoint(rect, rectCenter(neighbor))).toBe(false);
    }
  }
  return rect;
};

describe('GrigliataTokenStackControls badge placement', () => {
  const minZoomViewport = { x: 0, y: 0, scale: 0.2 }; // 10 px cells on screen

  test('keeps the picker reachable at the board’s five-percent zoom limit', () => {
    const viewport = { x: 0, y: 0, scale: 0.05 };
    renderControls({ viewport });
    const badge = screen.getByRole('button', { name: /2 pedine sovrapposte/i });
    expectBadgeConfinedToOwnCell(badge, viewport);
    fireEvent.click(badge);
    expect(screen.getByRole('dialog', { name: 'Pedine sovrapposte' })).toBeVisible();
  });

  test('keeps the diagonal neighbor and the own center free with 10 px cells', () => {
    renderControls({ viewport: minZoomViewport });
    const badge = screen.getByTestId('token-stack-badge-5:5');

    const rect = expectBadgeConfinedToOwnCell(badge, minZoomViewport);
    // Up-right diagonal neighbor (6:4), the one the previous 20 px badge covered.
    const diagonal = cellRect(6, 4, minZoomViewport);
    expect(overlaps(rect, diagonal)).toBe(false);
    expect(containsPoint(rect, rectCenter(diagonal))).toBe(false);
    expect(badge).toHaveAttribute('data-compact', 'true');
    expect(badge).toHaveAccessibleName(expect.stringContaining('Frusta Magica, Nyx'));
  });

  test('shows the count on a non-intercepting label that opens on hover, focus or open', () => {
    renderControls({ viewport: minZoomViewport });
    const badge = screen.getByTestId('token-stack-badge-5:5');
    const label = screen.getByTestId('token-stack-label-5:5');

    expect(label).toHaveTextContent('×2');
    expect(label).toHaveAttribute('aria-hidden', 'true');
    expect(label).toHaveClass('pointer-events-none', 'invisible', 'group-hover:visible', 'group-focus-visible:visible');

    fireEvent.click(badge);
    expect(badge).toHaveAttribute('aria-expanded', 'true');
    expect(label).toHaveClass('visible');
    expect(label).not.toHaveClass('invisible');
    expect(screen.getByTestId('token-stack-option-nyx')).toHaveFocus();
  });

  test('keeps the own center free at minimum zoom once a token is chosen', () => {
    renderControls({ viewport: minZoomViewport, choice: { badgeCellKey: '5:5', tokenId: 'nyx' } });
    const badge = screen.getByTestId('token-stack-badge-5:5');

    expectBadgeConfinedToOwnCell(badge, minZoomViewport);
    expect(badge).toHaveClass('border-amber-300');
  });

  test('renders the readable count inside a zoom-sized badge at larger zoom', () => {
    const viewport = { x: 0, y: 0, scale: 2 }; // 100 px cells
    renderControls({ viewport });
    const badge = screen.getByTestId('token-stack-badge-5:5');

    const rect = expectBadgeConfinedToOwnCell(badge, viewport);
    expect(rect.right - rect.left).toBe(24);
    expect(rect.right).toBe(cellRect(5, 5, viewport).right);
    expect(rect.top).toBe(cellRect(5, 5, viewport).top);
    expect(badge).toHaveAttribute('data-compact', 'false');
    expect(badge).toHaveTextContent('×2');
    expect(screen.queryByTestId('token-stack-label-5:5')).not.toBeInTheDocument();
  });

  test('follows an off-center fog anchor to its corner without covering the anchor', () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const anchor = { x: 252, y: 290 }; // visible sliver in the bottom-left of cell 5:5
    renderControls({ viewport, stack: buildStack({ anchor }) });
    const badge = screen.getByTestId('token-stack-badge-5:5');

    const rect = expectBadgeConfinedToOwnCell(badge, viewport);
    expect(containsPoint(rect, toScreen(anchor, viewport))).toBe(false);
    expect(rect.bottom).toBe(cellRect(5, 5, viewport).bottom);
  });

  test('moves to another corner when the fog anchor sits in the preferred one', () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const anchor = { x: 250.5, y: 299.5 };
    renderControls({ viewport, stack: buildStack({ anchor }) });
    const badge = screen.getByTestId('token-stack-badge-5:5');

    const rect = expectBadgeConfinedToOwnCell(badge, viewport);
    expect(containsPoint(rect, toScreen(anchor, viewport))).toBe(false);
  });

  test('flips inside the stage when the viewport pushes the cell corner off screen', () => {
    const viewport = { x: 30, y: -265, scale: 1 }; // cell 5:5 spans x 280-330, y -15-35
    const stageSize = { width: 300, height: 400 };
    renderControls({ viewport, stageSize });
    const badge = screen.getByTestId('token-stack-badge-5:5');

    const rect = expectBadgeConfinedToOwnCell(badge, viewport);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(stageSize.width);
    expect(rect.bottom).toBeLessThanOrEqual(stageSize.height);
  });

  test('skips stacks whose cell is entirely off screen', () => {
    renderControls({ viewport: { x: -1000, y: 0, scale: 1 } });
    expect(screen.queryByTestId('token-stack-badge-5:5')).not.toBeInTheDocument();
  });
});
