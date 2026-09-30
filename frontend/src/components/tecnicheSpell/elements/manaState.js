// Shared parsing/reduction rules. Callers retain their distinct reduction keys,
// action labels and retry identities; the server remains the mana authority.
export function getManaState(cost, userData, reductionKey) {
  const match = (cost?.toString() || '0').match(/(\d+)/);
  const originalCost = match ? parseInt(match[1], 10) : 0;
  const special = userData?.Parametri?.Special;
  const valueOf = node => {
    if (typeof node === 'number') return node;
    if (node && typeof node === 'object') return Number(node.Tot ?? node.tot ?? node.value ?? 0) || 0;
    return Number(node) || 0;
  };
  const norm = value => value.toLowerCase().replace(/\s|_/g, '');
  let costReduction = 0;
  if (special) {
    const exact = valueOf(special[reductionKey]);
    costReduction = !isNaN(exact) && exact ? exact : 0;
    if (!costReduction) {
      const desired = norm(reductionKey);
      for (const matches of [key => norm(key) === desired, key => norm(key).includes(desired)]) {
        for (const key of Object.keys(special)) {
          if (matches(key) && valueOf(special[key])) { costReduction = valueOf(special[key]); break; }
        }
        if (costReduction) break;
      }
    }
  }
  const manaCost = originalCost > 0 ? Math.max(1, originalCost - costReduction) : 0;
  const currentMana = userData?.stats?.manaCurrent || 0;
  return { originalCost, costReduction, manaCost, currentMana, hasSufficientMana: currentMana >= manaCost };
}
