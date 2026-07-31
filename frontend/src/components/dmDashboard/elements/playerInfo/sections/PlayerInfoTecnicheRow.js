import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const PlayerInfoTecnicheRow = ({
  users,
  iconEditClass,
  iconDeleteClass,
  onEditTecnica,
  onDeleteTecnica,
  variant = "table",
}) => {
  if (variant === "card") {
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tecniche</div>
        {users.map((user) => (
          <div key={`${user.id}-tec-card`} className="rounded-lg border border-slate-700/50 bg-slate-800/70 p-3">
            {user.tecniche && Object.keys(user.tecniche).length ? (
              <ul className="space-y-1">
                {Object.keys(user.tecniche).map((name) => (
                  <li key={name} className="flex justify-between items-center group">
                    <span className="truncate mr-2">{name}</span>
                    <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                      <button className={iconEditClass} onClick={() => onEditTecnica(user.id, name, user.tecniche[name])}>
                        <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                      </button>
                      <button className={iconDeleteClass} onClick={() => onDeleteTecnica(user.id, name, user.tecniche[name])}>
                        <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-gray-400 italic text-sm">No tecniche</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <tr className="bg-gray-800 hover:bg-gray-700">
      <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Tecniche</td>
      {users.map((user) => (
        <td key={`${user.id}-tec`} className="border border-gray-600 px-4 py-2">
          {user.tecniche && Object.keys(user.tecniche).length ? (
            <ul className="space-y-1">
              {Object.keys(user.tecniche).map((name) => (
                <li key={name} className="flex justify-between items-center group">
                  <span className="truncate mr-2">{name}</span>
                  <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                    <button className={iconEditClass} onClick={() => onEditTecnica(user.id, name, user.tecniche[name])}>
                      <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                    </button>
                    <button className={iconDeleteClass} onClick={() => onDeleteTecnica(user.id, name, user.tecniche[name])}>
                      <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-gray-400 italic text-sm">No tecniche</span>
          )}
        </td>
      ))}
    </tr>
  );
};

export default PlayerInfoTecnicheRow;
