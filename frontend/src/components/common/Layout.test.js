import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';
import { useAuthSession, useShellProfile } from '../../AuthContext';

jest.mock('react-router-dom', () => {
  const React = require('react');
  const RouterContext = React.createContext({
    location: {
      hash: '',
      pathname: '/home',
      search: '',
    },
    navigate: () => {},
  });

  const MemoryRouter = ({ children, initialEntries = ['/home'] }) => {
    const [pathname, setPathname] = React.useState(initialEntries[0] || '/home');
    const location = React.useMemo(() => ({
      hash: '',
      pathname,
      search: '',
    }), [pathname]);
    const value = React.useMemo(() => ({
      location,
      navigate: (nextPath) => setPathname(nextPath),
    }), [location]);

    return (
      <RouterContext.Provider value={value}>
        {children}
      </RouterContext.Provider>
    );
  };

  const NavLink = ({ 'aria-label': ariaLabel, children, className, onClick, title, to }) => {
    const { location, navigate } = React.useContext(RouterContext);
    const isActive = location.pathname === to;
    const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className;

    return (
      <a
        href={to}
        className={resolvedClassName}
        aria-label={ariaLabel}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          onClick?.(event);
          navigate(to);
        }}
      >
        {children}
      </a>
    );
  };

  return {
    MemoryRouter,
    NavLink,
    useLocation: () => React.useContext(RouterContext).location,
    useNavigate: () => React.useContext(RouterContext).navigate,
  };
}, { virtual: true });

jest.mock('../../AuthContext', () => ({
  useAuthSession: jest.fn(),
  useShellProfile: jest.fn(),
}));

jest.mock('../backgrounds/GlobalAuroraBackground', () => () => <div data-testid="global-aurora-background" />);
jest.mock('../grigliata/GlobalGrigliataMusicPlayer', () => () => <div data-testid="global-grigliata-music-player" />);

jest.mock('../firebaseConfig', () => ({
  auth: {},
  db: {},
  storage: {},
}));
jest.mock('../firebaseStorage', () => ({ storage: {} }));

jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(() => Promise.resolve()),
  getDownloadURL: jest.fn(() => Promise.resolve('https://example.com/avatar.png')),
  ref: jest.fn((storage, path) => ({ storage, path })),
  uploadBytes: jest.fn(() => Promise.resolve()),
}));

jest.mock('firebase/firestore', () => ({
  deleteDoc: jest.fn(() => Promise.resolve()),
  doc: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
  updateDoc: jest.fn(() => Promise.resolve()),
}));

const buildAuthState = (role = 'dm') => ({
  user: {
    uid: 'user-1',
    email: 'marco@example.com',
  },
  userData: {
    characterId: 'MarcoDM',
    imagePath: 'characters/marco_avatar',
    imageUrl: 'https://example.com/avatar.png',
    race: 'Goblin',
    role,
    stats: {
      level: 7,
    },
  },
});

const logout = jest.fn(() => Promise.resolve());

const setAuthState = (role = 'dm') => {
  const state = buildAuthState(role);
  useAuthSession.mockReturnValue({
    user: state.user,
    logout,
    getCurrentProfile: () => state.userData,
  });
  useShellProfile.mockReturnValue({
    shellProfile: {
      role: state.userData.role,
      characterId: state.userData.characterId,
      race: state.userData.race,
      level: state.userData.stats.level,
      avatarUrl: state.userData.imageUrl,
    },
  });
};

const setDesktopMatch = (matches) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: matches ? 1440 : 768,
    writable: true,
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
};

const renderLayout = (initialEntries = ['/home']) => render(
  <MemoryRouter initialEntries={initialEntries}>
    <Layout>
      <div data-testid="layout-child">Layout child</div>
    </Layout>
  </MemoryRouter>
);

describe('Layout shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setAuthState('dm');
    logout.mockClear().mockResolvedValue(undefined);

    const firestore = require('firebase/firestore');
    firestore.deleteDoc.mockClear().mockResolvedValue(undefined);
    firestore.doc.mockClear().mockImplementation((db, ...segments) => ({ path: segments.join('/') }));
    firestore.getDoc.mockClear().mockResolvedValue({ exists: () => false });
    firestore.updateDoc.mockClear().mockResolvedValue(undefined);
  });

  test('renders role-gated navigation items for desktop roles', () => {
    setDesktopMatch(true);

    const { rerender } = renderLayout();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveClass('custom-scroll');

    expect(screen.getByText('DM Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Foes Hub')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();

    setAuthState('webmaster');

    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Layout>
          <div data-testid="layout-child">Layout child</div>
        </Layout>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('DM Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Foes Hub')).not.toBeInTheDocument();
  });

  test('persists desktop collapse state across remounts', () => {
    setDesktopMatch(true);

    const { unmount } = renderLayout();

    fireEvent.click(screen.getByTestId('layout-sidebar-toggle'));

    expect(window.localStorage.getItem('layout.sidebarCollapsed')).toBe('true');
    expect(screen.getByTitle('Expand navigation')).toBeInTheDocument();
    expect(screen.getByText('Bazaar')).toHaveClass('opacity-0');

    unmount();
    renderLayout();

    expect(window.localStorage.getItem('layout.sidebarCollapsed')).toBe('true');
    expect(screen.getByTitle('Expand navigation')).toBeInTheDocument();
    expect(screen.getByText('Bazaar')).toHaveClass('opacity-0');
  });

  test('opens and closes the mobile drawer via backdrop, escape, and navigation', async () => {
    setDesktopMatch(false);

    renderLayout();

    const drawer = screen.getByTestId('mobile-nav-drawer');
    expect(drawer.className).toContain('-translate-x-full');

    fireEvent.click(screen.getByTestId('mobile-nav-trigger'));
    expect(drawer.className).toContain('translate-x-0');

    fireEvent.click(screen.getByTestId('mobile-nav-backdrop'));
    await waitFor(() => expect(drawer.className).toContain('-translate-x-full'));

    fireEvent.click(screen.getByTestId('mobile-nav-trigger'));
    expect(drawer.className).toContain('translate-x-0');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(drawer.className).toContain('-translate-x-full'));

    fireEvent.click(screen.getByTestId('mobile-nav-trigger'));
    expect(drawer.className).toContain('translate-x-0');

    fireEvent.click(screen.getByRole('link', { name: 'Bazaar' }));
    await waitFor(() => expect(drawer.className).toContain('-translate-x-full'));
  });

  test('clears Grigliata page presence before signing out from Grigliata', async () => {
    setDesktopMatch(true);
    setAuthState('player');
    const firestore = require('firebase/firestore');
    firestore.getDoc.mockResolvedValue({ exists: () => true });

    renderLayout(['/grigliata']);

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });

    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(),
      'grigliata_page_presence',
      'user-1'
    );
    expect(firestore.getDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_page_presence/user-1' })
    );
    expect(firestore.deleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_page_presence/user-1' })
    );
    expect(firestore.deleteDoc.mock.invocationCallOrder[0]).toBeLessThan(
      logout.mock.invocationCallOrder[0]
    );
  });

  test('does not query Grigliata page presence when logging out elsewhere', async () => {
    setDesktopMatch(true);
    setAuthState('player');
    const firestore = require('firebase/firestore');

    renderLayout(['/home']);

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
    });

    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });
});
