// file ./frontend/src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom"; // BrowserRouter is here!
import { FirebaseProvider } from "./context/FirebaseContext";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <FirebaseProvider>
      <BrowserRouter>  {/* This should be the ONLY BrowserRouter */}
        <App />
      </BrowserRouter>
    </FirebaseProvider>
  </React.StrictMode>
);

reportWebVitals();
