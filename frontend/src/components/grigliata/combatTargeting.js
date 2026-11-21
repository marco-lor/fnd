export function combatDistance(origin, target) {
  const gap = (axis) => Math.max(0,
    origin[axis] - target[axis] - (target.sizeSquares || 1) + 1,
    target[axis] - origin[axis] - (origin.sizeSquares || 1) + 1);
  return Math.max(gap('col'), gap('row')) * 5;
}

export const picksGround = (action) => ['ground', 'point'].includes(action?.mode)
  || (action?.mode === 'area' && action.area?.shape !== 'cone');
export const picksMultiple = (action) => action?.mode === 'multiple'
  || action?.area?.shape === 'cone' || action?.maxTargets > 1;

export function combatArea(action, point) {
  if (!point || action?.area?.shape !== 'square') return null;
  const side = Math.max(1, action.area.sideSquares || 1);
  const shift = Math.floor((side - 1) / 2);
  return { col: point.col - shift, row: point.row - shift, sizeSquares: side };
}

export function withinCombatRange(origin, target, action) {
  if (!origin || !target || !action) return false;
  let distance = combatDistance(origin, target);
  // Same measure as the server's combatInRange: the whole footprint must fit, whatever is aimed at.
  if (action.area?.anchor === 'farthest') {
    const side = Math.max(1, action.area.sideSquares || 1);
    const shift = Math.floor((side - 1) / 2);
    const extents = [-shift, side - 1 - shift];
    distance = Math.max(...extents.flatMap(col =>
      extents.map(row => combatDistance(origin, { col: target.col + col, row: target.row + row }))));
  }
  return distance >= (action.minRangeFt || 0) && (action.rangeFt == null || distance <= action.rangeFt);
}

// Range for the ordered target role being chosen; null means no limit.
export const combatRoleRange = (action, roleIndex = 0) =>
  (action?.roleRangesFt ? action.roleRangesFt[roleIndex] : action?.rangeFt) ?? null;

// Distance band that supplies the damage at this distance, if the action has bands.
export const combatDamageBand = (action, distanceFt) =>
  action?.damageBands?.find(band => distanceFt >= band.minFt && distanceFt <= band.maxFt) || null;

// The server's combatAllies on board tokens: foes stand apart from characters and custom pawns; within a side, a pawn's
// allies are the pawns its account controls and every player character. Another account's custom pawn is never one: a
// player's board reads another account's foe as `custom` too, so this matches the server without knowing which it is.
export function combatAllies(origin, token) {
  return (origin?.tokenType === 'foe') === (token?.tokenType === 'foe') && (
    (!!origin?.ownerUid && origin.ownerUid === token?.ownerUid)
    || (origin?.tokenType === 'character' && token?.tokenType === 'character'));
}

export function canTargetToken(origin, token, action, roleIndex = 0) {
  if (!origin || !action || (token.isDead && !action.allowDead)) return false;
  if (action.requireDead && !token.isDead) return false;
  if (action.mode === 'self') return origin.placementId === token.placementId;
  if ((!action.allowSelf || (action.targetRoles && roleIndex === 0)) && origin.placementId === token.placementId) return false;
  if (['ally', 'selfOrAlly'].includes(action.relation) && !combatAllies(origin, token)) return false;
  return withinCombatRange(origin, token, {...action, rangeFt:combatRoleRange(action, roleIndex)});
}
