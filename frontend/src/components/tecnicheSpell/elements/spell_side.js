import React from "react";

const SpellSide = ({ personalSpells = {}, commonSpells = {} }) => {
  return (
    <div className="md:w-3/5 bg-[rgba(40,40,60,0.8)] p-5 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
      <h1 className="text-2xl text-white font-bold mb-4">Spellbook</h1>
      <div className="h-full flex justify-center items-center">
        <p className="text-gray-400">Il contenuto del tuo grimorio apparirà qui.</p>
      </div>
    </div>
  );
};

export default SpellSide;
