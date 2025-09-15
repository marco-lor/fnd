import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoSpellsRow = ({ users, iconEditClass, iconDeleteClass, onEditSpell, onDeleteSpell }) => (
  <tr className="bg-gray-800 hover:bg-gray-700">
    <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Spells</td>
    {users.map((user) => (
      <td key={`${user.id}-sp`} className="border border-gray-600 px-4 py-2">
        {user.spells && Object.keys(user.spells).length ? (
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
        ) : (
          <span className="text-gray-400 italic text-sm">No spells</span>
        )}
      </td>
    ))}
  </tr>
);

export default PlayerInfoSpellsRow;
