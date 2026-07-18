// file ./frontend/src/index.js # do not remove this line
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom"; // BrowserRouter is here!
import { FirebaseProvider } from "./context/FirebaseContext";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import {
  installPerformanceRuntime,
  isPerformanceEnabled,
  recordPerfEvent,
} from "./performance/runtime";
import { installGrigliataBenchmarkBridge } from "./performance/grigliataBenchmarks";

installPerformanceRuntime();
if (process.env.REACT_APP_FND_PERF === '1') installGrigliataBenchmarkBridge();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <FirebaseProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </FirebaseProvider>
  </React.StrictMode>
);

if (isPerformanceEnabled()) {
  reportWebVitals((metric) => {
    recordPerfEvent({
      category: "web-vital",
      metric: metric.name,
      value: metric.value,
      unit: metric.name === "CLS" ? "score" : "ms",
      tags: { rating: metric.rating, navigationType: metric.navigationType },
    });
  });
}
