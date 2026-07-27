import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withAsyncResourceOwner } from "../../performance/runtime";
import "./aurora.css";

const SHOOTING_STAR_COLORS = [
  { name: 'white', rgb: [255, 255, 255] },
  { name: 'blue', rgb: [96, 165, 250] },
  { name: 'green', rgb: [94, 234, 212] },
  { name: 'red', rgb: [248, 113, 113] },
];

export const MAX_AURORA_STAR_COUNT = 48;
export const MAX_AURORA_MOBILE_STAR_COUNT = 24;
export const MAX_AURORA_SHOOTING_STARS = 3;

const MIN_AURORA_STAR_COUNT = 12;
const SHOOTING_STAR_INTERVAL_MS = 8000;
const INTERACTIVE_CLICK_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'audio',
  'video',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
  '[data-aurora-ignore-click]',
].join(',');

const getViewport = () => ({
  w: typeof window !== 'undefined' ? window.innerWidth : 1920,
  h: typeof window !== 'undefined' ? window.innerHeight : 1080,
});

const getDocumentVisibility = () => (
  typeof document === 'undefined' || document.visibilityState !== 'hidden'
);

const getReducedMotionPreference = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const rgba = (rgb, alpha) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

const createStarShadow = ({ left, top, size, opacity }) => (
  `${left.toFixed(2)}vw ${top.toFixed(2)}vh 0 ${size.toFixed(2)}px rgba(255,255,255,${opacity.toFixed(2)})`
);

const createStarFields = (density, viewportWidth = getViewport().w) => {
  const requestedCount = Number.isFinite(Number(density)) ? Math.round(Number(density)) : MIN_AURORA_STAR_COUNT;
  const viewportLimit = Number(viewportWidth) <= 640
    ? MAX_AURORA_MOBILE_STAR_COUNT
    : MAX_AURORA_STAR_COUNT;
  const count = Math.min(
    Math.max(requestedCount, MIN_AURORA_STAR_COUNT),
    viewportLimit
  );
  const primary = [];
  const secondary = [];

  for (let index = 0; index < count; index += 1) {
    const shadow = createStarShadow({
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: Math.random() * 1.1 + 0.3,
      opacity: 0.25 + Math.random() * 0.5,
    });
    (index % 2 === 0 ? primary : secondary).push(shadow);
  }

  return {
    primary: primary.join(','),
    secondary: secondary.join(','),
  };
};

const isOrdinaryControlClick = (event) => {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.altKey
    || event.shiftKey
  ) {
    return true;
  }

  const target = event.target;
  return typeof Element !== 'undefined'
    && target instanceof Element
    && Boolean(target.closest(INTERACTIVE_CLICK_SELECTOR));
};

/**
 * GlobalAuroraBackground
 * - Uses two CSS star fields instead of one DOM node per star.
 * - Suspends decorative work while hidden or when reduced motion is requested.
 * - Place as the first child of page containers with position: relative.
 */
const GlobalAuroraBackground = ({ density = 120, blur = true, className = "" }) => {
  const starFields = useMemo(() => createStarFields(density), [density]);
  const [shootingStars, setShootingStars] = useState([]);
  const [isDocumentVisible, setIsDocumentVisible] = useState(getDocumentVisibility);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getReducedMotionPreference);
  const timeoutsRef = useRef(new Set());
  const shootingStarSequenceRef = useRef(0);
  const isMotionActive = isDocumentVisible && !prefersReducedMotion;
  const isMotionActiveRef = useRef(isMotionActive);
  isMotionActiveRef.current = isMotionActive;

  const clearShootingStarTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutsRef.current.clear();
  }, []);

  const spawnShootingStar = useCallback((origin) => {
    if (
      !isMotionActiveRef.current
      || timeoutsRef.current.size >= MAX_AURORA_SHOOTING_STARS
    ) return;

    const { w, h } = getViewport();
    const tail = 120 + Math.random() * 220;
    const radius = 1.2 + Math.random() * 2.3;
    const duration = 900 + Math.random() * 1200;
    const color = SHOOTING_STAR_COLORS[Math.floor(Math.random() * SHOOTING_STAR_COLORS.length)].rgb;
    const baseDeg = 20 + Math.random() * 20;
    const flip = Math.random() < 0.2 ? -1 : 1;
    const angleDeg = baseDeg * flip;
    const travel = Math.max(w, h) * (0.5 + Math.random() * 0.6);

    let startX;
    let startY;
    if (origin && typeof origin.x === 'number' && typeof origin.y === 'number') {
      startX = origin.x;
      startY = origin.y;
    } else {
      startX = -w * 0.1 + Math.random() * w * 1.2;
      startY = -h * 0.15 + Math.random() * h * 0.25;
    }

    shootingStarSequenceRef.current += 1;
    const id = `${Date.now()}-${shootingStarSequenceRef.current}`;
    const star = { id, startX, startY, angleDeg, travel, tail, radius, duration, color };

    setShootingStars((currentStars) => (
      [...currentStars, star].slice(-MAX_AURORA_SHOOTING_STARS)
    ));

    let timeoutId;
    timeoutId = withAsyncResourceOwner('shell', () => window.setTimeout(() => {
      timeoutsRef.current.delete(timeoutId);
      if (!isMotionActiveRef.current) return;
      setShootingStars((currentStars) => currentStars.filter((currentStar) => currentStar.id !== id));
    }, duration + 100));
    timeoutsRef.current.add(timeoutId);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(getDocumentVisibility());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handlePreferenceChange = (event) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handlePreferenceChange);
      return () => mediaQuery.removeEventListener('change', handlePreferenceChange);
    }

    mediaQuery.addListener(handlePreferenceChange);
    return () => mediaQuery.removeListener(handlePreferenceChange);
  }, []);

  useEffect(() => {
    if (!isMotionActive) return undefined;

    const intervalId = withAsyncResourceOwner('shell', () => window.setInterval(() => {
      if (Math.random() < 0.35) spawnShootingStar();
    }, SHOOTING_STAR_INTERVAL_MS));

    return () => window.clearInterval(intervalId);
  }, [isMotionActive, spawnShootingStar]);

  useEffect(() => {
    if (!isMotionActive) return undefined;

    const handleClick = (event) => {
      if (isOrdinaryControlClick(event)) return;
      spawnShootingStar({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [isMotionActive, spawnShootingStar]);

  useEffect(() => {
    if (isMotionActive) return;

    clearShootingStarTimeouts();
    setShootingStars((currentStars) => (currentStars.length > 0 ? [] : currentStars));
  }, [clearShootingStarTimeouts, isMotionActive]);

  useEffect(() => () => {
    clearShootingStarTimeouts();
  }, [clearShootingStarTimeouts]);

  return (
    <div
      aria-hidden="true"
      className={`global-aurora fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#070712] ${isMotionActive ? '' : 'global-aurora--paused'} ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b1020] via-[#0c0f1d] to-[#08080f]" />

      <div className={`global-aurora__layer absolute -inset-1 opacity-45 ${blur ? "blur-sm" : ""}`} />
      <div className={`global-aurora__layer--b absolute -inset-1 opacity-40 mix-blend-screen ${blur ? "blur-md" : ""}`} />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,transparent_60%,rgba(0,0,0,0.45))]" />

      <div
        className="global-aurora__star-field global-aurora__star-field--primary"
        style={{ boxShadow: starFields.primary }}
      />
      <div
        className="global-aurora__star-field global-aurora__star-field--secondary"
        style={{ boxShadow: starFields.secondary }}
      />

      {shootingStars.map((star) => (
        <div
          key={star.id}
          className="shooting-star"
          style={{
            left: star.startX,
            top: star.startY,
            transform: `rotate(${star.angleDeg}deg)`,
          }}
        >
          <div
            className="shooting-star__trail"
            style={{
              width: star.tail,
              height: star.radius,
              background: `linear-gradient(to right, ${rgba(star.color, 0)} 0%, ${rgba(star.color, 0.35)} 60%, ${rgba(star.color, 1)} 100%)`,
              boxShadow: `0 0 8px ${rgba(star.color, 0.7)}, 0 0 16px ${rgba(star.color, 0.4)}`,
              '--travel': `${star.travel}px`,
              '--duration': `${star.duration}ms`,
            }}
          >
            <div
              className="shooting-star__head"
              style={{
                width: star.radius * 2.2,
                height: star.radius * 2.2,
                right: -star.radius * 1.1,
                background: `radial-gradient(circle, ${rgba([255, 255, 255], 1)} 20%, ${rgba(star.color, 1)} 60%, ${rgba(star.color, 0)} 100%)`,
                boxShadow: `0 0 10px ${rgba(star.color, 0.9)}`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default memo(GlobalAuroraBackground);
