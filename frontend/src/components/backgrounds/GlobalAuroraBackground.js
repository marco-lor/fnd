import React, { useMemo, useEffect, useRef, useState } from "react";
import "./aurora.css";

/**
 * GlobalAuroraBackground
 * - Full-viewport animated aurora + twinkling stars
 * - Low-overhead, CSS-powered, and visually subtle to not distract from content
 * - Place as the first child of page containers with position: relative
 */
const GlobalAuroraBackground = ({ density = 120, blur = true, className = "" }) => {
  const stars = useMemo(() => {
    const arr = [];
    const count = Math.min(Math.max(density, 40), 250); // clamp 40..250
    for (let i = 0; i < count; i++) {
      arr.push({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: Math.random() * 2 + 0.5,
        delay: Math.random() * 6,
        opacity: 0.25 + Math.random() * 0.5,
      });
    }
    return arr;
  }, [density]);

  // Shooting stars state
  const [shootingStars, setShootingStars] = useState([]);
  const timeoutsRef = useRef([]);

  // Utility to get viewport size safely
  const getViewport = () => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  });

  const COLORS = [
    { name: 'white', rgb: [255, 255, 255] },
    { name: 'blue', rgb: [96, 165, 250] },   // tailwind sky-400
    { name: 'green', rgb: [94, 234, 212] }, // teal-300
    { name: 'red', rgb: [248, 113, 113] },  // red-400
  ];

  const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

  const spawnShootingStar = (origin) => {
    const { w, h } = getViewport();
    // Tail length and radius random ranges (px)
    const tail = 120 + Math.random() * 220;   // 120..340
    const radius = 1.2 + Math.random() * 2.3; // 1.2..3.5
    const duration = 900 + Math.random() * 1200; // 0.9s..2.1s

    // Choose color
    const color = COLORS[Math.floor(Math.random() * COLORS.length)].rgb;

    // Angle: mostly from upper-left to lower-right (realistic look)
    // Randomize between 20deg and 40deg downward trajectory; flip horizontally sometimes
    const baseDeg = 20 + Math.random() * 20; // 20..40
    const flip = Math.random() < 0.2 ? -1 : 1; // 20% leftward
    const angleDeg = baseDeg * flip;

    // Travel distance ensuring it crosses a portion of screen
    const travel = Math.max(w, h) * (0.5 + Math.random() * 0.6); // 50%..110% of max viewport edge

    // Start position: provided by click or random near top/edges
    let startX, startY;
    if (origin && typeof origin.x === 'number' && typeof origin.y === 'number') {
      startX = origin.x;
      startY = origin.y;
    } else {
      // spawn above or near top-left for natural entries
      startX = -w * 0.1 + Math.random() * w * 1.2;     // -10% .. 110%
      startY = -h * 0.15 + Math.random() * h * 0.25;   // -15% .. 25%
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const star = { id, startX, startY, angleDeg, travel, tail, radius, duration, color };

    setShootingStars((prev) => {
      const next = [...prev, star];
      // Cap to avoid buildup
      return next.length > 6 ? next.slice(next.length - 6) : next;
    });

    // Cleanup after animation
    const t = setTimeout(() => {
      setShootingStars((prev) => prev.filter((s) => s.id !== id));
    }, duration + 100);
    timeoutsRef.current.push(t);
  };

  // Random spawns loop
  useEffect(() => {
    const interval = setInterval(() => {
      // 50% chance to spawn on tick, tick every 6s for subtlety
      if (Math.random() < 0.5) spawnShootingStar();
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Spawn on any page click (background doesn’t intercept clicks)
  useEffect(() => {
    const onClick = (e) => {
      spawnShootingStar({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  // Clear timeouts on unmount
  useEffect(() => () => { timeoutsRef.current.forEach(clearTimeout); }, []);

  return (
    <div className={`fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#070712] ${className}`}>
      {/* Gradient base */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b1020] via-[#0c0f1d] to-[#08080f]" />

      {/* Aurora layers */}
      <div className={`global-aurora__layer absolute -inset-1 opacity-45 ${blur ? "blur-sm" : ""}`} />
      <div className={`global-aurora__layer--b absolute -inset-1 opacity-40 mix-blend-screen ${blur ? "blur-md" : ""}`} />

      {/* Subtle vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,transparent_60%,rgba(0,0,0,0.45))]" />

      {/* Stars */}
      {stars.map((s) => (
        <div
          key={s.id}
          className="absolute rounded-full bg-white/90 global-aurora__twinkle"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            boxShadow: "0 0 6px rgba(255,255,255,0.45)",
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      {/* Shooting stars */}
      {shootingStars.map((s) => (
        <div
          key={s.id}
          className="shooting-star"
          style={{
            left: s.startX,
            top: s.startY,
            transform: `rotate(${s.angleDeg}deg)`,
          }}
        >
          <div
            className="shooting-star__trail"
            style={{
              width: s.tail,
              height: s.radius,
              background: `linear-gradient(to right, ${rgba(s.color, 0)} 0%, ${rgba(s.color, 0.35)} 60%, ${rgba(s.color, 1)} 100%)`,
              boxShadow: `0 0 8px ${rgba(s.color, 0.7)}, 0 0 16px ${rgba(s.color, 0.4)}`,
              '--travel': `${s.travel}px`,
              '--duration': `${s.duration}ms`,
            }}
          >
            {/* Star head */}
            <div
              className="shooting-star__head"
              style={{
                width: s.radius * 2.2,
                height: s.radius * 2.2,
                right: -s.radius * 1.1,
                background: `radial-gradient(circle, ${rgba([255,255,255], 1)} 20%, ${rgba(s.color, 1)} 60%, ${rgba(s.color, 0)} 100%)`,
                boxShadow: `0 0 10px ${rgba(s.color, 0.9)}`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default GlobalAuroraBackground;
