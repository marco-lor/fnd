// file ./frontend/src/App.js # do not remove this line
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import Login from "./components/Login";
import CharacterCreation from "./components/characterCreation/CharacterCreation";
import Home from "./components/home/Home";
import Bazaar from "./components/bazaar/Bazaar";
import DMDashboard from "./components/dmDashboard/DMDashboard";
import FoesHub from "./components/foesHub/FoesHub";
import TecnicheSpell from "./components/tecnicheSpell/TecnicheSpell";
import CombatPage from "./components/combatTool/combatPage";
import AdminPage from "./components/admin/adminPage";
import Codex from "./components/codex/Codex";
import EchiDiViaggio from "./components/echiDiViaggio/EchiDiViaggio";
import GrigliataPage from "./components/grigliata/GrigliataPage";
import Layout from "./components/common/Layout";
import {
  AuthProvider,
  BOOTSTRAP_V2_ENABLED,
  useAuthSession,
  useProfileState,
  useShellProfile,
} from "./AuthContext";
import PerformanceProfiler from "./performance/PerformanceProfiler";
import RoutePerformanceObserver from "./performance/RoutePerformanceObserver";
import "./App.css";

const performanceMode = process.env.REACT_APP_FND_PERF === "1";

const PerformanceCleanupRoute = () => (
  performanceMode
    ? <main aria-label="Performance cleanup route" />
    : <Navigate to="/home" />
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
  return BOOTSTRAP_V2_ENABLED && shellProfile ? <Layout>{children}</Layout> : children;
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
      <Layout>
        <Outlet />
      </Layout>
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
      <Route path="/" element={<Login />} />
      <Route path="/character-creation" element={<CharacterCreation />} />
      <Route path="/__fnd_perf_cleanup__" element={<PerformanceCleanupRoute />} />

      <Route element={<AuthenticatedRoute />}>
        <Route path="/home" element={<Home />} />
        <Route path="/bazaar" element={<Bazaar />} />
        <Route path="/combat" element={<CombatPage />} />
        <Route path="/tecniche-spell" element={<TecnicheSpell />} />
        <Route path="/codex" element={<Codex />} />
        <Route path="/echi-di-viaggio" element={<EchiDiViaggio />} />
        <Route path="/grigliata" element={<GrigliataPage />} />
        <Route path="/dm-dashboard" element={<ProtectedDMRoute><DMDashboard /></ProtectedDMRoute>} />
        <Route path="/foes-hub" element={<ProtectedDMRoute><FoesHub /></ProtectedDMRoute>} />
        <Route path="/admin" element={<ProtectedWebmasterRoute><AdminPage /></ProtectedWebmasterRoute>} />
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
