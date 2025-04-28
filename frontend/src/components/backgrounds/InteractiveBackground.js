// file: ./frontend/src/components/backgrounds/InteractiveBackground.js
import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  GiBroadsword,
  GiShield,
  GiCrossedSwords,
  GiSpartanHelmet,
  GiBowArrow,
} from "react-icons/gi";

const EquipmentBackground = () => {
  const numIcons = 30;
  const [icons, setIcons] = useState([]);
  // Track mouse position in a ref so updates don't trigger re-renders
  const mousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  // Memoize iconComponents so its reference doesn't change on each render
  const iconComponents = useMemo(() => [
    GiBroadsword,
    GiShield,
    GiCrossedSwords,
    GiSpartanHelmet,
    GiBowArrow,
  ], []);

  // Initialize icons with random positions, velocities, and sizes
  useEffect(() => {
    const initialIcons = [];
    for (let i = 0; i < numIcons; i++) {
      const IconComponent =
        iconComponents[Math.floor(Math.random() * iconComponents.length)];
      const x = Math.random() * window.innerWidth;
      const y = Math.random() * window.innerHeight;
      const speed = 1 + Math.random(); // speed between 1 and 2
      const angle = Math.random() * 2 * Math.PI;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const size = 30 + Math.random() * 30; // size between 30 and 60 pixels
      initialIcons.push({ id: i, x, y, vx, vy, size, IconComponent });
    }
    setIcons(initialIcons);
  }, [iconComponents]);

  // Update mouse position on movement
  useEffect(() => {
    const handleMouseMove = (e) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Animation loop: update positions, bounce, apply damping, and limit speed
  useEffect(() => {
    let animationFrameId;
    const update = () => {
      setIcons((prevIcons) =>
        prevIcons.map((icon) => {
          let { x, y, vx, vy, size } = icon;
          let newX = x + vx;
          let newY = y + vy;

          // Bounce off screen borders with damping (slow down on collision)
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

          // Mouse repulsion: if the icon's center is within 100px of the mouse, apply a force away from it
          const iconCenterX = newX + size / 2;
          const iconCenterY = newY + size / 2;
          const dx = iconCenterX - mousePos.current.x;
          const dy = iconCenterY - mousePos.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const threshold = 100;
          if (dist < threshold && dist > 0) {
            const force = (threshold - dist) / threshold;
            vx += (dx / dist) * force * 2;
            vy += (dy / dist) * force * 2;
          }

          // Limit the maximum speed to prevent icons from accelerating too much
          const currentSpeed = Math.sqrt(vx * vx + vy * vy);
          const maxSpeed = 3;
          if (currentSpeed > maxSpeed) {
            const scale = maxSpeed / currentSpeed;
            vx *= scale;
            vy *= scale;
          }

          return { ...icon, x: newX, y: newY, vx, vy };
        })
      );
      animationFrameId = requestAnimationFrame(update);
    };
    animationFrameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    // Changed to fixed positioning to cover the entire viewport
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-gray-800 to-black"></div>
      {icons.map(({ id, x, y, size, IconComponent }) => (
        <IconComponent
          key={id}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: size,
            height: size,
            color: "white",
            opacity: 0.2,
            pointerEvents: "none", // so icons don't interfere with mouse events
          }}
        />
      ))}
    </div>
  );
};

export default EquipmentBackground;
