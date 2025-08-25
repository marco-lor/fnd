import React from 'react';
import Navbar from './navbar';
import GlobalAuroraBackground from '../backgrounds/GlobalAuroraBackground';

/**
 * Layout component that wraps page content and includes the navbar
 * This pattern centralizes the navbar logic and improves performance
 * by avoiding duplicate Firestore listeners across pages
 */
const Layout = ({ children }) => {
  return (
    <div className="relative min-h-screen flex flex-col">
      <GlobalAuroraBackground density={140} />
      <Navbar />
      <main className="relative z-10 flex-grow">
        {children}
      </main>
    </div>
  );
};

export default Layout;