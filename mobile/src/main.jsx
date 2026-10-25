// Point d'entrée de l'app embarquée. En mode web (développement et tests
// Playwright), SQLite tourne dans le navigateur via le composant <jeep-sqlite>
// (sql.js en wasm, persistance IndexedDB) ; il est chargé à la demande pour ne
// pas peser dans l'APK, où le plugin natif prend le relais.
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import "@/app/globals.css";
import "./theme.css";
import { applyStoredTheme } from "./platform/theme.js";
import { installErrorCapture } from "./platform/diagnostics.js";
import App from "./App.jsx";

async function boot() {
  installErrorCapture();
  applyStoredTheme();
  if (!Capacitor.isNativePlatform()) {
    const { defineCustomElements } = await import("jeep-sqlite/loader");
    defineCustomElements(window);
    const el = document.createElement("jeep-sqlite");
    el.setAttribute("wasmPath", "assets");
    document.body.appendChild(el);
    await customElements.whenDefined("jeep-sqlite");
  }
  createRoot(document.getElementById("root")).render(<App />);
}

boot();
