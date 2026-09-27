import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './codex.css';

export default function CodexBackground({ clouds = 4, intensity = 0.5, className = '' }) {
  const [quasars, setQuasars] = useState([]);
  const [paused, setPaused] = useState(true);
  const pausedRef = useRef(true);
  const timeouts = useRef(new Set());
  const surface = useRef(null);
  const nebulas = useMemo(() => Array.from({ length: Math.min(Math.max(clouds, 2), 8) }, (_, id) => ({
    id, size: 700 + Math.random() * 900, top: Math.random() * 100, left: Math.random() * 100,
    delay: Math.random() * 12, variant: ['a', 'b', 'c'][Math.floor(Math.random() * 3)], opacity: Math.random() * 0.25,
  })), [clouds]);
  const clearPulses = useCallback(() => { timeouts.current.forEach(clearTimeout); timeouts.current.clear(); }, []);
  const spawn = useCallback(origin => {
    if (pausedRef.current) return;
    const bounds = surface.current?.getBoundingClientRect();
    if (!bounds) return;
    const id = `${Date.now()}-${Math.random()}`;
    const pulse = { id, x: origin?.x ?? Math.random() * bounds.width,
      y: origin?.y ?? Math.random() * bounds.height, hue: 200 + Math.random() * 80,
      angle: Math.random() * 360, duration: 1300 + Math.random() * 900 };
    setQuasars(previous => [...previous.slice(-4), pulse]);
    const timer = setTimeout(() => { timeouts.current.delete(timer); setQuasars(previous => previous.filter(row => row.id !== id)); }, pulse.duration + 100);
    timeouts.current.add(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let interval;
    const update = () => {
      const next = Boolean(media?.matches || document.hidden);
      pausedRef.current = next; setPaused(next);
      clearInterval(interval); interval = undefined;
      clearPulses(); setQuasars([]);
      if (!next) interval = setInterval(() => { if (Math.random() < 0.45) spawn(); }, 7000);
    };
    update();
    media?.addEventListener?.('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      pausedRef.current = true; clearInterval(interval); clearPulses();
      media?.removeEventListener?.('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [spawn, clearPulses]);

  return <div ref={surface} aria-hidden="true" data-paused={paused} className={`codex-background absolute inset-0 z-0 overflow-hidden ${className}`}
    onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); spawn({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }); }}>
    <div className="absolute inset-0 bg-gradient-to-b from-[#0a0e1a] via-[#0a0c16] to-[#090912]" />
    <div className="absolute inset-0 codex-grid-mask opacity-[0.08]" />
    {nebulas.map(row => <div key={row.id} className={`codex-nebula codex-nebula--${row.variant}`} style={{ top: `${row.top}%`, left: `${row.left}%`, width: row.size, height: row.size * 0.75, animationDelay: `${row.delay}s`, opacity: Math.max(0.2, Math.min(0.9, intensity * 0.5 + row.opacity)) }} />)}
    {quasars.map(pulse => <div key={pulse.id} className="codex-quasar" style={{ left: pulse.x, top: pulse.y, '--q-angle': `${pulse.angle}deg`, '--q-hue': pulse.hue, '--q-alpha': 0.7, '--q-duration': `${pulse.duration}ms` }}><div className="codex-quasar__flare" /><div className="codex-quasar__beam codex-quasar__beam--a" /><div className="codex-quasar__beam codex-quasar__beam--b" /></div>)}
    <div className="absolute inset-0 bg-[radial-gradient(55%_55%_at_50%_40%,transparent_60%,rgba(0,0,0,0.45))]" />
  </div>;
}
