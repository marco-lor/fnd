import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoConoscenzeRow = ({ users, iconEditClass, iconDeleteClass, onEditConoscenza, onDeleteConoscenza }) => (
  <tr className="bg-gray-800 hover:bg-gray-700">
    <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Conoscenze</td>
    {users.map((user) => (
      <td key={`${user.id}-co`} className="border border-gray-600 px-4 py-2">
        {user.conoscenze && Object.keys(user.conoscenze).length ? (
          <ul className="space-y-1">
            {Object.keys(user.conoscenze).map((name) => (
              <li key={name} className="flex justify-between items-center group">
                <span className="truncate mr-2">{name} ({user.conoscenze[name].livello})</span>
                <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                  <button className={iconEditClass} onClick={() => onEditConoscenza(user.id, name)}>
                    <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                  </button>
                  <button className={iconDeleteClass} onClick={() => onDeleteConoscenza(user.id, name)}>
                    <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-gray-400 italic text-sm">No conoscenze</span>
        )}
      </td>
    ))}
  </tr>
);

export default PlayerInfoConoscenzeRow;
