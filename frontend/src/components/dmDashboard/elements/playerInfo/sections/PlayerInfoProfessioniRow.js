import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoProfessioniRow = ({
  users,
  iconEditClass,
  iconDeleteClass,
  onEditProfessione,
  onDeleteProfessione,
  variant = "table",
}) => {
  const renderList = (user) => {
    if (!user.professioni || !Object.keys(user.professioni).length) {
      return <span className="text-gray-400 italic text-sm">No professioni</span>;
    }
    return (
      <ul className="space-y-1">
        {Object.keys(user.professioni).map((name) => (
          <li key={name} className="flex justify-between items-center group">
            <span className="truncate mr-2">
              {name} ({user.professioni[name].livello})
            </span>
            <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
              <button className={iconEditClass} onClick={() => onEditProfessione(user.id, name)}>
                <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
              </button>
              <button className={iconDeleteClass} onClick={() => onDeleteProfessione(user.id, name)}>
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
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Professioni</div>
        {users.map((user) => (
          <div key={`${user.id}-pr-card`} className="rounded-lg border border-slate-700/50 bg-slate-800/70 p-3">
            {renderList(user)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <tr className="bg-gray-800 hover:bg-gray-700">
      <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Professioni</td>
      {users.map((user) => (
        <td key={`${user.id}-pr`} className="border border-gray-600 px-4 py-2">
          {renderList(user)}
        </td>
      ))}
    </tr>
  );
};

export default PlayerInfoProfessioniRow;
