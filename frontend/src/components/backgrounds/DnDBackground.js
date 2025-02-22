// file: ./frontend/src/components/backgrounds/DnDBackground.js
import React, { useEffect, useState } from "react";
import { FaDragon } from "react-icons/fa";

const DnDBackground = () => {
  // Track mouse position for repulsion
  const [mousePos, setMousePos] = useState({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  // We'll store each dragon’s physics state here (position and velocity)
  const [dragons, setDragons] = useState([]);
  // State for triggering the spin animation
  const [spin, setSpin] = useState(false);

  // Update mouse position on movement
  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Listen for global click events to trigger spin animation
  useEffect(() => {
    const handleClick = () => {
      setSpin(true);
      // Reset spin after 1 second (matches animation duration)
      setTimeout(() => setSpin(false), 1000);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  // Define the original configuration for each dragon.
  const dragonsConfig = [
    { id: 1, baseX: 10, baseY: 10, size: 120 },
    { id: 2, baseX: 70, baseY: 20, size: 150 },
    { id: 3, baseX: 50, baseY: 80, size: 100 },
    { id: 4, baseX: 20, baseY: 70, size: 130 },
    { id: 5, baseX: 80, baseY: 50, size: 110 },
    { id: 6, baseX: 30, baseY: 30, size: 140 },
    { id: 7, baseX: 60, baseY: 60, size: 115 },
    { id: 8, baseX: 40, baseY: 40, size: 125 },
  ];

  // Initialize each dragon’s physics state
  useEffect(() => {
    const initialDragons = dragonsConfig.map((dragon) => {
      const x = window.innerWidth * (dragon.baseX / 100);
      const y = window.innerHeight * (dragon.baseY / 100);
      const speed = 1 + Math.random(); // random speed between 1 and 2
      const angle = Math.random() * 2 * Math.PI;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      return { ...dragon, x, y, vx, vy };
    });
    setDragons(initialDragons);
  }, []);

  // Animation loop: update positions with bouncing and mouse repulsion
  useEffect(() => {
    let animationFrameId;
    const update = () => {
      setDragons((prevDragons) =>
        prevDragons.map((dragon) => {
          let { x, y, vx, vy, size } = dragon;
          let newX = x + vx;
          let newY = y + vy;

          // Bounce off the screen edges with damping
          const damping = 0.8;
          if (newX < 0) {
            newX = 0;
            vx = -vx * damping;
          } else if (newX + size > window.innerWidth) {
            newX = window.innerWidth - size;
            vx = -vx * damping;
          }
          if (newY < 0) {
            newY = 0;
            vy = -vy * damping;
          } else if (newY + size > window.innerHeight) {
            newY = window.innerHeight - size;
            vy = -vy * damping;
          }

          // Mouse repulsion: if the dragon’s center is within 100px of the mouse, apply a force away from it
          const centerX = newX + size / 2;
          const centerY = newY + size / 2;
          const dx = centerX - mousePos.x;
          const dy = centerY - mousePos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const threshold = 100;
          if (dist < threshold && dist > 0) {
            const force = (threshold - dist) / threshold;
            vx += (dx / dist) * force * 2;
            vy += (dy / dist) * force * 2;
          }

          // Limit maximum speed to avoid excessive acceleration
          const currentSpeed = Math.sqrt(vx * vx + vy * vy);
          const maxSpeed = 3;
          if (currentSpeed > maxSpeed) {
            const scale = maxSpeed / currentSpeed;
            vx *= scale;
            vy *= scale;
          }

          return { ...dragon, x: newX, y: newY, vx, vy };
        })
      );
      animationFrameId = requestAnimationFrame(update);
    };
    animationFrameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId);
  }, [mousePos]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-gray-800 to-black"></div>
      {dragons.map((dragon) => (
        <FaDragon
          key={dragon.id}
          className="absolute text-white opacity-20 transition-transform duration-1000"
          style={{
            left: dragon.x,
            top: dragon.y,
            // Apply a full 360deg spin if 'spin' is true
            transform: spin ? "rotate(360deg)" : "rotate(0deg)",
          }}
          size={dragon.size}
        />
      ))}
    </div>
  );
};

export default DnDBackground;
