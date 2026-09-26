import { db } from '../../components/firebaseConfig';
import { doc, labelFirestoreTarget, onSnapshot } from '../../performance/firestore';
import { subscribeShared } from '../repositoryRuntime';
import { preserveUserDomainIdentity } from './normalizers';

const STAT_FIELDS = ['level', 'basePointsAvailable', 'basePointsSpent', 'combatTokensAvailable',
  'combatTokensSpent', 'gold', 'hpCurrent', 'hpTotal', 'manaCurrent', 'manaTotal', 'essenzaCurrent', 'essenzaTotal'];
export const normalizeManagerSummary = (snapshot) => {
  const data = snapshot?.exists?.() ? snapshot.data() : null;
  if (!data) throw new Error('Player summary unavailable. Ask an administrator to run the Dashboard summary backfill.');
  if (data.schemaVersion !== 1 || Object.keys(data).some((key) => !['schemaVersion', 'stats', 'settings'].includes(key))
      || !data.stats || !data.settings || Object.keys(data.stats).length !== STAT_FIELDS.length
      || STAT_FIELDS.some((key) => !Number.isFinite(data.stats[key]))
      || Object.keys(data.settings).length !== 2
      || ['lock_param_base', 'lock_param_combat'].some((key) => typeof data.settings[key] !== 'boolean')) {
    throw new Error('Invalid Dashboard player summary. Ask an administrator to verify the summary backfill.');
  }
  return Object.freeze({ schemaVersion: 1, stats: Object.freeze({ ...data.stats }), settings: Object.freeze({ ...data.settings }) });
};

export const subscribeManagerSummary = (uid, observer) => {
  const metricKey = 'users.manager-summary.subscribe.v1';
  let previous;
  return subscribeShared({
    metricKey,
    instanceKey: `manager-summary:${uid}`,
    listen: ({ next, error }) => onSnapshot(labelFirestoreTarget(doc(db, 'manager_user_summaries', uid), metricKey), {
      next: (snapshot) => {
        try {
          previous = preserveUserDomainIdentity(previous, normalizeManagerSummary(snapshot));
          next({ summary: previous, error: null });
        } catch (caught) {
          // A projection may lag behind its directory trigger. Invalid/missing
          // data is a recoverable snapshot state, not a terminal SDK failure.
          // Cache it through next so every shared observer sees it and the
          // physical listener remains available for the corrected snapshot.
          next({ summary: null, error: caught });
        }
      }, error,
    }),
  }, {
    next: (state) => state.error ? observer.error?.(state.error) : observer.next?.(state.summary),
    error: observer.error,
  });
};
