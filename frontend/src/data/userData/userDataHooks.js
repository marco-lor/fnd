import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../../AuthContext';
import { USER_DATA_DOMAINS } from './domainSchema';
import { subscribeUserDomain } from './userDataRepository';

const createIdleState = (scopeKey = null) => ({
  data: null,
  status: 'idle',
  error: null,
  source: null,
  stage: null,
  scopeKey,
});

const createLoadingState = (scopeKey) => ({
  ...createIdleState(scopeKey),
  status: 'loading',
});

export const useUserDomain = (domain, requestedUid = null) => {
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  const uid = requestedUid || user?.uid || null;
  const scopeKey = uid ? `${domain}:${uid}:${repositoryAccessGeneration}` : null;
  const [state, setState] = useState(createIdleState);

  useEffect(() => {
    if (!uid) {
      setState(createIdleState(scopeKey));
      return undefined;
    }
    let active = true;
    setState(createLoadingState(scopeKey));
    const unsubscribe = subscribeUserDomain(uid, domain, {
      next: (data, metadata = {}) => setState((previous) => {
        if (!active || previous.scopeKey !== scopeKey) return previous;
        if (
          previous.data === data
          && previous.status === 'fresh'
          && previous.source === metadata.source
          && previous.stage === metadata.stage
        ) return previous;
        return {
          data,
          status: data === null ? 'missing' : 'fresh',
          error: null,
          source: metadata.source || null,
          stage: metadata.stage || null,
          scopeKey,
        };
      }),
      error: (error) => setState((previous) => {
        if (!active || previous.scopeKey !== scopeKey) return previous;
        return {
          ...previous,
          status: 'error',
          error: error || new Error(`Unable to load user ${domain}.`),
        };
      }),
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [domain, scopeKey, uid]);

  return useMemo(() => {
    const visibleState = state.scopeKey === scopeKey
      ? state
      : (uid ? createLoadingState(scopeKey) : createIdleState(scopeKey));
    return {
      data: visibleState.data,
      status: visibleState.status,
      error: visibleState.error,
      source: visibleState.source,
      stage: visibleState.stage,
      uid,
    };
  }, [scopeKey, state, uid]);
};

export const useUserProfile = (uid) => useUserDomain(USER_DATA_DOMAINS.PROFILE, uid);
export const useProgression = (uid) => useUserDomain(USER_DATA_DOMAINS.PROGRESSION, uid);
export const useResources = (uid) => useUserDomain(USER_DATA_DOMAINS.RESOURCES, uid);
export const useUserSettings = (uid) => useUserDomain(USER_DATA_DOMAINS.SETTINGS, uid);
export const useEquipment = (uid) => useUserDomain(USER_DATA_DOMAINS.EQUIPMENT, uid);
export const useProfileContent = (uid) => useUserDomain(USER_DATA_DOMAINS.PROFILE_CONTENT, uid);
export const useInventory = (uid) => useUserDomain(USER_DATA_DOMAINS.INVENTORY, uid);
export const usePersonalSpells = (uid) => useUserDomain(USER_DATA_DOMAINS.SPELLS, uid);
export const usePersonalTechniques = (uid) => useUserDomain(USER_DATA_DOMAINS.TECHNIQUES, uid);
