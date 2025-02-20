// file: ./frontend/src/components/Bazaar.js
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactDOMServer from 'react-dom/server';
import { GiBroadsword, GiShield } from 'react-icons/gi';
import Navbar from './navbar';

const ITEMS = [
  {
    Image: "",
    Nome: "Bastone Magico",
    Slot: "",
    Hands: "2",
    Tipo: "Distanza",
    BonusLevels: "3 Mira, 3 Attacco, 3 Disciplina",
    BonusDanno: "0",
    Penetrazione: "0",
    Danno: "1d4",
    DannoCritico: "1d4",
    BonusDannoCritico:
      "Per essere equipaggiato la somma di saggezza e intelligenza deve essere almeno 3 riduce di 6 il costo di mana incantesimi",
    Effetto: "0",
    Salute: "0",
    Mira: "3",
    Attacco: "3",
    Crit: "0",
    Difesa: "0",
    RiduzioneDanni: "0",
    Disciplina: "3",
    DannoMod: "1d4",
    DannoCriticoMod: "1d4"
  },
  // ... additional items ...
];

function getIconDataURL(IconComponent, color = 'gray', size = 50) {
  const svgString = ReactDOMServer.renderToStaticMarkup(
    <IconComponent color={color} size={size} />
  );
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(svgBlob);
}

function InteractiveBackground() {
  const canvasRef = useRef(null);
  const [mousePos, setMousePos] = useState({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const swordIcon = new Image();
    const shieldIcon = new Image();
    swordIcon.src = getIconDataURL(GiBroadsword, 'gray', 50);
    shieldIcon.src = getIconDataURL(GiShield, 'gray', 50);

    let imagesLoaded = 0;
    const onImageLoad = () => {
      imagesLoaded++;
      if (imagesLoaded === 2) {
        initAnimation();
      }
    };
    swordIcon.onload = onImageLoad;
    shieldIcon.onload = onImageLoad;

    const icons = [];
    const iconCount = 15;
    for (let i = 0; i < iconCount; i++) {
      const type = Math.random() < 0.5 ? 'sword' : 'shield';
      const x = Math.random() * width;
      const y = Math.random() * height;
      const vx = (Math.random() - 0.5) * 1.5;
      const vy = (Math.random() - 0.5) * 1.5;
      const rotation = Math.random() * Math.PI * 2;
      const rotationSpeed = (Math.random() - 0.5) * 0.02;
      const size = 0.7 + Math.random() * 0.5;
      icons.push({ type, x, y, vx, vy, rotation, rotationSpeed, size });
    }

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', handleResize);

    const threshold = 100;
    const repulsionStrength = 0.5;
    let animationFrameId;

    function drawIcon(img, x, y, sizeFactor, rotation) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      const iconSize = 50 * sizeFactor;
      ctx.drawImage(img, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
      ctx.restore();
    }

    const initAnimation = () => {
      const draw = () => {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        icons.forEach(icon => {
          const dx = icon.x - mousePos.x;
          const dy = icon.y - mousePos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < threshold && dist > 0) {
            const factor = repulsionStrength * (threshold - dist) / threshold;
            icon.vx += (dx / dist) * factor;
            icon.vy += (dy / dist) * factor;
          }
          icon.x += icon.vx;
          icon.y += icon.vy;
          icon.rotation += icon.rotationSpeed;
          // Bounce from edges
          if (icon.x < 0 || icon.x > width) {
            icon.vx = -icon.vx;
          }
          if (icon.y < 0 || icon.y > height) {
            icon.vy = -icon.vy;
          }
          // Draw icons
          if (icon.type === 'sword') {
            drawIcon(swordIcon, icon.x, icon.y, icon.size, icon.rotation);
          } else {
            drawIcon(shieldIcon, icon.x, icon.y, icon.size, icon.rotation);
          }
        });
        animationFrameId = requestAnimationFrame(draw);
      };
      draw();
    };

    // If the images are already cached
    if (swordIcon.complete && shieldIcon.complete) {
      onImageLoad();
      onImageLoad();
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [mousePos]);

  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
      }}
    />
  );
}

function ComparisonPanel({ item }) {
  return (
    <motion.div
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ duration: 0.3 }}
      // Right panel
      className="fixed right-0 bg-gray-900 bg-opacity-90 p-4 overflow-y-auto z-50"
      style={{
        top: '14rem',
        width: '25vw',
        height: 'calc(100% - 4rem)'
      }}
    >
      <h2 className="text-2xl font-bold text-white mb-4">{item.Nome}</h2>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(item).map(([key, value]) => (
          <React.Fragment key={key}>
            <span className="font-semibold text-white">{key}</span>
            <span className="text-gray-300">{value || '-'}</span>
          </React.Fragment>
        ))}
      </div>
    </motion.div>
  );
}

function ItemCard({ item, onPurchase, onHoverItem, onLockToggle, isLocked }) {
  const imageUrl = `https://via.placeholder.com/150x150?text=${encodeURIComponent(item.Image)}`;
  const title = item.Nome || item.Image;

  return (
    <motion.div
      className={`flex items-center p-2 bg-gray-800 bg-opacity-80 shadow rounded-lg hover:bg-gray-700 transition-colors cursor-pointer ${
        isLocked ? 'border-2 border-blue-500' : ''
      }`}
      whileHover={{ scale: 1.02 }}
      onMouseEnter={() => onHoverItem(item)}
      onMouseLeave={() => onHoverItem(null)}
      onClick={onLockToggle}
    >
      <img src={imageUrl} alt={title} className="w-16 h-16 object-cover rounded-lg mr-4" />
      <div className="flex-grow">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <p className="text-sm text-gray-300">
          Slot: {item.Slot} | Tipo: {item.Tipo} | Hands: {item.Hands}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPurchase(item);
        }}
        className="px-3 py-1 rounded bg-[rgba(25,50,128,0.4)] text-white"
      >
        Acquire
      </button>
    </motion.div>
  );
}

export default function Bazaar() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(['All']);
  const [selectedHands, setSelectedHands] = useState(['All']);
  const [selectedTipo, setSelectedTipo] = useState(['All']);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [lockedItem, setLockedItem] = useState(null);

  const slots = ['All', ...Array.from(new Set(ITEMS.map((item) => item.Slot)))];
  const hands = ['All', ...Array.from(new Set(ITEMS.map((item) => item.Hands)))];
  const tipos = ['All', ...Array.from(new Set(ITEMS.map((item) => item.Tipo)))];

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const toggleFilter = (currentFilters, setFilters, value) => {
    if (value === 'All') {
      setFilters(['All']);
    } else {
      if (currentFilters.includes('All')) {
        setFilters([value]);
      } else {
        if (currentFilters.includes(value)) {
          setFilters(currentFilters.filter((v) => v !== value));
        } else {
          setFilters([...currentFilters, value]);
        }
      }
    }
  };

  const handleToggleSlot = (slot) => {
    toggleFilter(selectedSlot, setSelectedSlot, slot);
  };

  const handleToggleHands = (hand) => {
    toggleFilter(selectedHands, setSelectedHands, hand);
  };

  const handleToggleTipo = (tipo) => {
    toggleFilter(selectedTipo, setSelectedTipo, tipo);
  };

  const handleHoverItem = (item) => {
    // Only set hovered if not locked
    if (!lockedItem) {
      setHoveredItem(item);
    }
  };

  const filteredItems = ITEMS.filter((item) => {
    const matchesSearch =
      (item.Nome && item.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Image && item.Image.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Tipo && item.Tipo.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesSlot = selectedSlot.includes('All') || selectedSlot.includes(item.Slot);
    const matchesHands = selectedHands.includes('All') || selectedHands.includes(item.Hands);
    const matchesTipo = selectedTipo.includes('All') || selectedTipo.includes(item.Tipo);

    return matchesSearch && matchesSlot && matchesHands && matchesTipo;
  });

  const handlePurchase = (item) => {
    alert(`Purchasing item: ${item.Nome || item.Image}`);
  };

  const panelItem = lockedItem || hoveredItem;

  return (
    <div className="min-h-screen relative" style={{ fontFamily: 'Papyrus, fantasy' }}>
      {/* Fixed Navbar at the top */}
      <div className="fixed top-0 left-0 w-full z-50">
        <Navbar />
      </div>

      {/* Background animation */}
      <InteractiveBackground />

      {/* Left Filter Panel */}
      <div
        className="fixed left-0 bg-gray-800 bg-opacity-90 p-4 overflow-y-auto z-40"
        style={{
          top: '14rem',
          width: '15vw',
          height: 'calc(100% - 4rem)'
        }}
      >
        <div className="mb-6">
          <p className="text-white font-bold mb-2">Filter by Slot:</p>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                key={slot}
                onClick={() => handleToggleSlot(slot)}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  selectedSlot.includes(slot)
                    ? 'bg-[rgba(25,50,128,0.4)] text-white'
                    : 'bg-white text-[rgba(25,50,128,0.4)]'
                }`}
              >
                {slot || 'None'}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-6">
          <p className="text-white font-bold mb-2">Filter by Hands:</p>
          <div className="flex flex-wrap gap-2">
            {hands.map((hand) => (
              <button
                key={hand}
                onClick={() => handleToggleHands(hand)}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  selectedHands.includes(hand)
                    ? 'bg-[rgba(25,50,128,0.4)] text-white'
                    : 'bg-white text-[rgba(25,50,128,0.4)]'
                }`}
              >
                {hand}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-white font-bold mb-2">Filter by Tipo:</p>
          <div className="flex flex-wrap gap-2">
            {tipos.map((tipo) => (
              <button
                key={tipo}
                onClick={() => handleToggleTipo(tipo)}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  selectedTipo.includes(tipo)
                    ? 'bg-[rgba(25,50,128,0.4)] text-white'
                    : 'bg-white text-[rgba(25,50,128,0.4)]'
                }`}
              >
                {tipo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        className="relative p-6"
        style={{
          marginLeft: '15vw',
          marginRight: '25vw',
          marginTop: '9rem'
        }}
      >
        {/* Search Bar */}
        <div className="flex flex-col gap-4 mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search Arcane Wares..."
            className="border border-white rounded-lg px-4 py-2 focus:outline-none focus:border-gray-300 flex-1 bg-gray-800 text-white"
          />
        </div>

        {/* Item List */}
        <div className="flex flex-col gap-2">
          {filteredItems.map((item, index) => (
            <ItemCard
              key={index}
              item={item}
              onPurchase={handlePurchase}
              onHoverItem={handleHoverItem}
              onLockToggle={() => {
                if (lockedItem && lockedItem === item) {
                  setLockedItem(null);
                } else {
                  setLockedItem(item);
                }
              }}
              isLocked={lockedItem && lockedItem === item}
            />
          ))}
        </div>
      </div>

      {/* Right Comparison Panel */}
      <AnimatePresence>
        {panelItem && <ComparisonPanel item={panelItem} key="comparisonPanel" />}
      </AnimatePresence>
    </div>
  );
}
