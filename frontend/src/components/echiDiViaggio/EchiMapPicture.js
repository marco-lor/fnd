import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import maps from '../../assets/images/maps/generated/sources';

// Echi's two-column layout: 18rem sidebar + 1rem gap + 2rem page/card padding.
const MAP_SIZES = '(min-width: 1024px) calc(100vw - 21rem), calc(100vw - 2rem)';
const srcSet = (variants) => variants.map(({ url, width }) => `${url} ${width}w`).join(', ');

function EchiMapPicture({ mapId, alt, eager = false, children, className = '', style, ...surfaceEvents }) {
  const map = maps[mapId];
  const surfaceRef = useRef(null);
  const imageRef = useRef(null);
  const failedImages = useRef(new WeakSet());
  const [active, setActive] = useState(eager);
  const [format, setFormat] = useState('avif');
  const [loaded, setLoaded] = useState(false);

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
    if (active && image?.isConnected && !image.hasAttribute('src')) image.src = map.original;
  }, [active, format, map.original]);

  const failImage = (image) => {
    if (image !== imageRef.current || failedImages.current.has(image)) return;
    failedImages.current.add(image);
    const current = image.currentSrc || '';
    // Native picture can skip unsupported formats. Advance from the URL that
    // actually failed, so a natively selected WebP/PNG is never tried twice.
    const failedFormat = /\.png(?:[?#]|$)/i.test(current) ? 'png'
      : /\.webp(?:[?#]|$)/i.test(current) ? 'webp'
        : format;
    setLoaded(false);
    setFormat(failedFormat === 'avif' ? 'webp' : failedFormat === 'webp' ? 'png' : 'error');
  };

  const finishImage = async (image) => {
    try {
      if (typeof image.decode === 'function') await image.decode();
      if (image === imageRef.current && !failedImages.current.has(image)) setLoaded(true);
    } catch {
      failImage(image);
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
      {active && format !== 'error' && (
        <picture key={format} style={{ position: 'absolute', inset: 0, display: 'block' }}>
          {format === 'avif' && <source type="image/avif" srcSet={srcSet(map.avif)} sizes={MAP_SIZES} />}
          {(format === 'avif' || format === 'webp') && <source type="image/webp" srcSet={srcSet(map.webp)} sizes={MAP_SIZES} />}
          <img
            ref={imageRef}
            alt={alt}
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
