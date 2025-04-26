import React from 'react';

const Extra = ({ userData }) => (
  <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] w-1/4 mb-5">
    <div className="grid grid-cols-1 divide-y divide-gray-700">
      {/* Lingue */}
      <div className="py-4">
        <h3 className="text-lg font-semibold text-white mb-1">Lingue</h3>
        {userData?.lingue ? (
          <ul className="list-disc list-inside text-gray-300">
            {Object.entries(userData.lingue).map(([name, descrizione]) => (
              <li key={name} className="mb-2">
                <span className="font-semibold">{name}</span>
                <p className="ml-4">{descrizione}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-400">Nessuna lingua.</p>}
      </div>
      {/* Conoscenze */}
      <div className="py-4">
        <h3 className="text-lg font-semibold text-white mb-1">Conoscenze</h3>
        {userData?.conoscenze ? (
          <ul className="list-disc list-inside text-gray-300">
            {Object.entries(userData.conoscenze).map(([name, { livello, descrizione }]) => (
              <li key={name} className="mb-2">
                <span className="font-semibold">{name} | {livello}</span>
                <p className="ml-4">{descrizione}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-400">Nessuna conoscenza.</p>}
      </div>
      {/* Professioni */}
      <div className="py-4">
        <h3 className="text-lg font-semibold text-white mb-1">Professioni</h3>
        {userData?.professioni ? (
          <ul className="list-disc list-inside text-gray-300">
            {Object.entries(userData.professioni).map(([name, { livello, descrizione }]) => (
              <li key={name} className="mb-2">
                <span className="font-semibold">{name} | {livello}</span>
                <p className="ml-4">{descrizione}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-400">Nessuna professione.</p>}
      </div>
    </div>
  </div>
);

export default Extra;
