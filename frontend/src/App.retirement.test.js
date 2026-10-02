import React from 'react';
import { render, screen } from '@testing-library/react';

let mockSignedIn = true;

// CRA's Jest resolver predates the router package's exports map. Use the same
// installed router implementation through its existing CommonJS build.
jest.mock('react-router-dom', () => require('../node_modules/react-router/dist/development/index.js'), { virtual: true });

jest.mock('./AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  BOOTSTRAP_V2_ENABLED: true,
  useAuthSession: () => ({ user: mockSignedIn ? { uid: 'player' } : null, authReady: true, authStatus: mockSignedIn ? 'authenticated' : 'anonymous' }),
  useProfileState: () => ({ profileFresh: true, profileStatus: 'fresh' }),
  useShellProfile: () => ({ shellProfileFresh: true, shellProfile: { role: 'player' } }),
}));

jest.mock('./components/common/lazyLoading', () => ({
  ...jest.requireActual('./components/common/lazyLoading'),
  RetryableLazyBoundary: ({ descriptor, componentProps }) => descriptor.chunkName === 'feature-authenticated-layout'
    ? <>{componentProps.children}</>
    : <main>{descriptor.chunkName}</main>,
}));

const { TextEncoder, TextDecoder } = require('util');
Object.assign(global, { TextEncoder, TextDecoder });
const { MemoryRouter, useLocation, useNavigate } = require('react-router-dom');
const { AppRoutes } = require('./App');
const { ROUTE_DESCRIPTORS, ROUTE_REGISTRY, getRouteDescriptor, prefetchRoute } = require('./routes/routeRegistry');

const LocationProbe = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate(-1)}>Back</button></>;
};

test.each([true, false])('direct retired Combat link follows auth guard (signed in: %s)', async signedIn => {
  mockSignedIn = signedIn;
  render(<MemoryRouter initialEntries={['/combat']}><AppRoutes /><LocationProbe /></MemoryRouter>);
  expect(await screen.findByText(signedIn ? 'route-home' : 'route-login')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent(signedIn ? '/home' : '/');
  expect(screen.queryByText('route-combat')).not.toBeInTheDocument();
});

test('retired redirect replaces the bookmarked entry in history', async () => {
  mockSignedIn = true;
  const { fireEvent } = require('@testing-library/react');
  render(<MemoryRouter initialEntries={['/bazaar', '/combat']} initialIndex={1}><AppRoutes /><LocationProbe /></MemoryRouter>);
  expect(await screen.findByText('route-home')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText('route-bazaar')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/bazaar');
});

test('retired route has no registry entry, importer or preload', async () => {
  expect(ROUTE_DESCRIPTORS.combat).toBeUndefined();
  expect(ROUTE_REGISTRY.some(route => route.path === '/combat')).toBe(false);
  expect(getRouteDescriptor('/combat')).toBeNull();
  expect(await prefetchRoute('/combat', 'dm')).toBeNull();
  expect(getRouteDescriptor('/grigliata')).toBe(ROUTE_DESCRIPTORS.grigliata);
});
