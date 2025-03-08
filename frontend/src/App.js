// file ./frontend/src/App.js # do not remove this line
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./components/Login";
import Home from "./components/Home";
import Bazaar from "./components/Bazaar";
import DMDashboard from "./components/DMDashboard"; // New DM page
import TecnicheSpell from "./components/TecnicheSpell"; // New import for TecnicheSpell
import { AuthProvider, useAuth } from "./AuthContext";
import "./App.css";

// Protected route component for DM-only access
const ProtectedDMRoute = ({ children }) => {
  const { user, userData } = useAuth();
  if (!user || userData?.role !== "dm") {
    return <Navigate to="/home" />;
  }
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/home" element={<Home />} />
      <Route path="/bazaar" element={<Bazaar />} />
      <Route path="/tecniche-spell" element={<TecnicheSpell />} /> {/* New route */}
      <Route
        path="/dm-dashboard"
        element={
          <ProtectedDMRoute>
            <DMDashboard />
          </ProtectedDMRoute>
        }
      />
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
