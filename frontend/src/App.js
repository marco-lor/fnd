// file ./frontend/src/App.js # do not remove this line
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import Login from "./components/Login";
import CharacterCreation from "./components/characterCreation/CharacterCreation"; // Import CharacterCreation component
import Home from "./components/home/Home";
import Bazaar from "./components/bazaar/Bazaar";
import DMDashboard from "./components/dmDashboard/DMDashboard"; // DM page
import TecnicheSpell from "./components/tecnicheSpell/TecnicheSpell"; // TecnicheSpell page
import CombatPage from "./components/combatTool/combatPage"; // Combat page
import AdminPage from "./components/admin/adminPage"; // AdminPage
import Codex from "./components/codex/Codex"; // Codex page
import EchiDiViaggio from "./components/echiDiViaggio/EchiDiViaggio"; // Import for Echi di Viaggio page
import Layout from "./components/common/Layout"; // Import our new Layout component
import { AuthProvider, useAuth } from "./AuthContext";
import "./App.css";

// Protected route component for authenticated users that applies the Layout
const AuthenticatedRoute = () => {
  const { user } = useAuth();
  
  if (!user) {
    return <Navigate to="/" />;
  }
  
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
};

// Protected route component for DM-only access
const ProtectedDMRoute = ({ children }) => {
  const { user, userData } = useAuth();
  if (!user || userData?.role !== "dm") {
    return <Navigate to="/home" />;
  }
  return children;
};

// Protected route component for webmaster-only access
const ProtectedWebmasterRoute = ({ children }) => {
  const { user, userData } = useAuth();
  if (!user || userData?.role !== "webmaster") {
    return <Navigate to="/home" />;
  }
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Login />} />
      <Route path="/character-creation" element={<CharacterCreation />} />
      
      {/* Authenticated routes with shared Layout */}
      <Route element={<AuthenticatedRoute />}>
        <Route path="/home" element={<Home />} />
        <Route path="/bazaar" element={<Bazaar />} />
        <Route path="/combat" element={<CombatPage />} />
        <Route path="/tecniche-spell" element={<TecnicheSpell />} />
        <Route path="/codex" element={<Codex />} />
        <Route path="/echi-di-viaggio" element={<EchiDiViaggio />} />
        <Route
          path="/dm-dashboard"
          element={
            <ProtectedDMRoute>
              <DMDashboard />
            </ProtectedDMRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedWebmasterRoute>
              <AdminPage />
            </ProtectedWebmasterRoute>
          }
        />
      </Route>
      
      {/* Redirect any unknown paths to home, or handle 404 */}
      <Route path="*" element={<Navigate to="/home" />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;