import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
// Path correction: this file is at components/dmDashboard/elements/playerInfo/sections -> need to go up 4 levels to reach components/firebaseConfig.js
import { db } from '../../../../firebaseConfig';

// Shows latest dice rolls (up to 20) for each user. Meant for DM view only.
// Each cell lists rolls newest first with small formatting.
const PlayerInfoDiceRollsRow = ({ users, variant = "table" }) => {
  const [rollsByUser, setRollsByUser] = useState({});

  useEffect(() => {
    if (!Array.isArray(users) || !users.length) return;

    const unsubs = users.map(u => {
      if (!u?.id) return null;
      const qRef = query(
        collection(db, 'users', u.id, 'diceRolls'),
        orderBy('createdAt', 'desc'),
        limit(20)
      );
      return onSnapshot(qRef, snap => {
        const data = [];
        snap.forEach(d => {
          const val = d.data();
          data.push({ id: d.id, ...val });
        });
        setRollsByUser(prev => ({ ...prev, [u.id]: data }));
      }, err => {
        console.warn('Dice rolls listener failed for user', u.id, err);
      });
    }).filter(Boolean);

    return () => {
      unsubs.forEach(un => { try { un && un(); } catch (_) {} });
    };
  }, [users]);

  const renderList = (user) => {
    const rolls = rollsByUser[user.id] || [];
    if (!rolls.length) return <span className="text-gray-500 italic">No rolls</span>;

    return (
      <ul className="space-y-1 overflow-y-auto pr-1 custom-scroll" style={{ maxHeight: '170px' }}>
        {rolls.map(r => {
          const meta = r.meta || {};
          const detail = Array.isArray(meta.rolls) ? meta.rolls.join(' + ') : '';
          return (
            <li key={r.id} className="flex flex-col rounded bg-gray-700/50 px-2 py-1">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-indigo-300">{r.total}</span>
                <span className="text-[10px] text-gray-400 tabular-nums">{r.createdAt?.toDate ? r.createdAt.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
              </div>
              <div className="text-[10px] text-gray-300 truncate" title={detail + (meta.modifier ? ` (mod ${meta.modifier})` : '')}>
                {meta.count || meta.faces ? `${meta.count}d${meta.faces}${meta.modifier ? (meta.modifier>0?`+${meta.modifier}`:meta.modifier) : ''}` : ''}
              </div>
              <div className="text-[10px] text-gray-400 truncate" title={meta.description || ''}>{meta.description || ''}</div>
            </li>
          );
        })}
      </ul>
    );
  };

  if (variant === "card") {
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dice Rolls</div>
        {users.map(user => (
          <div key={`${user.id}-dice-card`} className="rounded-lg border border-slate-700/50 bg-slate-800/70 p-3 text-xs">
            {renderList(user)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <tr className="bg-gray-800 hover:bg-gray-700 align-top">
      <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Dice Rolls</td>
      {users.map(user => (
        <td key={`${user.id}-dice`} className="border border-gray-600 px-4 py-2 text-xs">
          {renderList(user)}
        </td>
      ))}
    </tr>
  );
};

export default PlayerInfoDiceRollsRow;
