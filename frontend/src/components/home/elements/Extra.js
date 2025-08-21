import React, { memo, useMemo } from 'react';
import { FiGlobe, FiBookOpen, FiBriefcase } from 'react-icons/fi';

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

// Small section wrapper to keep a consistent look across blocks
const Section = ({ icon: Icon, title, children }) => (
  <section className="py-4">
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600/20 to-fuchsia-600/20 text-indigo-300 border border-slate-700/60 shadow-inner">
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="text-sm uppercase tracking-wider text-slate-300">{title}</h3>
    </div>
    {children}
  </section>
);

const Badge = ({ children, color = 'emerald' }) => {
  const colorStyles = {
    emerald: 'text-emerald-300/90 border-emerald-500/30 bg-emerald-400/10',
    amber: 'text-amber-300/90 border-amber-500/30 bg-amber-400/10',
    slate: 'text-slate-300/90 border-slate-500/30 bg-slate-400/10',
  };
  const picked = colorStyles[color] || colorStyles.slate;
  return (
    <span className={`ml-2 inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${picked}`}>{children}</span>
  );
};

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
    <div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 p-5 rounded-2xl shadow-[0_4px_22px_-4px_rgba(0,0,0,0.6)]">
      {/* soft glow accents */}
      <div className="absolute -left-10 -top-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl" />
      <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-fuchsia-500/10 rounded-full blur-3xl" />

  <div className="relative grid grid-cols-1 divide-y divide-slate-700/60">
        {/* Lingue */}
        <Section icon={FiGlobe} title="Lingue">
          {sortedLingue.length ? (
            <ul className="space-y-2 text-slate-300">
              {sortedLingue.map(([name, descrizione]) => (
                <li key={name} className="group flex flex-col rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center">
                    <span className="mr-3 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gradient-to-br from-indigo-400 to-violet-400 shadow shadow-indigo-900/30" />
                    <span className="font-medium text-slate-200">{name}</span>
                  </div>
                  {descrizione && (
                    <p className="mt-1 pl-6 text-sm leading-snug text-slate-400">{descrizione}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">Nessuna lingua.</p>
          )}
        </Section>

        {/* Conoscenze */}
        <Section icon={FiBookOpen} title="Conoscenze">
          {sortedConoscenze.length ? (
            <ul className="space-y-2 text-slate-300">
              {sortedConoscenze.map(([name, { livello, descrizione }]) => (
                <li key={name} className="group flex flex-col rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center flex-wrap">
                    <span className="mr-3 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gradient-to-br from-emerald-400 to-teal-400 shadow shadow-emerald-900/30" />
                    <span className="font-medium text-slate-200">{name}</span>
                    {livello ? <Badge color="emerald">{livello}</Badge> : null}
                  </div>
                  {descrizione && (
                    <p className="mt-1 pl-6 text-sm leading-snug text-slate-400">{descrizione}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">Nessuna conoscenza.</p>
          )}
        </Section>

        {/* Professioni */}
        <Section icon={FiBriefcase} title="Professioni">
          {sortedProfessioni.length ? (
            <ul className="space-y-2 text-slate-300">
              {sortedProfessioni.map(([name, { livello, descrizione }]) => (
                <li key={name} className="group flex flex-col rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center flex-wrap">
                    <span className="mr-3 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gradient-to-br from-amber-400 to-orange-400 shadow shadow-amber-900/30" />
                    <span className="font-medium text-slate-200">{name}</span>
                    {livello ? <Badge color="amber">{livello}</Badge> : null}
                  </div>
                  {descrizione && (
                    <p className="mt-1 pl-6 text-sm leading-snug text-slate-400">{descrizione}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">Nessuna professione.</p>
          )}
        </Section>
      </div>

  {/* Bottom fade to soften overflow and allow future extension */}
  <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-16 bg-gradient-to-t from-slate-900/90 via-slate-900/50 to-transparent" />
    </div>
  );
};

const Extra = memo(ExtraComponent, propsAreEqual);
export default Extra;
