import { createModuleLoader } from '../components/common/lazyLoading';

export const ROUTE_DESCRIPTORS = Object.freeze({
  login: createModuleLoader({
    chunkName: 'route-login',
    importer: () => import(/* webpackChunkName: "route-login" */ '../components/Login'),
  }),
  characterCreation: createModuleLoader({
    chunkName: 'route-character-creation',
    importer: () => import(/* webpackChunkName: "route-character-creation" */ '../components/characterCreation/CharacterCreation'),
  }),
  home: createModuleLoader({
    chunkName: 'route-home',
    importer: () => import(/* webpackChunkName: "route-home" */ '../components/home/Home'),
  }),
  bazaar: createModuleLoader({
    chunkName: 'route-bazaar',
    importer: () => import(/* webpackChunkName: "route-bazaar" */ '../components/bazaar/Bazaar'),
  }),
  combat: createModuleLoader({
    chunkName: 'route-combat',
    importer: () => import(/* webpackChunkName: "route-combat" */ '../components/combatTool/combatPage'),
  }),
  tecnicheSpell: createModuleLoader({
    chunkName: 'route-tecniche-spell',
    importer: () => import(/* webpackChunkName: "route-tecniche-spell" */ '../components/tecnicheSpell/TecnicheSpell'),
  }),
  codex: createModuleLoader({
    chunkName: 'route-codex',
    importer: () => import(/* webpackChunkName: "route-codex" */ '../components/codex/Codex'),
  }),
  echiDiViaggio: createModuleLoader({
    chunkName: 'route-echi-di-viaggio',
    importer: () => import(/* webpackChunkName: "route-echi-di-viaggio" */ '../components/echiDiViaggio/EchiDiViaggio'),
  }),
  grigliata: createModuleLoader({
    chunkName: 'route-grigliata',
    importer: () => import(/* webpackChunkName: "route-grigliata" */ '../components/grigliata/GrigliataPage'),
  }),
  dmDashboard: createModuleLoader({
    chunkName: 'route-dm-dashboard',
    importer: () => import(/* webpackChunkName: "route-dm-dashboard" */ '../components/dmDashboard/DMDashboard'),
  }),
  foesHub: createModuleLoader({
    chunkName: 'route-foes-hub',
    importer: () => import(/* webpackChunkName: "route-foes-hub" */ '../components/foesHub/FoesHub'),
  }),
  admin: createModuleLoader({
    chunkName: 'route-admin',
    importer: () => import(/* webpackChunkName: "route-admin" */ '../components/admin/adminPage'),
  }),
});

export const ROUTE_REGISTRY = Object.freeze([
  { key: 'login', path: '/', public: true, descriptor: ROUTE_DESCRIPTORS.login },
  { key: 'characterCreation', path: '/character-creation', public: true, descriptor: ROUTE_DESCRIPTORS.characterCreation },
  { key: 'home', path: '/home', descriptor: ROUTE_DESCRIPTORS.home },
  { key: 'bazaar', path: '/bazaar', descriptor: ROUTE_DESCRIPTORS.bazaar },
  { key: 'combat', path: '/combat', descriptor: ROUTE_DESCRIPTORS.combat },
  { key: 'tecnicheSpell', path: '/tecniche-spell', descriptor: ROUTE_DESCRIPTORS.tecnicheSpell },
  { key: 'codex', path: '/codex', descriptor: ROUTE_DESCRIPTORS.codex },
  { key: 'echiDiViaggio', path: '/echi-di-viaggio', descriptor: ROUTE_DESCRIPTORS.echiDiViaggio },
  { key: 'grigliata', path: '/grigliata', descriptor: ROUTE_DESCRIPTORS.grigliata },
  { key: 'dmDashboard', path: '/dm-dashboard', roles: ['dm'], descriptor: ROUTE_DESCRIPTORS.dmDashboard },
  { key: 'foesHub', path: '/foes-hub', roles: ['dm'], descriptor: ROUTE_DESCRIPTORS.foesHub },
  { key: 'admin', path: '/admin', roles: ['webmaster'], descriptor: ROUTE_DESCRIPTORS.admin },
]);

const ROUTE_BY_PATH = new Map(ROUTE_REGISTRY.map((route) => [route.path, route]));

export const getRouteDescriptor = (path) => ROUTE_BY_PATH.get(path)?.descriptor || null;

export const prefetchRoute = (path, role) => {
  const route = ROUTE_BY_PATH.get(path);
  if (!route || route.public) return Promise.resolve(null);
  if (route.roles && !route.roles.includes(role)) return Promise.resolve(null);
  return route.descriptor.preload();
};

