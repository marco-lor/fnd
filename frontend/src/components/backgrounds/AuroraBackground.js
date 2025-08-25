import React, { useEffect, useMemo } from "react";

// Soft animated aurora + parallax twinkling stars
const AuroraBackground = () => {
  // Pre-generate star positions to avoid reflow
  const stars = useMemo(() => {
    const list = [];
    const count = 120;
    for (let i = 0; i < count; i++) {
      list.push({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: Math.random() * 2 + 0.5,
        delay: Math.random() * 5,
      });
    }
    return list;
  }, []);

  useEffect(() => {
    // No imperative animation needed; CSS handles it.
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-[#070712]">
      {/* Gradient base */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b1020] via-[#0c0f1d] to-[#08080f]" />

      {/* Aurora layers */}
      <div className="aurora-layer absolute -inset-1 opacity-50" />
      <div className="aurora-layer-2 absolute -inset-1 opacity-40 mix-blend-screen" />

      {/* Noise overlay for texture */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'60\\'><filter id=\\'n\\'><feTurbulence type=\\'fractalNoise\\' baseFrequency=\\'0.8\\' numOctaves=\\'4\\' stitchTiles=\\'stitch\\'/></filter><rect width=\\'100%\\' height=\\'100%\\' filter=\\'url(%23n)\\' opacity=\\'0.2\\'/></svg>')" }} />

      {/* Stars */}
      {stars.map((s) => (
        <div
          key={s.id}
          className="absolute rounded-full bg-white/80 twinkle"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            boxShadow: "0 0 6px rgba(255,255,255,0.6)",
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

export default AuroraBackground;
