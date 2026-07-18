// file ./frontend/src/index.js # do not remove this line
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import BootstrapScreen from "./BootstrapScreen";
import { initializeFirebase } from "./components/firebaseConfig";
import reportWebVitals from "./reportWebVitals";
import {
  installPerformanceRuntime,
  isPerformanceEnabled,
  recordPerfEvent,
} from "./performance/runtime";
import { installGrigliataBenchmarkBridge } from "./performance/grigliataBenchmarks";

installPerformanceRuntime();
if (process.env.REACT_APP_FND_PERF === "1") installGrigliataBenchmarkBridge();

const root = ReactDOM.createRoot(document.getElementById("root"));
let bootstrapAttempt = 0;

const renderBootstrap = (phase, onRetry) => {
  root.render(<BootstrapScreen phase={phase} onRetry={onRetry} />);
};

const startApplication = async () => {
  const attempt = ++bootstrapAttempt;

  try {
    await initializeFirebase({
      onPhase: (phase) => {
        if (attempt === bootstrapAttempt) renderBootstrap(phase);
      },
    });

    if (attempt !== bootstrapAttempt) return;
    renderBootstrap("app-loading");
    const { default: App } = await import("./App");
    if (attempt !== bootstrapAttempt) return;

    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>
    );
  } catch (_error) {
    if (attempt !== bootstrapAttempt) return;
    renderBootstrap("error", startApplication);
  }
};

startApplication();

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
