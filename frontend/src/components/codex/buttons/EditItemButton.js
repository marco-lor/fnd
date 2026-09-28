import React from 'react';
import { FaEdit } from 'react-icons/fa';
export default function EditItemButton({ itemKey, onClick, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={`Modifica ${itemKey}`} aria-label={`Modifica ${itemKey}`} className="p-1 text-blue-400 hover:text-blue-300 disabled:opacity-50"><FaEdit /></button>;
}
