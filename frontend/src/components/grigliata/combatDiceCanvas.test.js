import { combatThrowFrame, combatThrowModel } from './combatDiceCanvas';

// For two orientations, the trace of their relative rotation gives the angle between them.
function rotationDelta(previous, current) {
  const trace = current.reduce((sum, row, i) => sum + row.reduce((dot, v, j) => dot + v * previous[i][j], 0), 0);
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
}

test.each([[1, 15], [-1, 15], [1, 2000], [-1, 2000]])(
  'three d4 turn smoothly onto their server faces with direction %i and a %i ms reply',
  (direction, resolvedAt) => {
    const planned = Array.from({ length: 3 }, () => ({ sides: 4 }));
    const receipt = [3, 4, 1].map(value => ({ sides: 4, value }));
    const roll = combatThrowModel({ planned, receipt, releasedAt: 0, resolvedAt, direction });
    let frame = combatThrowFrame(roll, roll.landAt, 640, 300);
    let largestTurn = 0;
    for (let time = roll.landAt; time < roll.doneAt; time += 16) {
      const next = combatThrowFrame(roll, Math.min(time + 16, roll.doneAt), 640, 300);
      for (let i = 0; i < next.length; i++) {
        largestTurn = Math.max(largestTurn, rotationDelta(frame[i].matrix, next[i].matrix));
      }
      frame = next;
    }
    expect(frame.map(({ die }) => die.value)).toEqual([3, 4, 1]);
    expect(largestTurn).toBeLessThan(Math.PI / 3);
  }
);
