import React from 'react';
import { FaPlus } from 'react-icons/fa';
export default function AggiungiButton({ categoryDisplayNameSingular, onClick, disabled }) {
  const name = categoryDisplayNameSingular || 'Elemento';
  return <button type="button" onClick={onClick} disabled={disabled} className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded flex items-center disabled:opacity-50"><FaPlus className="mr-2" />{name.toLowerCase().endsWith('a') ? 'Nuova' : 'Nuovo'} {name}</button>;
}
