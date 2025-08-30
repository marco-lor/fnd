// Shared utilities for Foes Hub

export const deepClone = (obj) => JSON.parse(JSON.stringify(obj || {}));
export const sumSafe = (...vals) => vals.map((v) => Number(v || 0)).reduce((a, b) => a + b, 0);

export const computeParamTotals = (params) => {
  const out = deepClone(params);
  if (!out) return {};
  ['Base', 'Combattimento', 'Special'].forEach((group) => {
    const g = out[group] || {};
    Object.keys(g).forEach((k) => {
      const s = g[k] || {};
      // Ensure Tot is numeric; ignore sub-components
      s.Tot = Number(s.Tot || 0);
      out[group][k] = { Tot: s.Tot };
    });
  });
  return out;
};

export const Pill = ({ children, color = 'indigo' }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border bg-${color}-500/10 border-${color}-400/30 text-${color}-200`}>
    {children}
  </span>
);

export const SectionTitle = ({ children }) => (
  <div className="px-3 py-2 text-[11px] tracking-wide text-slate-300 border-b border-slate-700/50">
    {children}
  </div>
);
