export const buildManagerResourceTotalOptions = (user, resource) => {
  if (resource !== 'barriera') return {};
  const effect = user?.active_turn_effect?.barriera;
  const remainingTurns = Math.max(
    0,
    Math.trunc(Number(effect?.remainingTurns) || 0)
  );
  const totalTurns = Math.max(
    remainingTurns,
    Math.trunc(Number(effect?.totalTurns) || 0)
  );
  return { remainingTurns, totalTurns };
};
