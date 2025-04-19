import React from 'react';
import Navbar from './navbar';

/**
 * Layout component that wraps page content and includes the navbar
 * This pattern centralizes the navbar logic and improves performance
 * by avoiding duplicate Firestore listeners across pages
 */
const Layout = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow">
        {children}
      </main>
    </div>
  );
};

export default Layout;