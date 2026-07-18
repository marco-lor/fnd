import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  isPerformanceEnabled,
  markRouteEffectsMounted,
  markRouteShellVisible,
  startRouteMeasurement,
} from './runtime';

export default function RoutePerformanceObserver() {
  const location = useLocation();
  const { userData } = useAuth();
  const role = userData?.role || (location.pathname === '/' ? 'anonymous' : 'unknown');

  useLayoutEffect(() => {
    if (!isPerformanceEnabled()) return;
    startRouteMeasurement(location.pathname, role);
    markRouteShellVisible();
  }, [location.pathname, role]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => markRouteEffectsMounted());
    return () => cancelAnimationFrame(frameId);
  }, [location.pathname, role]);

  return null;
}
