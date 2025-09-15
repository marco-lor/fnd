import React from "react";
import { AddTecnicaButton } from "../../buttons/addTecnicaPersonale";
import { AddSpellButton } from "../../buttons/addSpell";
import AddLinguaPersonale from "../../buttons/addLinguaPersonale";
import AddConoscenzaPersonale from "../../buttons/addConoscenzaPersonale";
import AddProfessionePersonale from "../../buttons/addProfessionePersonale";

const PlayerInfoActionsRow = ({ users, onAddTecnica, onAddSpell, onAddLingua, onAddConoscenza, onAddProfessione, sleekBtnClass }) => (
  <tr className="bg-gray-800 hover:bg-gray-700">
    <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Actions</td>
    {users.map((user) => (
      <td key={`${user.id}-actions`} className="border border-gray-600 px-4 py-2 text-center">
        <div className="flex flex-col items-center space-y-1">
          <AddTecnicaButton onClick={() => onAddTecnica(user.id)} />
          <AddSpellButton onClick={() => onAddSpell(user.id)} />
          <AddLinguaPersonale className={sleekBtnClass} onClick={() => onAddLingua(user.id)} />
          <AddConoscenzaPersonale className={sleekBtnClass} onClick={() => onAddConoscenza(user.id)} />
          <AddProfessionePersonale className={sleekBtnClass} onClick={() => onAddProfessione(user.id)} />
        </div>
      </td>
    ))}
  </tr>
);

export default PlayerInfoActionsRow;
