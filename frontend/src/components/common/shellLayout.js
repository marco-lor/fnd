import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DESKTOP_MEDIA_QUERY = '(min-width: 1280px)';
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'layout.sidebarCollapsed';
const SHELL_DIMENSIONS = {
  expandedWidth: 256,
  collapsedWidth: 88,
  mobileDrawerWidth: 256,
  mobileTopInset: 72,
};

const noop = () => {};

const ShellLayoutContext = createContext({
  closeMobileNav: noop,
  isDesktop: false,
  isMobileNavOpen: false,
  isNavCollapsed: false,
  navInlineSize: 0,
  openMobileNav: noop,
  topInset: SHELL_DIMENSIONS.mobileTopInset,
  toggleNav: noop,
});

const readDesktopMatch = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  }

  return window.innerWidth >= 1280;
};

const readStoredCollapseState = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === 'true';
  } catch (error) {
    return false;
  }
};

export const ShellLayoutProvider = ({ children }) => {
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(readDesktopMatch);
  const [isNavCollapsed, setIsNavCollapsed] = useState(readStoredCollapseState);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (typeof window.matchMedia !== 'function') {
      const handleResize = () => setIsDesktop(readDesktopMatch());
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleMediaQueryChange = (event) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaQueryChange);
      return () => mediaQuery.removeEventListener('change', handleMediaQueryChange);
    }

    mediaQuery.addListener(handleMediaQueryChange);
    return () => mediaQuery.removeListener(handleMediaQueryChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(isNavCollapsed));
    } catch (error) {
      // Ignore localStorage failures so layout state still works in-memory.
    }
  }, [isNavCollapsed]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (isDesktop) {
      setIsMobileNavOpen(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobileNavOpen]);

  const value = useMemo(() => {
    const navInlineSize = isDesktop
      ? (isNavCollapsed ? SHELL_DIMENSIONS.collapsedWidth : SHELL_DIMENSIONS.expandedWidth)
      : 0;
    const topInset = isDesktop ? 0 : SHELL_DIMENSIONS.mobileTopInset;

    return {
      closeMobileNav: () => setIsMobileNavOpen(false),
      dimensions: SHELL_DIMENSIONS,
      isDesktop,
      isMobileNavOpen,
      isNavCollapsed,
      navInlineSize,
      openMobileNav: () => setIsMobileNavOpen(true),
      topInset,
      toggleNav: () => setIsNavCollapsed((currentValue) => !currentValue),
    };
  }, [isDesktop, isMobileNavOpen, isNavCollapsed]);

  return (
    <ShellLayoutContext.Provider value={value}>
      {children}
    </ShellLayoutContext.Provider>
  );
};

export const useShellLayout = () => useContext(ShellLayoutContext);
