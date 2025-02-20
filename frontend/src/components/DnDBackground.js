// file: ./frontend/src/components/DnDBackground.js
import React, { useEffect, useState } from "react";
import { FaDragon } from "react-icons/fa";

const DnDBackground = () => {
  const [mousePos, setMousePos] = useState({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const [smoothedOffset, setSmoothedOffset] = useState({ x: 0, y: 0 });
  const [time, setTime] = useState(0);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Update mouse position on movement
  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Animation loop: update time and smoothly update the offset toward the target
  useEffect(() => {
    let animationFrameId;
    const animate = (timestamp) => {
      setTime(timestamp);
      const targetOffset = {
        x: mousePos.x - windowSize.width / 2,
        y: mousePos.y - windowSize.height / 2,
      };
      // Interpolate with a factor (0.15 here) to smooth out the sudden jumps
      setSmoothedOffset((prev) => ({
        x: prev.x + (targetOffset.x - prev.x) * 0.15,
        y: prev.y + (targetOffset.y - prev.y) * 0.15,
      }));
      animationFrameId = requestAnimationFrame(animate);
    };
    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [mousePos, windowSize]);

  // Update window size on resize
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Define several dragons with various properties
  // (Additional dragons have been added for more variety)
  const dragons = [
    { id: 1, baseX: 10, baseY: 10, mouseFactor: 0.05, amplitude: 20, frequency: 0.002, size: 120 },
    { id: 2, baseX: 70, baseY: 20, mouseFactor: 0.1, amplitude: 30, frequency: 0.001, size: 150 },
    { id: 3, baseX: 50, baseY: 80, mouseFactor: 0.07, amplitude: 25, frequency: 0.003, size: 100 },
    { id: 4, baseX: 20, baseY: 70, mouseFactor: 0.09, amplitude: 35, frequency: 0.0025, size: 130 },
    { id: 5, baseX: 80, baseY: 50, mouseFactor: 0.06, amplitude: 15, frequency: 0.004, size: 110 },
    { id: 6, baseX: 30, baseY: 30, mouseFactor: 0.08, amplitude: 22, frequency: 0.0022, size: 140 },
    { id: 7, baseX: 60, baseY: 60, mouseFactor: 0.05, amplitude: 18, frequency: 0.0035, size: 115 },
    { id: 8, baseX: 40, baseY: 40, mouseFactor: 0.1, amplitude: 28, frequency: 0.0028, size: 125 },
  ];

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-gray-800 to-black"></div>
      {dragons.map((dragon) => {
        // Use the smoothed offset for a smoother mouse-driven effect
        const offsetX = smoothedOffset.x * dragon.mouseFactor;
        const offsetY = smoothedOffset.y * dragon.mouseFactor;
        // Oscillation for a dynamic, floating feel
        const oscillateX = dragon.amplitude * Math.sin(time * dragon.frequency);
        const oscillateY = dragon.amplitude * Math.cos(time * dragon.frequency);

        const left = `calc(${dragon.baseX}% + ${offsetX + oscillateX}px)`;
        const top = `calc(${dragon.baseY}% + ${offsetY + oscillateY}px)`;

        return (
          <FaDragon
            key={dragon.id}
            className="absolute text-white opacity-20"
            style={{
              left,
              top,
            }}
            size={dragon.size}
          />
        );
      })}
    </div>
  );
};

export default DnDBackground;
