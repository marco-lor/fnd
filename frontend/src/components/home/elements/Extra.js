import React, { memo, useMemo } from 'react';

// Shallow + nested (for livello/descrizione objects) equality check
const areSubObjectsEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    const va = a[k];
    const vb = b[k];
    // Value can be string OR { livello, descrizione }
    if (typeof va === 'object' && va !== null) {
      if (typeof vb !== 'object' || vb === null) return false;
      if (va.livello !== vb.livello || va.descrizione !== vb.descrizione) return false;
    } else if (va !== vb) return false;
  }
  return true;
};

// Custom props compare for memo
const propsAreEqual = (prev, next) => (
  areSubObjectsEqual(prev.lingue, next.lingue) &&
  areSubObjectsEqual(prev.conoscenze, next.conoscenze) &&
  areSubObjectsEqual(prev.professioni, next.professioni)
);

const ExtraComponent = ({ lingue, conoscenze, professioni }) => {
  const sortedLingue = useMemo(() => (
    lingue ? Object.entries(lingue).sort(([a],[b]) => a.localeCompare(b,'it',{sensitivity:'base'})) : []
  ), [lingue]);
  const sortedConoscenze = useMemo(() => (
    conoscenze ? Object.entries(conoscenze).sort(([a],[b]) => a.localeCompare(b,'it',{sensitivity:'base'})) : []
  ), [conoscenze]);
  const sortedProfessioni = useMemo(() => (
    professioni ? Object.entries(professioni).sort(([a],[b]) => a.localeCompare(b,'it',{sensitivity:'base'})) : []
  ), [professioni]);

  return (
    <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] w-1/4 mb-5">
      <div className="grid grid-cols-1 divide-y divide-gray-700">
        {/* Lingue */}
        <div className="py-4">
          <h3 className="text-lg font-semibold text-white mb-1">Lingue</h3>
          {sortedLingue.length ? (
            <ul className="list-disc list-inside text-gray-300">
              {sortedLingue.map(([name, descrizione]) => (
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
          {sortedConoscenze.length ? (
            <ul className="list-disc list-inside text-gray-300">
              {sortedConoscenze.map(([name, { livello, descrizione }]) => (
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
          {sortedProfessioni.length ? (
            <ul className="list-disc list-inside text-gray-300">
              {sortedProfessioni.map(([name, { livello, descrizione }]) => (
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
};

const Extra = memo(ExtraComponent, propsAreEqual);
export default Extra;
