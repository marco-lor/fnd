import React from 'react';
import { WeaponOverlay } from '../../common/WeaponOverlay';

export function AddArmorOverlay({ onClose }) {
  return (
    <WeaponOverlay title="Aggiungi Armatura" onClose={onClose} onSave={() => onClose(true)} saveButtonText="Salva" cancelButtonText="Annulla">
      <div className="text-white">Funzionalità Armatura in arrivo!</div>
    </WeaponOverlay>
  );
}
