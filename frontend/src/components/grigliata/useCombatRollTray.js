import { useLayoutEffect, useRef, useState } from 'react';

export default function useCombatRollTray(context, isDefinitiveError) {
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

  const prepare = (plan, origin = document.activeElement) => {
    if (!context || current.current?.phase === 'sending') return undefined;
    const id = {};
    let declarationChanged = false;
    const close = () => {
      if (current.current?.id !== id || current.current.phase === 'sending') return;
      show(null);
      if (origin?.isConnected) origin.focus();
    };
    const throwDice = async gesture => {
      const tray = current.current;
      if (tray?.id !== id || !['ready', 'error'].includes(tray.phase)) return;
      const sent = { ...tray, phase: 'sending', error: undefined, gesture, releasedAt: performance.now() };
      show(sent);
      try {
        const { data } = await plan.send();
        if (current.current === sent) {
          show({ ...sent, phase: 'result', rolls: data?.rolls, gesture, combatId: data?.combatId || plan.combatId,
            damage: plan.kind === 'damage' ? data?.damage : undefined });
        }
      } catch (error) {
        if (current.current === sent) {
          if (declarationChanged) {
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

  return [state?.context === context ? state : null, prepare];
}
