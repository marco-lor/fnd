import { useLayoutEffect, useRef, useState } from 'react';

// Local Echi popup positioning. Coordinates are in the fixed viewport, so an
// open card can leave the map's clipping surface without moving its marker.
export default function useViewportPopup(anchorEl, open, preferredWidth, placement = 'side') {
  const popupRef = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl || !popupRef.current) return undefined;
    const popupEl = popupRef.current;
    const viewport = window.visualViewport;
    const update = () => {
      const padding = 8;
      const gap = 12;
      const viewportWidth = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const minLeft = (viewport?.offsetLeft || 0) + padding;
      const minTop = (viewport?.offsetTop || 0) + padding;
      const width = Math.max(0, Math.min(preferredWidth, viewportWidth - padding * 2));
      const maxHeight = Math.max(0, viewportHeight - padding * 2);
      const height = Math.min(popupEl.getBoundingClientRect().height, maxHeight);
      const anchor = anchorEl.getBoundingClientRect();
      const maxLeft = minLeft + viewportWidth - padding * 2 - width;
      const maxTop = minTop + maxHeight - height;
      let direction = 'right';
      let left = anchor.right + gap;
      let top = anchor.top + anchor.height / 2 - height / 2;
      if (placement === 'above') {
        left = anchor.left + anchor.width / 2 - width / 2;
        top = anchor.top - gap - height;
        if (top < minTop) top = anchor.bottom + gap;
      } else if (left + width > minLeft + viewportWidth - padding * 2) {
        direction = 'left';
        left = anchor.left - gap - width;
      }
      const next = {
        left: Math.max(minLeft, Math.min(left, maxLeft)),
        top: Math.max(minTop, Math.min(top, maxTop)),
        width,
        maxHeight,
        direction,
      };
      setPosition((previous) => previous && Object.keys(next).every((key) => next[key] === previous[key]) ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(popupEl);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [anchorEl, open, preferredWidth, placement]);

  return {
    popupRef,
    direction: position?.direction || 'right',
    popupStyle: {
      position: 'fixed',
      left: position?.left ?? 8,
      top: position?.top ?? 8,
      width: position?.width ?? preferredWidth,
      maxWidth: 'calc(100vw - 16px)',
      maxHeight: position?.maxHeight ?? 'calc(100vh - 16px)',
      overflowY: 'auto',
      overflowWrap: 'anywhere',
      boxSizing: 'border-box',
    },
  };
}
