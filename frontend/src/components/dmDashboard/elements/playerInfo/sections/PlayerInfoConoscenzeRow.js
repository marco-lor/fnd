import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoConoscenzeRow = ({
  users,
  iconEditClass,
  iconDeleteClass,
  onEditConoscenza,
  onDeleteConoscenza,
  variant = "table",
}) => {
  const renderList = (user) => {
    if (!user.conoscenze || !Object.keys(user.conoscenze).length) {
      return <span className="text-gray-400 italic text-sm">No conoscenze</span>;
    }
    return (
      <ul className="space-y-1">
        {Object.keys(user.conoscenze).map((name) => (
          <li key={name} className="flex justify-between items-center group">
            <span className="truncate mr-2">
              {name} ({user.conoscenze[name].livello})
            </span>
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
    );
  };

  if (variant === "card") {
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Conoscenze</div>
        {users.map((user) => (
          <div key={`${user.id}-co-card`} className="rounded-lg border border-slate-700/50 bg-slate-800/70 p-3">
            {renderList(user)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <tr className="bg-gray-800 hover:bg-gray-700">
      <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Conoscenze</td>
      {users.map((user) => (
        <td key={`${user.id}-co`} className="border border-gray-600 px-4 py-2">
          {renderList(user)}
        </td>
      ))}
    </tr>
  );
};

export default PlayerInfoConoscenzeRow;
