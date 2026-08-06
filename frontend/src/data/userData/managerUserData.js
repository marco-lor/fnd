import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../../AuthContext';
import {
  getUserDirectoryPage,
  subscribeUserDirectoryPage,
} from '../userDirectoryRepository';
import { USER_DATA_DOMAINS } from './domainSchema';
import { subscribeUserDomain } from './userDataRepository';

const MANAGER_DOMAINS = Object.freeze([
  USER_DATA_DOMAINS.PROFILE,
  USER_DATA_DOMAINS.PROGRESSION,
  USER_DATA_DOMAINS.RESOURCES,
  USER_DATA_DOMAINS.SETTINGS,
  USER_DATA_DOMAINS.PROFILE_CONTENT,
  USER_DATA_DOMAINS.INVENTORY,
  USER_DATA_DOMAINS.SPELLS,
  USER_DATA_DOMAINS.TECHNIQUES,
]);
export const MANAGER_USER_PAGE_SIZE = 10;
const MANAGER_USER_DIRECTORY_ROLE = 'player';

const asRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

export const composeManagerUser = (directoryEntry, domains = {}) => {
  const profile = asRecord(domains[USER_DATA_DOMAINS.PROFILE]);
  const progression = asRecord(domains[USER_DATA_DOMAINS.PROGRESSION]);
  const resources = asRecord(domains[USER_DATA_DOMAINS.RESOURCES]);
  const settings = asRecord(domains[USER_DATA_DOMAINS.SETTINGS]);
  const profileContent = asRecord(domains[USER_DATA_DOMAINS.PROFILE_CONTENT]);
  const label = directoryEntry?.label
    || profile.characterId
    || profile.username
    || profile.email
    || 'Unknown User';

  return Object.freeze({
    id: directoryEntry.id,
    role: profile.role || directoryEntry.role || '',
    label,
    displayName: label,
    characterId: profile.characterId || directoryEntry.characterId || '',
    username: profile.username || '',
    email: profile.email || '',
    race: profile.race || '',
    imageUrl: profile.imageUrl || '',
    imagePath: profile.imagePath || '',
    media: profile.media || null,
    flags: {
      ...asRecord(profile.flags),
      ...asRecord(progression.flags),
    },
    summary: asRecord(profile.summary),
    stats: {
      ...asRecord(progression.stats),
      ...asRecord(resources.stats),
    },
    Parametri: asRecord(progression.Parametri),
    AltriParametri: asRecord(progression.AltriParametri),
    active_turn_effect: resources.active_turn_effect ?? null,
    settings: asRecord(settings.settings),
    parameterLocks: asRecord(settings.parameterLocks),
    paramLocks: asRecord(settings.paramLocks),
    grigliata: asRecord(settings.grigliata),
    lingue: asRecord(profileContent.lingue),
    conoscenze: asRecord(profileContent.conoscenze),
    professioni: asRecord(profileContent.professioni),
    inventory: Array.isArray(domains[USER_DATA_DOMAINS.INVENTORY])
      ? domains[USER_DATA_DOMAINS.INVENTORY]
      : [],
    spells: asRecord(domains[USER_DATA_DOMAINS.SPELLS]),
    tecniche: asRecord(domains[USER_DATA_DOMAINS.TECHNIQUES]),
  });
};

export const useManagerUserData = (enabled = true, {
  cursor = null,
  pageSize = MANAGER_USER_PAGE_SIZE,
} = {}) => {
  const { repositoryAccessGeneration = 0 } = useAuthSession();
  const [state, setState] = useState({
    users: [],
    loading: Boolean(enabled),
    error: null,
    hasMore: false,
    nextCursor: null,
    pageSize,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        users: [],
        loading: false,
        error: null,
        hasMore: false,
        nextCursor: null,
        pageSize,
      });
      return undefined;
    }

    let active = true;
    let directoryReady = false;
    let directoryEntries = [];
    let directoryHasMore = false;
    let directoryNextCursor = null;
    const userStates = new Map();
    const domainUnsubscribes = new Map();
    let directoryUnsubscribe = null;

    const publish = () => {
      if (!active) return;
      const users = directoryEntries
        .map((entry) => {
          const userState = userStates.get(entry.id);
          return userState?.received.size === MANAGER_DOMAINS.length
            ? composeManagerUser(entry, userState.domains)
            : null;
        })
        .filter(Boolean);
      setState({
        users,
        loading: !directoryReady || users.length !== directoryEntries.length,
        error: null,
        hasMore: directoryHasMore,
        nextCursor: directoryNextCursor,
        pageSize,
      });
    };

    const fail = (error) => {
      if (!active) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        error: error || new Error('Unable to load canonical manager user data.'),
      }));
    };

    const removeUser = (uid) => {
      domainUnsubscribes.get(uid)?.forEach((unsubscribe) => unsubscribe?.());
      domainUnsubscribes.delete(uid);
      userStates.delete(uid);
    };

    const subscribeUser = (uid) => {
      if (domainUnsubscribes.has(uid)) return;
      const userState = { domains: {}, received: new Set() };
      userStates.set(uid, userState);
      const unsubscribes = MANAGER_DOMAINS.map((domain) => subscribeUserDomain(
        uid,
        domain,
        {
          next: (value) => {
            if (!active) return;
            userState.domains = { ...userState.domains, [domain]: value };
            userState.received.add(domain);
            publish();
          },
          error: fail,
        }
      ));
      domainUnsubscribes.set(uid, unsubscribes);
    };

    const applyDirectory = (result) => {
      const nextEntries = Array.isArray(result?.items) ? result.items : [];
      const nextIds = new Set(nextEntries.map((entry) => entry.id));
      [...domainUnsubscribes.keys()]
        .filter((uid) => !nextIds.has(uid))
        .forEach(removeUser);
      directoryEntries = nextEntries;
      directoryHasMore = result?.hasMore === true;
      directoryNextCursor = directoryHasMore ? result?.cursor || null : null;
      directoryEntries.forEach((entry) => subscribeUser(entry.id));
      directoryReady = true;
      publish();
    };

    setState({
      users: [],
      loading: true,
      error: null,
      hasMore: false,
      nextCursor: null,
      pageSize,
    });
    (async () => {
      try {
        const page = await getUserDirectoryPage({
          role: MANAGER_USER_DIRECTORY_ROLE,
          cursor,
          pageSize,
        });
        if (!active) return;
        applyDirectory(page);
        directoryUnsubscribe = subscribeUserDirectoryPage({
          next: applyDirectory,
          error: fail,
        }, {
          role: MANAGER_USER_DIRECTORY_ROLE,
          cursor,
          pageSize,
        });
      } catch (error) {
        fail(error);
      }
    })();

    return () => {
      active = false;
      directoryUnsubscribe?.();
      [...domainUnsubscribes.keys()].forEach(removeUser);
    };
  }, [cursor, enabled, pageSize, repositoryAccessGeneration]);

  return useMemo(() => state, [state]);
};
