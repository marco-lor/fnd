import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoSpellsRow = ({
  users,
  iconEditClass,
  iconDeleteClass,
  onEditSpell,
  onDeleteSpell,
  variant = "table",
}) => {
  const renderList = (user) => {
    if (!user.spells || !Object.keys(user.spells).length) {
      return <span className="text-gray-400 italic text-sm">No spells</span>;
    }

    return (
      <ul className="space-y-1">
        {Object.keys(user.spells)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => (
            <li key={name} className="flex justify-between items-center group">
              <span className="truncate mr-2">{name}</span>
              <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                <button className={iconEditClass} onClick={() => onEditSpell(user.id, name, user.spells[name])}>
                  <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                </button>
                <button className={iconDeleteClass} onClick={() => onDeleteSpell(user.id, name, user.spells[name])}>
                  <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
      </ul>
    );
  };

  if (variant === "card") {
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Spells</div>
        {users.map((user) => (
          <div key={`${user.id}-spells-card`} className="rounded-lg border border-slate-700/50 bg-slate-800/70 p-3">
            {renderList(user)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <tr className="bg-gray-800 hover:bg-gray-700">
      <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Spells</td>
      {users.map((user) => (
        <td key={`${user.id}-sp`} className="border border-gray-600 px-4 py-2">
          {renderList(user)}
        </td>
      ))}
    </tr>
  );
};

export default PlayerInfoSpellsRow;
