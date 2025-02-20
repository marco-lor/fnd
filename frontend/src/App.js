/* file: ./frontend/src/App.js */
import React from "react";
import { Routes, Route } from "react-router-dom";  // No BrowserRouter here!
import Login from "./components/Login";
import Home from "./components/Home";
import Bazaar from "./components/Bazaar";
import "./App.css";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/home" element={<Home />} />
      <Route
        path="/bazaar" element={<Bazaar />}
      />
    </Routes>
  );
}

export default App;
