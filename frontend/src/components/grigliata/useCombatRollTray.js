import { useLayoutEffect, useRef, useState } from 'react';

export default function useCombatRollTray(context, isDefinitiveError, isCancelled, isCancelling) {
  const [state, setState] = useState(null);
  const current = useRef(null);
  const show = next => {
    current.current = next;
    setState(next);
  };

  useLayoutEffect(() => {
    setState(null);
    return () => { current.current = null; };
  }, [context]);

  useLayoutEffect(() => {
    if (isCancelled(current.current?.combatId)) show(null);
  });

  const prepare = (plan, origin = document.activeElement) => {
    if (!context || (current.current?.phase === 'sending' && !isCancelled(current.current.combatId))
      || isCancelled(plan.combatId) || isCancelling(plan.combatId)) return undefined;
    const id = {};
    let declarationChanged = false;
    const close = () => {
      if (current.current?.id !== id || current.current.phase === 'sending') return;
      show(null);
      if (origin?.isConnected) origin.focus();
    };
    const throwDice = async gesture => {
      const tray = current.current;
      if (tray?.id !== id || !['ready', 'error'].includes(tray.phase)
        || isCancelled(plan.combatId) || isCancelling(plan.combatId)) return;
      const sent = { ...tray, phase: 'sending', error: undefined, gesture, releasedAt: performance.now() };
      show(sent);
      try {
        const { data } = await plan.send();
        if (current.current === sent) {
          const combatId = data?.combatId || plan.combatId;
          if (isCancelled(combatId)) {
            show(null);
            return;
          }
          show({ ...sent, phase: 'result', rolls: data?.rolls, gesture, combatId,
            damage: plan.kind === 'damage' ? data?.damage : undefined });
        }
      } catch (error) {
        if (current.current === sent) {
          if (declarationChanged || isCancelled(plan.combatId)) {
            show(null);
            return;
          }
          const definitive = isDefinitiveError(error);
          show({ ...sent, phase: definitive ? 'rejected' : 'error',
            error: definitive ? error?.message || 'Tiro rifiutato.' : 'Tiro non confermato. Puoi riprovare.' });
        }
      }
    };
    show({ id, context, phase: 'ready', title: plan.title, notation: plan.notation, kind: plan.kind,
      combatId: plan.combatId, targetPlacementId: plan.targetPlacementId, anchor: plan.anchor, scope: plan.scope, close, throwDice });
    return ({ includeError = true } = {}) => {
      if (includeError) declarationChanged = true;
      const active = current.current;
      if (active?.id === id && (active.phase === 'ready' || (includeError && active.phase === 'error'))) show(null);
    };
  };

  return [state?.context === context && !isCancelled(state.combatId) ? state : null, prepare];
}
