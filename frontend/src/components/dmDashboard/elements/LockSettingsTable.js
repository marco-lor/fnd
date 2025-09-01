// frontend/src/components/dmDashboard/elements/LockSettingsTable.js
import React, { useEffect, useState } from 'react';
import { db } from '../../firebaseConfig';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLock, faLockOpen } from '@fortawesome/free-solid-svg-icons';

// Displays and manages per-user and bulk lock toggles for base and combat parameters.
// Only this table re-renders when toggling, keeping the rest of the dashboard stable.
const LockSettingsTable = React.memo(function LockSettingsTable({ users, canEdit }) {
  const [lockMap, setLockMap] = useState(() => {
    const map = {};
    users.forEach((u) => {
      map[u.id] = {
        base: !!(u.settings && u.settings.lock_param_base),
        combat: !!(u.settings && u.settings.lock_param_combat),
      };
    });
    return map;
  });
  const [busyAll, setBusyAll] = useState(false);
  const [pending, setPending] = useState(() => new Set());

  // Sync with parent-provided users in case data refreshes externally
  useEffect(() => {
    const next = {};
    users.forEach((u) => {
      next[u.id] = {
        base: !!(u.settings && u.settings.lock_param_base),
        combat: !!(u.settings && u.settings.lock_param_combat),
      };
    });
    setLockMap(next);
  }, [users]);

  const toggleOne = async (userId, fieldKey) => {
    if (!canEdit) return;
    const field = fieldKey === 'base' ? 'lock_param_base' : 'lock_param_combat';
    const cur = !!lockMap?.[userId]?.[fieldKey];
    try {
      setPending((s) => new Set([...s, userId]));
      const ref = doc(db, 'users', userId);
      await updateDoc(ref, { [`settings.${field}`]: !cur });
      setLockMap((m) => ({
        ...m,
        [userId]: { ...(m[userId] || {}), [fieldKey]: !cur },
      }));
    } catch (e) {
      console.error('Toggle lock failed', e);
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(userId);
        return n;
      });
    }
  };

  const toggleAll = async (fieldKey) => {
    if (!canEdit || !users.length) return;
    const allLocked = users.every((u) => !!lockMap?.[u.id]?.[fieldKey]);
    const target = !allLocked;
    try {
      setBusyAll(true);
      const batch = writeBatch(db);
      users.forEach((u) => {
        const cur = !!lockMap?.[u.id]?.[fieldKey];
        if (cur !== target) {
          const ref = doc(db, 'users', u.id);
          const field = fieldKey === 'base' ? 'lock_param_base' : 'lock_param_combat';
          batch.update(ref, { [`settings.${field}`]: target });
        }
      });
      await batch.commit();
      setLockMap((m) => {
        const next = { ...m };
        users.forEach((u) => {
          next[u.id] = { ...(next[u.id] || {}), [fieldKey]: target };
        });
        return next;
      });
    } catch (e) {
      console.error('Bulk toggle failed', e);
    } finally {
      setBusyAll(false);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700/60 shadow-sm">
      <table className="min-w-max border-collapse text-white bg-gray-800 text-sm">
        <thead className="bg-gray-700/80 backdrop-blur supports-[backdrop-filter]:bg-gray-700/70">
          <tr className="text-slate-100">
            <th className="sticky left-0 z-20 border border-gray-600 px-4 py-2 text-left bg-gray-700/80">Setting</th>
            {users.map((user) => {
              const bAvail = Number(user?.stats?.basePointsAvailable) || 0;
              const bSpent = Number(user?.stats?.basePointsSpent) || 0;
              const bTot = bAvail + bSpent;
              const cAvail = Number(user?.stats?.combatTokensAvailable) || 0;
              const cSpent = Number(user?.stats?.combatTokensSpent) || 0;
              const cTot = cAvail + cSpent;
              return (
                <th key={user.id} className="border border-gray-600 px-3 py-2 align-top">
                  <div className="flex flex-col items-center gap-1 min-w-[12.5rem]">
                    <div className="text-sm font-medium">
                      {user.characterId || user.email || 'Unknown User'}
                    </div>
                    <div className="text-xs text-gray-300">Lv {user?.stats?.level || 1}</div>
                    <div className="mt-1 flex items-center gap-1 text-[11px]">
                      <span className="text-slate-400/80">Base</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30" title="Base points available">A {bAvail}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/10 px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10" title="Base points spent">S {bSpent}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-200 ring-1 ring-inset ring-white/10" title="Base points total">T {bTot}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-slate-400/80">Combat</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-400/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30" title="Combat tokens available">A {cAvail}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/10 px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10" title="Combat tokens spent">S {cSpent}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-200 ring-1 ring-inset ring-white/10" title="Combat tokens total">T {cTot}</span>
                    </div>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">
              <div className="flex items-center justify-between gap-2">
                <span>Lock Parametri Base</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAll('base'); }}
                  disabled={!canEdit || busyAll || users.length === 0}
                  className={`ml-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs border ${
                    users.every((u) => !!lockMap?.[u.id]?.base)
                      ? 'border-amber-600 text-amber-300 hover:bg-amber-600/10'
                      : 'border-emerald-600 text-emerald-300 hover:bg-emerald-600/10'
                  }`}
                  title={users.every((u) => !!lockMap?.[u.id]?.base) ? 'Unlock all base parameters' : 'Lock all base parameters'}
                >
                  <FontAwesomeIcon icon={users.every((u) => !!lockMap?.[u.id]?.base) ? faLock : faLockOpen} />
                  <span className="hidden sm:inline">{users.every((u) => !!lockMap?.[u.id]?.base) ? 'Unlock all' : 'Lock all'}</span>
                </button>
              </div>
            </td>
            {users.map((user) => (
              <td key={`${user.id}-base`} className="border border-gray-600 px-4 py-2 text-center">
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleOne(user.id, 'base'); }}
                  disabled={!canEdit || pending.has(user.id)}
                  className="focus:outline-none"
                >
                  <FontAwesomeIcon
                    icon={lockMap?.[user.id]?.base ? faLock : faLockOpen}
                    className={lockMap?.[user.id]?.base ? 'text-red-500' : 'text-green-500'}
                  />
                </button>
              </td>
            ))}
          </tr>
          <tr>
            <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">
              <div className="flex items-center justify-between gap-2">
                <span>Lock Parametri Combattimento</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAll('combat'); }}
                  disabled={!canEdit || busyAll || users.length === 0}
                  className={`ml-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs border ${
                    users.every((u) => !!lockMap?.[u.id]?.combat)
                      ? 'border-amber-600 text-amber-300 hover:bg-amber-600/10'
                      : 'border-emerald-600 text-emerald-300 hover:bg-emerald-600/10'
                  }`}
                  title={users.every((u) => !!lockMap?.[u.id]?.combat) ? 'Unlock all combat parameters' : 'Lock all combat parameters'}
                >
                  <FontAwesomeIcon icon={users.every((u) => !!lockMap?.[u.id]?.combat) ? faLock : faLockOpen} />
                  <span className="hidden sm:inline">{users.every((u) => !!lockMap?.[u.id]?.combat) ? 'Unlock all' : 'Lock all'}</span>
                </button>
              </div>
            </td>
            {users.map((user) => (
              <td key={`${user.id}-combat`} className="border border-gray-600 px-4 py-2 text-center">
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleOne(user.id, 'combat'); }}
                  disabled={!canEdit || pending.has(user.id)}
                  className="focus:outline-none"
                >
                  <FontAwesomeIcon
                    icon={lockMap?.[user.id]?.combat ? faLock : faLockOpen}
                    className={lockMap?.[user.id]?.combat ? 'text-red-500' : 'text-green-500'}
                  />
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
});

export default LockSettingsTable;
