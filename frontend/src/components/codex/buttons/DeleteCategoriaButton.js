import React from 'react';
import { FaTrash } from 'react-icons/fa';
export default function DeleteCategoriaButton({ categoryKey, onClick, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={`Elimina categoria ${categoryKey}`} aria-label={`Elimina categoria ${categoryKey}`} className="p-1 ml-2 text-red-400 hover:text-red-300 disabled:opacity-50"><FaTrash /></button>;
}
