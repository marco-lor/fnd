import React from 'react';
import Navbar from './navbar';
import GlobalAuroraBackground from '../backgrounds/GlobalAuroraBackground';
import GlobalGrigliataMusicPlayer from '../grigliata/GlobalGrigliataMusicPlayer';
import { ShellLayoutProvider, useShellLayout } from './shellLayout';

/**
 * Layout component that wraps page content and includes the navbar
 * This pattern centralizes the navbar logic and improves performance
 * by avoiding duplicate Firestore listeners across pages
 */
const LayoutScaffold = ({ children }) => {
  const { navInlineSize, topInset } = useShellLayout();

  return (
    <div
      className="relative min-h-screen text-white"
      style={{
        '--app-shell-nav-width': `${navInlineSize}px`,
        '--app-shell-top-inset': `${topInset}px`,
      }}
    >
      <GlobalAuroraBackground density={140} />
      <GlobalGrigliataMusicPlayer />
      <div className="relative z-10 flex min-h-screen flex-col transition-[grid-template-columns] duration-[280ms] ease-out motion-reduce:transition-none xl:grid xl:grid-cols-[var(--app-shell-nav-width)_minmax(0,1fr)]">
        <Navbar />
        <main className="relative min-w-0 flex-1 xl:min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
};

const Layout = ({ children }) => (
  <ShellLayoutProvider>
    <LayoutScaffold>{children}</LayoutScaffold>
  </ShellLayoutProvider>
);

export default Layout;
