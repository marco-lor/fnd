import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthSession, useShellProfile } from '../AuthContext';
import {
  isPerformanceEnabled,
  markRouteEffectsMounted,
  markRouteShellVisible,
  startRouteMeasurement,
} from './runtime';

export default function RoutePerformanceObserver() {
  const location = useLocation();
  const { authReady } = useAuthSession();
  const { shellProfile } = useShellProfile();
  const role = shellProfile?.role || (location.pathname === '/' ? 'anonymous' : 'unknown');

  useLayoutEffect(() => {
    if (!isPerformanceEnabled()) return;
    startRouteMeasurement(location.pathname, role);
    markRouteShellVisible();
  }, [location.pathname, role]);

  useEffect(() => {
    if (!isPerformanceEnabled() || !authReady) return;
    const frameId = requestAnimationFrame(() => markRouteEffectsMounted());
    return () => cancelAnimationFrame(frameId);
  }, [authReady, location.pathname, role]);

  return null;
}
