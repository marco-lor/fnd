import React, { useState } from 'react';
import { WeaponOverlay } from '../common/WeaponOverlay';

export function AddArmorOverlay({ onClose }) {
  const [armorData, setArmorData] = useState({
    Nome: '',
    Prezzo: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setArmorData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    // Pass the collected data back to the parent (adjust logic as needed)
    if (onClose) {
      onClose(armorData);
    }
  };

  return (
    <WeaponOverlay
      title="Aggiungi Armatura"
      onClose={onClose}
      onSave={handleSave}
      saveButtonText="Salva"
      cancelButtonText="Annulla"
    >
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          <label className="block text-white text-sm mb-1">Nome</label>
          <input
            type="text"
            name="Nome"
            value={armorData.Nome}
            onChange={handleChange}
            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-white text-sm mb-1">Prezzo</label>
          <input
            type="number"
            name="Prezzo"
            value={armorData.Prezzo}
            onChange={handleChange}
            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </form>
    </WeaponOverlay>
  );
}

export default AddArmorOverlay;
