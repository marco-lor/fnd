import { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../../AuthContext';
import {
  USER_DIRECTORY_PAGE_SIZE,
  getUserDirectoryPage,
  subscribeUserDirectoryFirstPage,
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

const directoryCapacityError = () => new Error(
  'DM Dashboard refuses a bounded '
    + USER_DIRECTORY_PAGE_SIZE
    + '-user directory page because more users may exist. '
    + 'Add explicit pagination before continuing.'
);

export const useManagerUserData = (enabled = true) => {
  const { repositoryAccessGeneration = 0 } = useAuthSession();
  const [state, setState] = useState({
    users: [],
    loading: Boolean(enabled),
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ users: [], loading: false, error: null });
      return undefined;
    }

    let active = true;
    let directoryReady = false;
    let directoryEntries = [];
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

    const applyDirectory = (items) => {
      const nextEntries = Array.isArray(items) ? items : [];
      if (nextEntries.length >= USER_DIRECTORY_PAGE_SIZE) {
        fail(directoryCapacityError());
        return false;
      }
      const nextIds = new Set(nextEntries.map((entry) => entry.id));
      [...domainUnsubscribes.keys()]
        .filter((uid) => !nextIds.has(uid))
        .forEach(removeUser);
      directoryEntries = nextEntries;
      directoryEntries.forEach((entry) => subscribeUser(entry.id));
      directoryReady = true;
      publish();
      return true;
    };

    setState({ users: [], loading: true, error: null });
    (async () => {
      try {
        const firstPage = await getUserDirectoryPage();
        if (!active) return;
        if (firstPage.hasMore) {
          fail(directoryCapacityError());
          return;
        }
        if (!applyDirectory(firstPage.items)) return;
        directoryUnsubscribe = subscribeUserDirectoryFirstPage({
          next: (result) => applyDirectory(result?.items),
          error: fail,
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
  }, [enabled, repositoryAccessGeneration]);

  return useMemo(() => state, [state]);
};

