import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../../AuthContext';
import { USER_DATA_DOMAINS } from './domainSchema';
import { subscribeUserDomain } from './userDataRepository';
import {
  useOptionalHomeReadSelector,
  useOptionalHomeReadStore,
} from '../../components/home/homeReadStore';

const createIdleState = (scopeKey = null) => ({
  data: null,
  status: 'idle',
  error: null,
  scopeKey,
});

const createLoadingState = (scopeKey) => ({
  ...createIdleState(scopeKey),
  status: 'loading',
});

export const useUserDomain = (
  domain,
  requestedUid = null,
  selectData = (data) => data,
  isDataEqual = Object.is
) => {
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  const homeStore = useOptionalHomeReadStore();
  const uid = requestedUid || user?.uid || null;
  const scopeKey = uid ? `${domain}:${uid}:${repositoryAccessGeneration}` : null;
  const [state, setState] = useState(createIdleState);

  useEffect(() => {
    if (homeStore) return undefined;
    if (!uid) {
      setState(createIdleState(scopeKey));
      return undefined;
    }
    let active = true;
    setState(createLoadingState(scopeKey));
    const unsubscribe = subscribeUserDomain(uid, domain, {
      next: (data) => setState((previous) => {
        if (!active || previous.scopeKey !== scopeKey) return previous;
        if (
          previous.data === data
          && previous.status === 'fresh'
        ) return previous;
        return {
          data,
          status: data === null ? 'missing' : 'fresh',
          error: null,
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
  }, [domain, homeStore, scopeKey, uid]);

  const localResult = useMemo(() => {
    const visibleState = state.scopeKey === scopeKey
      ? state
      : (uid ? createLoadingState(scopeKey) : createIdleState(scopeKey));
    return {
      data: selectData(visibleState.data),
      status: visibleState.status,
      error: visibleState.error,
      uid,
    };
  }, [scopeKey, selectData, state, uid]);
  return useOptionalHomeReadSelector(
    (homeState) => {
      const slice = homeState[domain];
      return {
        ...slice,
        data: selectData(slice.data),
      };
    },
    localResult,
    (left, right) => (
      left.status === right.status
      && left.error === right.error
      && left.uid === right.uid
      && isDataEqual(left.data, right.data)
    )
  );
};

export const useUserProfile = (uid) => useUserDomain(USER_DATA_DOMAINS.PROFILE, uid);
export const useProgression = (uid, selector, equality) => useUserDomain(USER_DATA_DOMAINS.PROGRESSION, uid, selector, equality);
export const useResources = (uid, selector, equality) => useUserDomain(USER_DATA_DOMAINS.RESOURCES, uid, selector, equality);
export const useUserSettings = (uid, selector, equality) => useUserDomain(USER_DATA_DOMAINS.SETTINGS, uid, selector, equality);
export const useEquipment = (uid, selector, equality) => useUserDomain(USER_DATA_DOMAINS.EQUIPMENT, uid, selector, equality);
export const useProfileContent = (uid, selector, equality) => useUserDomain(USER_DATA_DOMAINS.PROFILE_CONTENT, uid, selector, equality);
export const useInventory = (uid, selector, equality) => useUserDomain(USER_DATA_DOMAINS.INVENTORY, uid, selector, equality);
export const usePersonalSpells = (uid) => useUserDomain(USER_DATA_DOMAINS.SPELLS, uid);
export const usePersonalTechniques = (uid) => useUserDomain(USER_DATA_DOMAINS.TECHNIQUES, uid);
