import React, { useMemo, useCallback } from 'react';

// Lightweight, dependency-free Radar chart using SVG
// Props:
// - title: string
// - labels: string[]
// - values: number[] (same length as labels)
// - color: token name to pick RGB from (e.g., 'sky', 'fuchsia')
// - size: number (px) for square chart, default 260
// - maxValue: optional max value for radius scale (auto from values if omitted)

const COLOR_RGB = {
  sky: '56, 189, 248', // sky-400
  fuchsia: '232, 121, 249', // fuchsia-400
  emerald: '52, 211, 153', // emerald-400
  indigo: '129, 140, 248', // indigo-400
  amber: '251, 191, 36', // amber-400
  rose: '251, 113, 133', // rose-400
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export default function RadarChart({ title, labels = [], values = [], color = 'sky', size = 300, maxValue }) {
  const LABEL_MAP = {
    Costituzione: 'Costituzione',
    Destrezza: 'Destrezza',
    Fortuna: 'Fortuna',
    Forza: 'Forza',
    Intelligenza: 'Intelligenza',
    Saggezza: 'Saggezza',
    Attacco: 'Attacco',
    Critico: 'Critico',
    Difesa: 'Difesa',
    Disciplina: 'Disciplina',
    Mira: 'Mira',
  RiduzioneDanni: 'Rid. Danni',
    Salute: 'Salute',
  };
  const pretty = (name) => LABEL_MAP[name] || name;
  const data = useMemo(() => {
    const vals = (values || []).map((v) => Number(v || 0));
    const max = Math.max(1, Number(maxValue || Math.max(1, ...vals)));
    const points = [];
    const n = Math.max(labels.length, vals.length);
    for (let i = 0; i < n; i++) {
      const pct = clamp(vals[i] / max, 0, 1);
      points.push(pct);
    }
    return { points, max };
  }, [labels, values, maxValue]);

  const rgb = COLOR_RGB[color] || COLOR_RGB.sky;
  const stroke = `rgb(${rgb})`;
  const fill = `rgba(${rgb}, 0.15)`;
  const textColor = 'rgb(203, 213, 225)'; // slate-300
  const gridColor = 'rgba(148, 163, 184, 0.35)'; // slate-400/35
  const axisColor = 'rgba(148, 163, 184, 0.45)'; // slate-400/45

  const w = size;
  const h = size;
  const cx = w / 2;
  const cy = h / 2;
  const padding = 48; // leave a bit more room for labels
  const r = Math.min(cx, cy) - padding;
  const ringCount = 4; // grid rings

  const polarToXY = useCallback((pct, i, n) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2; // start at top
    const radius = r * pct;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }, [r, cx, cy]);

  const polygonPath = useMemo(() => {
    const n = Math.max(labels.length, data.points.length) || 1;
    const pts = data.points.map((p, i) => polarToXY(p, i, n));
    return pts.length
      ? `M ${pts.map((p) => p.join(',')).join(' L ')} Z`
      : '';
  }, [labels.length, data.points, polarToXY]);

  const axes = useMemo(() => {
    const n = labels.length || data.points.length;
    return new Array(n).fill(0).map((_, i) => {
      const [x, y] = polarToXY(1, i, n);
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      // Adaptive label radius to avoid clipping on sides
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let labelPct = 0.82; // default inward
      if (Math.abs(cos) > 0.9) labelPct = 0.74; // extreme left/right
      else if (Math.abs(sin) > 0.9) labelPct = 0.84; // top/bottom
      const [lx, ly] = polarToXY(labelPct, i, n);
      return { i, x, y, lx, ly, angle };
    });
  }, [labels.length, data.points.length, polarToXY]);

  const hasData = (values || []).some((v) => Number(v || 0) > 0);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-3">
      {title && <div className="text-[12px] mb-2 text-slate-300">{title}</div>}
      <div className="w-full flex items-center justify-center">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title || 'radar chart'}>
          {/* grid rings */}
          {new Array(ringCount).fill(0).map((_, idx) => {
            const rr = r * ((idx + 1) / ringCount);
            return <circle key={idx} cx={cx} cy={cy} r={rr} fill="none" stroke={gridColor} strokeWidth="1" />;
          })}
          {/* axes */}
          {axes.map(({ i, x, y }) => (
            <line key={`axis-${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke={axisColor} strokeWidth="1" />
          ))}
          {/* polygon */}
          {hasData && (
            <path d={polygonPath} fill={fill} stroke={stroke} strokeWidth={2} />
          )}
          {/* points */}
          {hasData && data.points.map((p, i) => {
            const [px, py] = polarToXY(p, i, data.points.length);
            return <circle key={`pt-${i}`} cx={px} cy={py} r={3} fill={stroke} />;
          })}
          {/* labels */}
      {axes.map(({ i, lx, ly }) => (
            <text
              key={`lbl-${i}`}
              x={lx}
              y={ly}
              textAnchor={lx < cx ? 'end' : lx > cx ? 'start' : 'middle'}
              dominantBaseline={ly < cy ? 'baseline' : 'hanging'}
        style={{ fontSize: 12, fill: textColor }}
            >
        {`${pretty(labels[i] ?? '')} ${Number(values?.[i] ?? 0)}`}
            </text>
          ))}
      {/* numbers are now placed next to labels */}
        </svg>
      </div>
      {/* Legend for max */}
      <div className="mt-1 text-[10px] text-slate-400">Max: {data.max}</div>
    </div>
  );
}
