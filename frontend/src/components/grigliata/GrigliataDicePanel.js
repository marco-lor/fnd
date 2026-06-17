import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { FaDiceD20 } from 'react-icons/fa';
import DiceRoller from '../common/DiceRoller';
import { getParamDisplayName } from '../common/paramMetadata';
import { db } from '../firebaseConfig';

const NORMAL_DICE_FACES = [4, 6, 8, 10, 12, 20, 100];
const MAX_NORMAL_DICE_COUNT = 20;
const DICE_ROLL_LOG_LIMIT = 20;

const clampDiceCount = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(MAX_NORMAL_DICE_COUNT, Math.max(1, parsed));
};

const parseDiceModifier = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveAnimaDieLabel = (dadiAnimaByLevel, level) => {
  if (!level) return '';
  if (Array.isArray(dadiAnimaByLevel)) {
    return typeof dadiAnimaByLevel[level] === 'string' ? dadiAnimaByLevel[level] : '';
  }

  if (dadiAnimaByLevel && typeof dadiAnimaByLevel === 'object') {
    const value = dadiAnimaByLevel[level] || dadiAnimaByLevel[String(level)];
    return typeof value === 'string' ? value : '';
  }

  return '';
};

const parseDiceFaces = (diceLabel) => {
  const match = /^d(\d+)$/i.exec(typeof diceLabel === 'string' ? diceLabel.trim() : '');
  if (!match) return 0;
  const faces = Number.parseInt(match[1], 10);
  return Number.isFinite(faces) && faces > 0 ? faces : 0;
};

const buildParameterRows = (params = {}) => (
  Object.entries(params || {})
    .map(([name, stat]) => ({
      name,
      displayName: getParamDisplayName(name),
      total: Number(stat?.Tot) || 0,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
);

const formatDiceFormula = (meta = {}) => {
  if (!meta.count || !meta.faces) return '';
  const modifier = Number(meta.modifier) || 0;
  return `${meta.count}d${meta.faces}${modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ''}`;
};

const formatSpacedModifier = (modifier) => {
  const value = Number(modifier) || 0;
  return `${value >= 0 ? '+' : '-'} ${Math.abs(value)}`;
};

const formatParameterFormula = (dieLabel, modifier) => (
  `${dieLabel || 'd?'} ${formatSpacedModifier(modifier)}`
);

const formatRollTime = (createdAt) => (
  createdAt?.toDate
    ? createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
);

function DiceRollEntries({ rolls, emptyText = 'No rolls', maxHeightClass = 'max-h-64' }) {
  if (!rolls.length) {
    return (
      <p className="text-xs italic text-slate-500">{emptyText}</p>
    );
  }

  return (
    <ul className={`${maxHeightClass} space-y-1.5 overflow-y-auto pr-1 custom-scroll`}>
      {rolls.map((roll) => {
        const meta = roll.meta || {};
        const formula = formatDiceFormula(meta);

        return (
          <li key={roll.id} className="rounded-xl bg-slate-900/80 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-amber-300">{roll.total}</span>
              <span className="text-[10px] tabular-nums text-slate-500">{formatRollTime(roll.createdAt)}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] font-mono text-indigo-300" title={formula}>
              {formula}
            </div>
            <div className="truncate text-[11px] text-slate-400" title={meta.description || ''}>
              {meta.description || ''}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DiceRollLogList({ users, rollsByUser, errorsByUser }) {
  if (!users.length) {
    return (
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3 text-xs text-slate-500">
        No users available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {users.map((rollUser) => {
        const rolls = rollsByUser[rollUser.id] || [];
        const label = rollUser.characterId || rollUser.email || rollUser.id;
        const loadError = errorsByUser[rollUser.id];

        return (
          <div key={rollUser.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-100" title={label}>{label}</p>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {rolls.length}
              </span>
            </div>
            {loadError && (
              <p className="text-xs italic text-amber-300">Dice rolls unavailable</p>
            )}
            {!loadError && <DiceRollEntries rolls={rolls} maxHeightClass="max-h-44" />}
          </div>
        );
      })}
    </div>
  );
}

export default function GrigliataDicePanel({ currentUserId, userData, isManager }) {
  const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
  const [normalDiceCount, setNormalDiceCount] = useState(1);
  const [normalDiceModifier, setNormalDiceModifier] = useState(0);
  const [roller, setRoller] = useState(null);
  const [currentUserRolls, setCurrentUserRolls] = useState([]);
  const [currentUserRollsError, setCurrentUserRollsError] = useState(null);
  const [users, setUsers] = useState([]);
  const [rollsByUser, setRollsByUser] = useState({});
  const [errorsByUser, setErrorsByUser] = useState({});

  useEffect(() => {
    let isActive = true;

    getDoc(doc(db, 'utils', 'varie'))
      .then((snapshot) => {
        if (!isActive || !snapshot.exists()) return;
        setDadiAnimaByLevel(snapshot.data().dadiAnimaByLevel || []);
      })
      .catch((error) => {
        console.warn('Failed to load Grigliata dice metadata:', error);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      setCurrentUserRolls([]);
      setCurrentUserRollsError(null);
      return undefined;
    }

    const rollsQuery = query(
      collection(db, 'users', currentUserId, 'diceRolls'),
      orderBy('createdAt', 'desc'),
      limit(DICE_ROLL_LOG_LIMIT)
    );

    return onSnapshot(rollsQuery, (snapshot) => {
      const nextRolls = snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data(),
      }));
      setCurrentUserRolls(nextRolls);
      setCurrentUserRollsError(null);
    }, (error) => {
      console.warn('Failed to load current Grigliata dice rolls:', error);
      setCurrentUserRolls([]);
      setCurrentUserRollsError(error);
    });
  }, [currentUserId]);

  useEffect(() => {
    if (!isManager) {
      setUsers([]);
      return undefined;
    }

    return onSnapshot(collection(db, 'users'), (snapshot) => {
      const nextUsers = snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .sort((left, right) => (
          (left.characterId || left.email || left.id).localeCompare(right.characterId || right.email || right.id)
        ));
      setUsers(nextUsers);
    }, (error) => {
      console.warn('Failed to load users for Grigliata dice logs:', error);
      setUsers([]);
    });
  }, [isManager]);

  const userIdsKey = users.map((rollUser) => rollUser.id).join('|');

  useEffect(() => {
    if (!isManager || !users.length) {
      setRollsByUser({});
      setErrorsByUser({});
      return undefined;
    }

    const allowedUserIds = new Set(users.map((rollUser) => rollUser.id));
    setRollsByUser((currentRolls) => {
      const nextRolls = {};
      allowedUserIds.forEach((userId) => {
        if (currentRolls[userId]) nextRolls[userId] = currentRolls[userId];
      });
      return nextRolls;
    });
    setErrorsByUser((currentErrors) => {
      const nextErrors = {};
      allowedUserIds.forEach((userId) => {
        if (currentErrors[userId]) nextErrors[userId] = currentErrors[userId];
      });
      return nextErrors;
    });

    const unsubscribes = users.map((rollUser) => {
      const rollsQuery = query(
        collection(db, 'users', rollUser.id, 'diceRolls'),
        orderBy('createdAt', 'desc'),
        limit(DICE_ROLL_LOG_LIMIT)
      );

      return onSnapshot(rollsQuery, (snapshot) => {
        const nextRolls = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        setRollsByUser((currentRolls) => ({ ...currentRolls, [rollUser.id]: nextRolls }));
        setErrorsByUser((currentErrors) => {
          if (!currentErrors[rollUser.id]) return currentErrors;
          const nextErrors = { ...currentErrors };
          delete nextErrors[rollUser.id];
          return nextErrors;
        });
      }, (error) => {
        console.warn('Failed to load Grigliata dice rolls for user:', rollUser.id, error);
        setErrorsByUser((currentErrors) => ({ ...currentErrors, [rollUser.id]: error }));
      });
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe();
      });
    };
  }, [isManager, userIdsKey, users]);

  const currentLevel = Number(userData?.stats?.level) || 0;
  const animaDieLabel = resolveAnimaDieLabel(dadiAnimaByLevel, currentLevel);
  const animaFaces = parseDiceFaces(animaDieLabel);
  const baseRows = useMemo(
    () => buildParameterRows(userData?.Parametri?.Base),
    [userData?.Parametri?.Base]
  );
  const combatRows = useMemo(
    () => buildParameterRows(userData?.Parametri?.Combattimento),
    [userData?.Parametri?.Combattimento]
  );

  const handleRollParameter = (row) => {
    if (!animaFaces) return;
    setRoller({
      faces: animaFaces,
      count: 1,
      modifier: row.total,
      description: `${row.displayName} (${formatParameterFormula(animaDieLabel, row.total)})`,
    });
  };

  const handleRollNormalDice = (faces) => {
    const count = clampDiceCount(normalDiceCount);
    const modifier = parseDiceModifier(normalDiceModifier);
    setNormalDiceCount(count);
    setNormalDiceModifier(modifier);
    setRoller({
      faces,
      count,
      modifier,
      description: `Normal dice (${formatDiceFormula({ count, faces, modifier })})`,
    });
  };

  const renderParameterGroup = (title, rows) => (
    <section className="rounded-xl border border-slate-700 bg-slate-950/75 p-2.5 shadow-2xl backdrop-blur-sm">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-300">{title}</h3>
        <span className="rounded-full border border-indigo-300/30 bg-indigo-400/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200">
          {animaDieLabel || 'No die'}
        </span>
      </div>
      {!rows.length ? (
        <p className="text-xs italic text-slate-500">No parameters available.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {rows.map((row) => (
            <button
              key={row.name}
              type="button"
              onClick={() => handleRollParameter(row)}
              disabled={!animaFaces}
              aria-label={`Roll ${row.displayName}`}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-2 text-left transition-colors hover:border-indigo-300/50 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-slate-100">{row.displayName}</span>
                <span className="block truncate text-[10px] font-mono text-slate-500">{formatParameterFormula(animaDieLabel, row.total)}</span>
              </span>
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-200 ring-1 ring-inset ring-indigo-400/25">
                <FaDiceD20 className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0">
      <section className="rounded-2xl border border-slate-700 bg-slate-950/75 p-3 shadow-2xl backdrop-blur-sm xl:shrink-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Dice</h2>
            <p className="mt-1 text-xs text-slate-500">
              {currentUserId ? `Roller for ${userData?.characterId || currentUserId}` : 'Roller'}
            </p>
          </div>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-black shadow-lg">
            <FaDiceD20 className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="grigliata-normal-dice-count" className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Dice count
            </label>
            <input
              id="grigliata-normal-dice-count"
              type="number"
              min="1"
              max={MAX_NORMAL_DICE_COUNT}
              value={normalDiceCount}
              onChange={(event) => setNormalDiceCount(clampDiceCount(event.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors focus:border-amber-300"
            />
          </div>
          <div>
            <label htmlFor="grigliata-normal-dice-modifier" className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Dice modifier
            </label>
            <input
              id="grigliata-normal-dice-modifier"
              type="number"
              value={normalDiceModifier}
              onChange={(event) => setNormalDiceModifier(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors focus:border-amber-300"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {NORMAL_DICE_FACES.map((faces) => (
            <button
              key={faces}
              type="button"
              aria-label={`Roll d${faces}`}
              onClick={() => handleRollNormalDice(faces)}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-amber-300/60 hover:bg-slate-800"
            >
              <FaDiceD20 className="h-3.5 w-3.5" aria-hidden="true" />
              d{faces}
            </button>
          ))}
        </div>
      </section>

      <div data-testid="grigliata-dice-parameter-grid" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:shrink-0">
        {renderParameterGroup('Base', baseRows)}
        {renderParameterGroup('Combat', combatRows)}
      </div>

      <section data-testid="grigliata-current-dice-history" className="flex flex-col rounded-2xl border border-slate-700 bg-slate-950/75 p-3 shadow-2xl backdrop-blur-sm xl:flex-1 xl:min-h-0">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Roll History</h3>
          <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
            {currentUserRolls.length}
          </span>
        </div>
        {currentUserRollsError ? (
          <p className="text-xs italic text-amber-300">Roll history unavailable</p>
        ) : (
          <DiceRollEntries
            rolls={currentUserRolls}
            emptyText="No rolls yet."
            maxHeightClass="max-h-64 xl:max-h-none xl:flex-1 xl:min-h-0"
          />
        )}
      </section>

      {isManager && (
        <section className="flex flex-col rounded-2xl border border-slate-700 bg-slate-950/75 p-3 shadow-2xl backdrop-blur-sm xl:flex-1 xl:min-h-0">
          <h3 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Dice Roll Logs</h3>
          <div className="xl:flex-1 xl:min-h-0 xl:overflow-y-auto custom-scroll">
            <DiceRollLogList users={users} rollsByUser={rollsByUser} errorsByUser={errorsByUser} />
          </div>
        </section>
      )}

      {roller && (
        <DiceRoller
          faces={roller.faces}
          count={roller.count}
          modifier={roller.modifier}
          description={roller.description}
          onComplete={() => setRoller(null)}
        />
      )}
    </div>
  );
}
