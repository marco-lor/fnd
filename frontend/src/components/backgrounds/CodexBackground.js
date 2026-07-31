import React, { useEffect, useMemo, useState, useRef } from "react";
import "./codex.css";

/**
 * CodexBackground
 * - Page-scoped cosmic background with drifting nebulas and occasional quasar pulses
 * - Styled to echo the aurora look but without shooting stars; focuses on knowledge/codex vibe
 * - Place as the first child inside a relatively positioned page container
 */
const CodexBackground = ({
	clouds = 4, // number of nebula clouds
	intensity = 0.5, // 0..1 base opacity multiplier
	className = "",
}) => {
	// Precompute nebula clouds
	const nebulas = useMemo(() => {
		const arr = [];
		const count = Math.min(Math.max(clouds, 2), 8);
		for (let i = 0; i < count; i++) {
			const size = 700 + Math.random() * 900; // px
			const top = Math.random() * 100; // %
			const left = Math.random() * 100; // %
			const rotate = Math.random() * 360; // deg
			const scale = 0.8 + Math.random() * 0.8;
			const delay = Math.random() * 12; // s
			// pick a palette variant
			const variant = ["a", "b", "c"][Math.floor(Math.random() * 3)];
			arr.push({ id: i, size, top, left, rotate, scale, delay, variant });
		}
		return arr;
	}, [clouds]);

	// Quasars: short pulses with a bright flare + twin beams
	const [quasars, setQuasars] = useState([]);
	const timeoutsRef = useRef([]);

	const spawnQuasar = (origin) => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const x = origin?.x ?? Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920);
		const y = origin?.y ?? Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080) * 0.8 + 60;
		const angle = Math.random() * 360; // beams rotation
		const hue = Math.floor(200 + Math.random() * 80); // bluish 200..280
		const duration = 1300 + Math.random() * 900; // ms
		const strength = 0.55 + Math.random() * 0.35; // 0.55..0.9
		const q = { id, x, y, angle, hue, duration, strength };
		setQuasars((prev) => (prev.length > 5 ? [...prev.slice(1), q] : [...prev, q]));
		const t = setTimeout(() => {
			setQuasars((prev) => prev.filter((it) => it.id !== id));
		}, duration + 100);
		timeoutsRef.current.push(t);
	};

	// Random spawn loop (subtle)
	useEffect(() => {
		const interval = setInterval(() => {
			if (Math.random() < 0.45) spawnQuasar();
		}, 7000);
		return () => clearInterval(interval);
	}, []);

	// Click spawns a quasar at cursor (background does not eat events)
	useEffect(() => {
		const onClick = (e) => spawnQuasar({ x: e.clientX, y: e.clientY });
		window.addEventListener("click", onClick);
		return () => window.removeEventListener("click", onClick);
	}, []);

	// Cleanup pending timeouts
	useEffect(() => () => timeoutsRef.current.forEach(clearTimeout), []);

	return (
		<div className={`absolute inset-0 z-0 pointer-events-none overflow-hidden ${className}`}>
			{/* Base gradient tuned for readability under content */}
			<div className="absolute inset-0 bg-gradient-to-b from-[#0a0e1a] via-[#0a0c16] to-[#090912]" />

			{/* Subtle knowledge grid pattern masked at edges */}
			<div className="absolute inset-0 codex-grid-mask opacity-[0.08]" />

			{/* Nebula layers */}
			{nebulas.map((n) => (
				<div
					key={n.id}
					className={`codex-nebula codex-nebula--${n.variant}`}
					style={{
						top: `${n.top}%`,
						left: `${n.left}%`,
						width: n.size,
						height: n.size * 0.75,
						transform: `translate(-50%, -50%) rotate(${n.rotate}deg) scale(${n.scale})`,
						animationDelay: `${n.delay}s`,
						opacity: Math.max(0.2, Math.min(0.9, 0.5 * intensity + Math.random() * 0.25)),
					}}
				/>
			))}

			{/* Quasar pulses */}
			{quasars.map((q) => (
				<div
					key={q.id}
					className="codex-quasar"
					style={{
						left: q.x,
						top: q.y,
						transform: `translate(-50%, -50%) rotate(${q.angle}deg)`,
						'--q-hue': q.hue,
						'--q-alpha': q.strength,
						'--q-duration': `${q.duration}ms`,
					}}
				>
					<div className="codex-quasar__flare" />
					<div className="codex-quasar__beam codex-quasar__beam--a" />
					<div className="codex-quasar__beam codex-quasar__beam--b" />
				</div>
			))}

			{/* Vignette for focus */}
			<div className="absolute inset-0 bg-[radial-gradient(55%_55%_at_50%_40%,transparent_60%,rgba(0,0,0,0.45))]" />
		</div>
	);
};

export default CodexBackground;

