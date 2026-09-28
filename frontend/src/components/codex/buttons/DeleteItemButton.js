import React from 'react';
import { FaTrash } from 'react-icons/fa';
export default function DeleteItemButton({ itemKey, onClick, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={`Elimina ${itemKey}`} aria-label={`Elimina ${itemKey}`} className="p-1 text-red-400 hover:text-red-300 disabled:opacity-50"><FaTrash /></button>;
}
