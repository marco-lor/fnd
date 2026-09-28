import React from 'react';
import { FaPlus } from 'react-icons/fa';
export default function AggiungiCategoriaButton({ onClick, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded mb-4 flex items-center justify-center disabled:opacity-50"><FaPlus className="mr-2" />Nuova Categoria</button>;
}
