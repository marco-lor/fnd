import React, { useState } from 'react';
import { WeaponOverlay } from '../../common/WeaponOverlay';

export function AddArmaturaOverlay({ onClose }) {
  const [formData, setFormData] = useState({ Nome: '', prezzo: '' });

  const handleChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = () => {
    // No actual save logic yet
    onClose(true);
  };

  return (
    <WeaponOverlay
      title="Aggiungi Armatura"
      onClose={onClose}
      onSave={handleSave}
      saveButtonText="Salva Armatura"
    >
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          <label className="block text-white mb-1">Nome:</label>
          <input
            type="text"
            value={formData.Nome}
            onChange={handleChange('Nome')}
            className="w-full p-2 rounded bg-gray-700 text-white"
          />
        </div>
        <div>
          <label className="block text-white mb-1">Prezzo:</label>
          <input
            type="number"
            value={formData.prezzo}
            onChange={handleChange('prezzo')}
            className="w-full p-2 rounded bg-gray-700 text-white"
          />
        </div>
      </form>
    </WeaponOverlay>
  );
}
