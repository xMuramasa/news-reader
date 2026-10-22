import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applySettings, getSettings, watchSettings } from "./lib/settings.ts";
import { watchReadState } from "./lib/read-state.ts";
import "./index.css";

// theme-init.js already set these before first paint; this keeps them in sync from here on.
applySettings(document.documentElement, getSettings());
watchSettings();
watchReadState();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
