// Build de l'app embarquée (carnet local). Racine = ce dossier ; le code
// partagé avec le site (lib/, app/components/) est atteint par l'alias `@/`
// pointant sur la racine du dépôt, exactement comme dans Next (jsconfig.json).
// Les imports `next/link` et `next/navigation` des composants réutilisés sont
// redirigés vers de petits équivalents sur routeur à ancre (src/shims/).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Commit embarqué, affiché dans « Sauvegarde et données » : sans ça, personne
// ne peut dire quel APK tourne sur le téléphone (leçon du 02/08 côté site).
// En CI : GITHUB_SHA ; en local : git.
function buildCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}

export default defineConfig({
  root: here,
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_COMMIT": JSON.stringify(buildCommit()),
    "import.meta.env.VITE_APP_BUILT_AT": JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"),
  },
  resolve: {
    alias: {
      "@": repoRoot,
      "next/link": path.join(here, "src/shims/next-link.jsx"),
      "next/navigation": path.join(here, "src/shims/next-navigation.js"),
    },
  },
  server: { port: 4317, strictPort: true, fs: { allow: [repoRoot] } },
  preview: { port: 4317, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
    rollupOptions: {
      onwarn(warning, warn) {
        // Les fichiers partagés portent "use client" (directive Next) : sans
        // effet ici, inutile de l'afficher à chaque build.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
