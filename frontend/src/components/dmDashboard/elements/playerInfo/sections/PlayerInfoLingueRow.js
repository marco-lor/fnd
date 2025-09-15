import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoLingueRow = ({ users, iconDeleteClass, onDeleteLingua }) => (
  <tr className="bg-gray-800 hover:bg-gray-700">
    <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Lingue</td>
    {users.map((user) => (
      <td key={`${user.id}-li`} className="border border-gray-600 px-4 py-2">
        {user.lingue && Object.keys(user.lingue).length ? (
          <ul className="space-y-1">
            {Object.keys(user.lingue).map((name) => (
              <li key={name} className="flex justify-between group">
                <span className="truncate mr-2">{name}</span>
                <button className={iconDeleteClass} onClick={() => onDeleteLingua(user.id, name)}>
                  <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-gray-400 italic text-sm">No lingue</span>
        )}
      </td>
    ))}
  </tr>
);

export default PlayerInfoLingueRow;
