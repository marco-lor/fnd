import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withAsyncResourceOwner } from '../../performance/runtime';
import './aurora.css';

const SHOOTING_STAR_COLORS = [
  [255, 255, 255],
  [96, 165, 250],
  [94, 234, 212],
  [248, 113, 113],
];

export const MAX_AURORA_STAR_COUNT = 48;
export const MAX_AURORA_MOBILE_STAR_COUNT = 24;
export const MAX_AURORA_SHOOTING_STARS = 2;
export const MAX_AURORA_ANIMATABLE_DECORATIONS = 6;

const MIN_AURORA_STAR_COUNT = 12;
const SHOOTING_STAR_INTERVAL_MS = 8000;
const INTERACTIVE_CLICK_SELECTOR = [
  'a', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  'audio', 'video', '[role=button]', '[role=link]', '[role=menuitem]',
  '[contenteditable=true]', '[data-aurora-ignore-click]',
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
  const requestedCount = Number.isFinite(Number(density))
    ? Math.round(Number(density))
    : MIN_AURORA_STAR_COUNT;
  const viewportLimit = Number(viewportWidth) <= 640
    ? MAX_AURORA_MOBILE_STAR_COUNT
    : MAX_AURORA_STAR_COUNT;
  const count = Math.min(Math.max(requestedCount, MIN_AURORA_STAR_COUNT), viewportLimit);
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

  return { primary: primary.join(','), secondary: secondary.join(',') };
};

const isOrdinaryControlClick = (event) => {
  if (
    event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
    || event.altKey || event.shiftKey
  ) return true;

  const target = event.target;
  return typeof Element !== 'undefined'
    && target instanceof Element
    && Boolean(target.closest(INTERACTIVE_CLICK_SELECTOR));
};

const resetShootingStarElement = (element) => {
  if (!element) return;
  element.classList.remove('shooting-star--active');
  element.dataset.active = 'false';
};

const configureShootingStarElement = (element, star) => {
  if (!element) return;
  const trail = element.querySelector('.shooting-star__trail');
  const head = element.querySelector('.shooting-star__head');
  element.style.left = `${star.startX}px`;
  element.style.top = `${star.startY}px`;
  element.style.transform = `rotate(${star.angleDeg}deg)`;

  if (trail) {
    trail.style.width = `${star.tail}px`;
    trail.style.height = `${star.radius}px`;
    trail.style.background = `linear-gradient(to right, ${rgba(star.color, 0)} 0%, ${rgba(star.color, 0.35)} 60%, ${rgba(star.color, 1)} 100%)`;
    trail.style.boxShadow = `0 0 8px ${rgba(star.color, 0.7)}, 0 0 16px ${rgba(star.color, 0.4)}`;
    trail.style.setProperty('--travel', `${star.travel}px`);
    trail.style.setProperty('--duration', `${star.duration}ms`);
  }
  if (head) {
    head.style.width = `${star.radius * 2.2}px`;
    head.style.height = `${star.radius * 2.2}px`;
    head.style.right = `${-star.radius * 1.1}px`;
    head.style.background = `radial-gradient(circle, ${rgba([255, 255, 255], 1)} 20%, ${rgba(star.color, 1)} 60%, ${rgba(star.color, 0)} 100%)`;
    head.style.boxShadow = `0 0 10px ${rgba(star.color, 0.9)}`;
  }

  element.classList.remove('shooting-star--active');
  element.getBoundingClientRect();
  element.dataset.active = 'true';
  element.classList.add('shooting-star--active');
};

const GlobalAuroraBackground = ({ density = 120, blur = true, className = '' }) => {
  const starFields = useMemo(() => createStarFields(density), [density]);
  const [isDocumentVisible, setIsDocumentVisible] = useState(getDocumentVisibility);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getReducedMotionPreference);
  const shootingStarElementsRef = useRef(Array(MAX_AURORA_SHOOTING_STARS).fill(null));
  const shootingStarSlotsRef = useRef(
    Array.from({ length: MAX_AURORA_SHOOTING_STARS }, () => ({ active: false, timeoutId: null }))
  );
  const timeoutsRef = useRef(new Set());
  const isMotionActive = isDocumentVisible && !prefersReducedMotion;
  const isMotionActiveRef = useRef(isMotionActive);
  isMotionActiveRef.current = isMotionActive;

  const clearShootingStars = useCallback(() => {
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutsRef.current.clear();
    shootingStarSlotsRef.current.forEach((slot, index) => {
      slot.active = false;
      slot.timeoutId = null;
      resetShootingStarElement(shootingStarElementsRef.current[index]);
    });
  }, []);

  const spawnShootingStar = useCallback((origin) => {
    if (!isMotionActiveRef.current) return;
    const slotIndex = shootingStarSlotsRef.current.findIndex((slot, index) => (
      !slot.active && Boolean(shootingStarElementsRef.current[index])
    ));
    if (slotIndex < 0 || timeoutsRef.current.size >= MAX_AURORA_SHOOTING_STARS) return;

    const { w, h } = getViewport();
    const color = SHOOTING_STAR_COLORS[Math.floor(Math.random() * SHOOTING_STAR_COLORS.length)];
    const star = {
      tail: 120 + Math.random() * 220,
      radius: 1.2 + Math.random() * 2.3,
      duration: 900 + Math.random() * 1200,
      color,
      angleDeg: (20 + Math.random() * 20) * (Math.random() < 0.2 ? -1 : 1),
      travel: Math.max(w, h) * (0.5 + Math.random() * 0.6),
      startX: origin && typeof origin.x === 'number' ? origin.x : -w * 0.1 + Math.random() * w * 1.2,
      startY: origin && typeof origin.y === 'number' ? origin.y : -h * 0.15 + Math.random() * h * 0.25,
    };

    const slot = shootingStarSlotsRef.current[slotIndex];
    slot.active = true;
    configureShootingStarElement(shootingStarElementsRef.current[slotIndex], star);
    let timeoutId;
    try {
      timeoutId = withAsyncResourceOwner('shell', () => window.setTimeout(() => {
        timeoutsRef.current.delete(timeoutId);
        if (slot.timeoutId !== timeoutId) return;
        slot.active = false;
        slot.timeoutId = null;
        resetShootingStarElement(shootingStarElementsRef.current[slotIndex]);
      }, star.duration + 100));
    } catch (error) {
      slot.active = false;
      resetShootingStarElement(shootingStarElementsRef.current[slotIndex]);
      throw error;
    }
    slot.timeoutId = timeoutId;
    timeoutsRef.current.add(timeoutId);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => setIsDocumentVisible(getDocumentVisibility());
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handlePreferenceChange = (event) => setPrefersReducedMotion(event.matches);
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
    if (!isMotionActive) clearShootingStars();
  }, [clearShootingStars, isMotionActive]);

  useEffect(() => () => clearShootingStars(), [clearShootingStars]);

  const motionClassName = isMotionActive ? '' : ' global-aurora--paused';
  return (
    <div
      aria-hidden={true}
      className={'global-aurora fixed inset-0 z-0 pointer-events-none overflow-hidden bg-slate-950' + motionClassName + ' ' + className}
    >
      <div className={'absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950'} />
      <div className={'global-aurora__layer absolute -inset-1 opacity-45 ' + (blur ? 'blur-sm' : '')} />
      <div className={'global-aurora__layer--b absolute -inset-1 opacity-40 mix-blend-screen ' + (blur ? 'blur-md' : '')} />
      <div className={'global-aurora__vignette pointer-events-none absolute inset-0'} />
      <div
        className={'global-aurora__star-field global-aurora__star-field--primary'}
        style={{ boxShadow: starFields.primary }}
      />
      <div
        className={'global-aurora__star-field global-aurora__star-field--secondary'}
        style={{ boxShadow: starFields.secondary }}
      />

      {Array.from({ length: MAX_AURORA_SHOOTING_STARS }, (_, index) => (
        <div
          key={'shooting-star-slot-' + index}
          ref={(element) => {
            shootingStarElementsRef.current[index] = element;
          }}
          className={'shooting-star'}
          data-active={'false'}
          data-shooting-star-slot={index}
        >
          <div className={'shooting-star__trail'}>
            <div className={'shooting-star__head'} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default memo(GlobalAuroraBackground);
