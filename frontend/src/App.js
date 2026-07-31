// file ./frontend/src/App.js # do not remove this line
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { createModuleLoader, RetryableLazyBoundary } from "./components/common/lazyLoading";
import {
  AuthProvider,
  BOOTSTRAP_V2_ENABLED,
  useAuthSession,
  useProfileState,
  useShellProfile,
} from "./AuthContext";
import PerformanceProfiler from "./performance/PerformanceProfiler";
import RoutePerformanceObserver from "./performance/RoutePerformanceObserver";
import { ROUTE_DESCRIPTORS } from "./routes/routeRegistry";
import "./App.css";

const performanceMode = process.env.REACT_APP_FND_PERF === "1";

const firestorePersistenceExperimentDescriptor = process.env.REACT_APP_FND_PERF === "1"
  ? createModuleLoader({
    chunkName: 'perf-firestore-persistence-experiment',
    importer: () => import(
      /* webpackChunkName: "perf-firestore-persistence-experiment" */
      './performance/FirestorePersistenceExperiment'
    ),
  })
  : null;

const authenticatedLayoutDescriptor = createModuleLoader({
  chunkName: 'feature-authenticated-layout',
  importer: () => import(/* webpackChunkName: "feature-authenticated-layout" */ './components/common/Layout'),
});

const AuthenticatedLayout = ({ children }) => (
  <RetryableLazyBoundary
    descriptor={authenticatedLayoutDescriptor}
    fallbackLabel="Loading application layout..."
    variant="route"
    componentProps={{ children }}
  />
);

const PerformanceCleanupRoute = () => (
  performanceMode
    ? <main aria-label="Performance cleanup route" />
    : <Navigate to="/home" />
);

const RoutePage = ({ descriptor, label }) => (
  <RetryableLazyBoundary
    descriptor={descriptor}
    fallbackLabel={`Loading ${label}...`}
    variant="route"
    retryResetKey={descriptor.chunkName}
  />
);

const StatusPanel = ({ title, message, onRetry, onLogout }) => (
  <main className="flex min-h-screen items-center justify-center px-6 text-white" aria-live="polite">
    <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/80 p-8 text-center shadow-2xl">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-slate-300">{message}</p>
      {(onRetry || onLogout) ? (
        <div className="mt-6 flex justify-center gap-3">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="rounded-xl border border-cyan-300/50 px-4 py-2 text-cyan-100">
              Retry
            </button>
          ) : null}
          {onLogout ? (
            <button type="button" onClick={onLogout} className="rounded-xl border border-red-300/50 px-4 py-2 text-red-100">
              Logout
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  </main>
);

const AuthenticatedStatus = ({ children }) => {
  const { shellProfile } = useShellProfile();
  return BOOTSTRAP_V2_ENABLED && shellProfile ? <AuthenticatedLayout>{children}</AuthenticatedLayout> : children;
};

export const AuthenticatedRoute = () => {
  const { user, authReady, authStatus, logout } = useAuthSession();
  const { profileStatus, profileFresh, retryProfile } = useProfileState();

  if (!authReady) {
    return <StatusPanel title="Checking your session" message="Confirming your authenticated session…" />;
  }
  if (authStatus === "error") {
    return <StatusPanel title="Session unavailable" message="Unable to confirm your session. Reload the application to try again." />;
  }
  if (!user) return <Navigate to="/" />;

  if (profileFresh) {
    return (
      <AuthenticatedLayout>
        <Outlet />
      </AuthenticatedLayout>
    );
  }

  if (profileStatus === "missing") {
    return (
      <AuthenticatedStatus>
        <StatusPanel
          title="Profile unavailable"
          message="Your authenticated account does not have an available character profile."
          onRetry={retryProfile}
          onLogout={logout}
        />
      </AuthenticatedStatus>
    );
  }

  if (profileStatus === "error") {
    return (
      <AuthenticatedStatus>
        <StatusPanel
          title="Profile refresh failed"
          message="Cached shell details may be visible, but protected content remains locked until the live profile is refreshed."
          onRetry={retryProfile}
          onLogout={logout}
        />
      </AuthenticatedStatus>
    );
  }

  return (
    <AuthenticatedStatus>
      <StatusPanel title="Refreshing your profile" message="Loading the latest character and permissions…" />
    </AuthenticatedStatus>
  );
};

export const ProtectedDMRoute = ({ children }) => {
  const { user } = useAuthSession();
  const { shellProfile, shellProfileFresh } = useShellProfile();
  if (!user || !shellProfileFresh || shellProfile?.role !== "dm") {
    return <Navigate to="/home" />;
  }
  return children;
};

export const ProtectedWebmasterRoute = ({ children }) => {
  const { user } = useAuthSession();
  const { shellProfile, shellProfileFresh } = useShellProfile();
  if (!user || !shellProfileFresh || shellProfile?.role !== "webmaster") {
    return <Navigate to="/home" />;
  }
  return children;
};

export function AppRoutes() {
  const { authReady, authStatus, retryAuth } = useAuthSession();

  if (!authReady) {
    return <StatusPanel title="Checking your session" message="Confirming your authenticated session…" />;
  }
  if (authStatus === "error") {
    return (
      <StatusPanel
        title="Session unavailable"
        message="The application could not confirm your session."
        onRetry={retryAuth}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.login} label="Login" />} />
      <Route path="/character-creation" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.characterCreation} label="Character Creation" />} />
      <Route path="/__fnd_perf_cleanup__" element={<PerformanceCleanupRoute />} />
      {process.env.REACT_APP_FND_PERF === "1" ? (
        <Route
          path="/__fnd_perf_firestore_persistence__"
          element={<RoutePage descriptor={firestorePersistenceExperimentDescriptor} label="Firestore persistence experiment" />}
        />
      ) : null}

      <Route element={<AuthenticatedRoute />}>
        <Route path="/home" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.home} label="Home" />} />
        <Route path="/bazaar" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.bazaar} label="Bazaar" />} />
        <Route path="/combat" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.combat} label="Combat" />} />
        <Route path="/tecniche-spell" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.tecnicheSpell} label="Tecniche and Spell" />} />
        <Route path="/codex" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.codex} label="Codex" />} />
        <Route path="/echi-di-viaggio" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.echiDiViaggio} label="Echi di Viaggio" />} />
        <Route path="/grigliata" element={<RoutePage descriptor={ROUTE_DESCRIPTORS.grigliata} label="Grigliata" />} />
        <Route path="/dm-dashboard" element={<ProtectedDMRoute><RoutePage descriptor={ROUTE_DESCRIPTORS.dmDashboard} label="DM Dashboard" /></ProtectedDMRoute>} />
        <Route path="/foes-hub" element={<ProtectedDMRoute><RoutePage descriptor={ROUTE_DESCRIPTORS.foesHub} label="Foes Hub" /></ProtectedDMRoute>} />
        <Route path="/admin" element={<ProtectedWebmasterRoute><RoutePage descriptor={ROUTE_DESCRIPTORS.admin} label="Admin" /></ProtectedWebmasterRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/home" />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <RoutePerformanceObserver />
      <PerformanceProfiler id="route">
        <AppRoutes />
      </PerformanceProfiler>
    </AuthProvider>
  );
}

export default App;
