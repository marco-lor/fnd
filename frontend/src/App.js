import React from "react";
import { Routes, Route } from "react-router-dom";
import Login from "./components/Login";
import Home from "./components/Home";
import Bazaar from "./components/Bazaar";
import "./App.css";
import { AuthProvider } from "./AuthContext";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/bazaar" element={<Bazaar />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
