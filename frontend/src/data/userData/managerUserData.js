import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthSession } from '../../AuthContext';
import {
  subscribeUserDirectoryPage,
} from '../userDirectoryRepository';
import { USER_DATA_DOMAINS } from './domainSchema';
import { subscribeUserDomain } from './userDataRepository';
import { subscribeManagerSummary } from './managerSummaryRepository';
import { preserveUserDomainIdentity } from './normalizers';

export const MANAGER_DETAIL_DOMAINS = Object.freeze([
  USER_DATA_DOMAINS.PROFILE_CONTENT, USER_DATA_DOMAINS.INVENTORY,
  USER_DATA_DOMAINS.SPELLS, USER_DATA_DOMAINS.TECHNIQUES,
]);
export const MANAGER_MAX_EXPANDED = 3;
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
  cursor = null, pageSize = MANAGER_USER_PAGE_SIZE, search = '',
} = {}) => {
  const { repositoryAccessGeneration = 0 } = useAuthSession();
  const [state, setState] = useState({ users: [], unavailableUsers: [], loading: Boolean(enabled), error: null });
  const retryRef = useRef(() => {});
  const retry = useCallback(() => retryRef.current(), []);
  useEffect(() => {
    let active = true;
    let entries = [];
    let page = {};
    let directoryError = null;
    let directoryReady = false;
    let directorySequence = 0;
    let stopDirectory;
    const records = new Map();
    const publish = () => {
      if (!active) return;
      const users = [];
      const unavailableUsers = [];
      entries.forEach((entry) => {
        const record = records.get(entry.id);
        if (record?.error) unavailableUsers.push({ ...entry, error: record.error });
        else if (record?.user) users.push(record.user);
      });
      setState((previous) => ({ users: preserveUserDomainIdentity(previous.users, users), unavailableUsers,
        error: directoryError,
        loading: !directoryError && (!directoryReady || users.length + unavailableUsers.length !== entries.length), hasMore: page.hasMore === true,
        nextCursor: page.cursor || null, pageSize }));
    };
    const compose = (entry, summary, previous) => preserveUserDomainIdentity(previous, Object.freeze({
      ...entry, displayName: entry.label, stats: summary.stats, settings: summary.settings,
    }));
    const subscribeRecord = (record) => {
      record.stop?.();
      // Keep failed rows unavailable during retry until a fresh summary arrives.
      const sequence = (record.sequence || 0) + 1;
      record.sequence = sequence;
      const isCurrent = () => active && records.get(record.entry.id) === record && record.sequence === sequence;
      record.stop = subscribeManagerSummary(record.entry.id, {
        next: (summary) => {
          if (!isCurrent()) return;
          record.error = null;
          record.summary = summary;
          record.user = compose(record.entry, summary, record.user);
          publish();
        },
        error: (error) => {
          if (!isCurrent()) return;
          record.error = error;
          publish();
        },
      });
    };
    const subscribeDirectory = () => {
      stopDirectory?.();
      directoryError = null;
      const sequence = ++directorySequence;
      stopDirectory = subscribeUserDirectoryPage({
        next: (nextPage) => {
          if (!active || sequence !== directorySequence) return;
          directoryError = null;
          directoryReady = true;
          page = nextPage;
          entries = nextPage.items || [];
          const ids = new Set(entries.map((entry) => entry.id));
          for (const [uid, record] of records) {
            if (!ids.has(uid)) { record.stop?.(); records.delete(uid); }
          }
          entries.forEach((entry) => {
            const existing = records.get(entry.id);
            if (existing) {
              existing.entry = entry;
              if (existing.summary) existing.user = compose(entry, existing.summary, existing.user);
            } else {
              const record = { entry, error: null };
              records.set(entry.id, record);
              subscribeRecord(record);
            }
          });
          publish();
        },
        error: (error) => {
          if (!active || sequence !== directorySequence) return;
          directoryError = error;
          publish();
        },
      }, { role: MANAGER_USER_DIRECTORY_ROLE, cursor, pageSize, search });
    };
    setState({ users: [], unavailableUsers: [], loading: Boolean(enabled), error: null, hasMore: false, nextCursor: null, pageSize });
    if (!enabled) return undefined;
    retryRef.current = () => {
      if (!active) return;
      if (directoryError) subscribeDirectory();
      records.forEach((record) => { if (record.error) subscribeRecord(record); });
      publish();
    };
    subscribeDirectory();
    return () => {
      active = false;
      retryRef.current = () => {};
      stopDirectory?.();
      records.forEach((record) => record.stop?.());
    };
  }, [cursor, enabled, pageSize, search, repositoryAccessGeneration]);
  return { ...state, retry };
};

// Each visible expanded card owns exactly four heavy-domain subscriptions.
// Summary revisions do not restart them; UID/access generation own the lifetime.
export const useManagerUserDetail = (summary, enabled) => {
  const { repositoryAccessGeneration = 0 } = useAuthSession();
  const uid = summary?.id;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const [state, setState] = useState({ uid: null, domains: {}, ready: false, error: null });
  useEffect(() => {
    if (!enabled || !uid) return undefined;
    let active = true;
    const domains = {};
    const received = new Set();
    const errors = new Map();
    const publish = () => setState({ uid, domains: { ...domains },
      ready: received.size === MANAGER_DETAIL_DOMAINS.length,
      error: MANAGER_DETAIL_DOMAINS.map((domain) => errors.get(domain)).find(Boolean) || null });
    setState({ uid, domains: {}, ready: false, error: null });
    const stops = MANAGER_DETAIL_DOMAINS.map((domain) => subscribeUserDomain(uid, domain, {
      next: (value) => {
        if (!active) return;
        domains[domain] = value;
        received.add(domain);
        errors.delete(domain);
        publish();
      },
      error: (error) => { if (active) { errors.set(domain, error); publish(); } },
    }));
    return () => { active = false; stops.forEach((stop) => stop()); };
  }, [uid, enabled, repositoryAccessGeneration, attempt]);
  return useMemo(() => {
    if (!enabled || state.uid !== uid) return { user: summary, loading: Boolean(enabled), error: null, retry };
    const composed = composeManagerUser(summary, state.domains);
    return { user: { ...summary, lingue: composed.lingue, conoscenze: composed.conoscenze,
      professioni: composed.professioni, inventory: composed.inventory, spells: composed.spells, tecniche: composed.tecniche },
    loading: !state.ready && !state.error, error: state.error, retry };
  }, [enabled, state, uid, summary, retry]);
};
