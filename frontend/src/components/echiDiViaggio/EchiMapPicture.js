import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import maps from '../../assets/images/maps/generated/sources';

const srcSet = (variants) => variants.map(({ url, width }) => `${url} ${width}w`).join(', ');
const FORMATS = ['avif', 'webp', 'png', 'error'];
const selectedAttempt = (url, fallback) => {
  const format = /\.(avif|webp|png)(?:[?#]|$)/i.exec(url)?.[1].toLowerCase();
  return format ? FORMATS.indexOf(format) : fallback;
};

const disarmImage = (image) => {
  const picture = image.parentNode;
  const sources = [...picture.querySelectorAll('source')];
  // Keep native selection on an inert source while clearing network URLs.
  // Otherwise WebKit can retry a failed source or select the PNG during exit.
  const guard = document.createElement('source');
  guard.srcset = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  picture.prepend(guard);
  image.removeAttribute('src');
  sources.forEach((source) => source.removeAttribute('srcset'));
  guard.remove();
};

function EchiMapPicture({ mapId, alt, eager = false, children, className = '', style, ...surfaceEvents }) {
  const map = maps[mapId];
  const surfaceRef = useRef(null);
  const imageRef = useRef(null);
  const attemptRef = useRef(0);
  const decodeSequence = useRef(0);
  const [active, setActive] = useState(eager);
  const [attempt, setAttempt] = useState({ index: 0, failed: [] });
  const format = FORMATS[attempt.index];
  const [loaded, setLoaded] = useState(false);
  const [width, setWidth] = useState(0);
  const measured = width > 0;

  useLayoutEffect(() => {
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const nextWidth = surfaceRef.current.getBoundingClientRect().width;
      if (nextWidth > 0) setWidth(nextWidth);
    };
    // Measure the coordinate surface, including the actual shell/sidebar state,
    // before any source URL exists. A zero-width hidden surface waits for size.
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(surfaceRef.current);
      return () => { disposed = true; observer.disconnect(); };
    }
    window.addEventListener('resize', measure);
    return () => { disposed = true; window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    if (active) return undefined;
    if (eager || typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return undefined;
    }
    let disposed = false;
    const observer = new IntersectionObserver((entries) => {
      if (!disposed && entries.some((entry) => entry.isIntersecting)) {
        setActive(true);
        observer.disconnect();
      }
    }, { rootMargin: '320px 0px', threshold: 0 });
    observer.observe(surfaceRef.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [active, eager]);

  useLayoutEffect(() => {
    const image = imageRef.current;
    // React assigns img properties while the node is detached. WebKit may fetch
    // a detached PNG immediately, before it sees its picture sources. Assign the
    // fallback only after the complete picture is connected to the document.
    if (!active || !measured || !image?.isConnected || attemptRef.current === 3) return;
    const currentWidth = surfaceRef.current.getBoundingClientRect().width;
    setWidth(currentWidth);
    if (currentWidth <= 0) return;
    const picture = image.parentNode;
    const sources = [...picture.querySelectorAll('source')];
    const currentAttempt = Math.max(attemptRef.current, selectedAttempt(image.currentSrc, attemptRef.current));
    sources.forEach((source) => {
      const sourceAttempt = source.type === 'image/avif' ? 0 : 1;
      // Mutating an unsupported source can reselect the current PNG. Keep
      // skipped sources untouched while sizing current and future candidates.
      if (sourceAttempt >= currentAttempt && source.getAttribute('sizes') !== `${currentWidth}px`) {
        source.setAttribute('sizes', `${currentWidth}px`);
      }
      // Reinstall URLs on StrictMode replay, without rewriting live requests.
      if (!source.hasAttribute('srcset')) source.setAttribute('srcset', srcSet(sourceAttempt === 0 ? map.avif : map.webp));
    });
    if (!image.hasAttribute('src')) image.src = map.original;
  }, [active, map, measured, width]);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!active || !measured || !image) return undefined;
    return () => {
      decodeSequence.current += 1;
      disarmImage(image);
    };
  }, [active, map, measured]);

  const failImage = (image) => {
    if (image !== imageRef.current || attemptRef.current === 3) return;
    const current = image.currentSrc || '';
    if (current.startsWith('data:')) return;
    // Native picture can skip unsupported formats. Advance from the URL that
    // actually failed, so a natively selected WebP/PNG is never tried twice.
    const failedAttempt = selectedAttempt(current, attemptRef.current);
    if (failedAttempt < attemptRef.current) return;
    const nextAttempt = failedAttempt + 1;
    attemptRef.current = nextAttempt;
    decodeSequence.current += 1;
    if (nextAttempt === 3) disarmImage(image);
    setLoaded(false);
    // Removing an earlier unsupported source first can reselect the failed
    // native WebP in WebKit. Remove only the source that actually failed.
    setAttempt((previous) => ({ index: nextAttempt, failed: [...previous.failed, FORMATS[failedAttempt]] }));
  };

  const finishImage = async (image) => {
    const currentAttempt = attemptRef.current;
    if (image !== imageRef.current || currentAttempt === 3 || image.currentSrc?.startsWith('data:')) return;
    const candidate = image.currentSrc;
    if (selectedAttempt(candidate, currentAttempt) < currentAttempt) return;
    const sequence = ++decodeSequence.current;
    const isCurrentRequest = () => image === imageRef.current
      && image.currentSrc === candidate
      && decodeSequence.current === sequence
      && attemptRef.current === currentAttempt;
    try {
      if (typeof image.decode === 'function') await image.decode();
      if (isCurrentRequest()) {
        const selectedIndex = selectedAttempt(candidate, currentAttempt);
        attemptRef.current = selectedIndex;
        setAttempt((previous) => ({ ...previous, index: selectedIndex }));
        setLoaded(true);
      }
    } catch {
      if (isCurrentRequest()) failImage(image);
    }
  };

  return (
    <div
      {...surfaceEvents}
      ref={surfaceRef}
      className={className}
      style={{ ...style, position: 'relative', width: '100%', aspectRatio: `${map.width} / ${map.height}` }}
      data-echi-map={mapId}
      data-map-activation={active ? 'active' : 'waiting'}
      data-map-format={active ? format : 'none'}
      data-map-state={!active ? 'waiting' : format === 'error' ? 'error' : loaded ? 'loaded' : 'loading'}
    >
      {active && measured && (
        <picture style={{ position: 'absolute', inset: 0, display: 'block', visibility: format === 'error' ? 'hidden' : undefined }}>
          {!attempt.failed.includes('avif') && <source type="image/avif" />}
          {!attempt.failed.includes('webp') && <source type="image/webp" />}
          <img
            ref={imageRef}
            alt={alt}
            aria-hidden={format === 'error' || undefined}
            width={map.width}
            height={map.height}
            loading="eager"
            fetchpriority={eager ? 'high' : 'auto'}
            decoding="async"
            draggable={false}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
            onLoad={(event) => { finishImage(event.currentTarget); }}
            onError={(event) => { failImage(event.currentTarget); }}
          />
        </picture>
      )}
      {format === 'error' && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-slate-900/90 p-4 text-center text-slate-100">
          Impossibile caricare {alt}.
        </div>
      )}
      {children}
    </div>
  );
}

export default EchiMapPicture;
