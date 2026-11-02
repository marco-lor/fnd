import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../AuthContext';
import { subscribeEchiNpcs } from './echiNpcsRepository';

const EMPTY_ITEMS = Object.freeze([]);
const EMPTY_BY_ID = Object.freeze({});
const emptyState = (scopeKey) => ({
  scopeKey, npcs: EMPTY_ITEMS, npcById: EMPTY_BY_ID, npcLoading: scopeKey !== null, npcError: '',
});

export const useEchiNpcs = () => {
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  const uid = user?.uid || null;
  const scopeKey = uid ? `${uid}:${repositoryAccessGeneration}` : null;
  const [state, setState] = useState(() => emptyState(null));

  useEffect(() => {
    setState(emptyState(scopeKey));
    if (!scopeKey) return undefined;
    let active = true;
    const unsubscribe = subscribeEchiNpcs({
      next: (projection) => {
        if (!active) return;
        setState((previous) => {
          if (!active || previous.scopeKey !== scopeKey) return previous;
          if (previous.npcs === projection.items && previous.npcById === projection.byId && !previous.npcLoading) return previous;
          return { scopeKey, npcs: projection.items, npcById: projection.byId, npcLoading: false, npcError: '' };
        });
      },
      error: () => {
        if (!active) return;
        active = false;
        setState({ ...emptyState(scopeKey), npcLoading: false, npcError: 'Unable to load NPC list.' });
      },
    }, { scopeKey });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scopeKey]);

  return useMemo(() => {
    const visible = state.scopeKey === scopeKey ? state : emptyState(scopeKey);
    return { npcs: visible.npcs, npcById: visible.npcById, npcLoading: visible.npcLoading, npcError: visible.npcError };
  }, [scopeKey, state]);
};
