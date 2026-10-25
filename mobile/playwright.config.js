// Suite Playwright de l'app embarquée, en MODE WEB (jeep-sqlite / IndexedDB).
// Elle prouve le comportement de l'application (zéro requête externe,
// persistance après rechargement, export/restauration, migration interrompue)
// sur le même code que l'APK, mais pas la durabilité du SQLite Android : celle-ci
// se vérifie sur l'appareil (docs/MOBILE-CAPACITOR.md).
import { defineConfig, devices } from "@playwright/test";

const PORT = 4318;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Pixel 7"],
    locale: "fr-CH",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    // Build dédié avec les crochets de test (VITE_TEST_HOOKS), servi statiquement.
    // Gemini et le kDrive ne sont appelés qu'avec une clé ou un jeton : connected.spec.js
    // les pose et intercepte ces requêtes, aucune n'atteint les vrais services.
    command: `node mobile/scripts/copy-wasm.mjs && VITE_TEST_HOOKS=1 npx vite build --config mobile/vite.config.js --outDir dist-test && npx vite preview --config mobile/vite.config.js --outDir dist-test --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: "..",
    port: PORT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
