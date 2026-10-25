// Résolution de l'alias `@/` (jsconfig.json / Vite) pour les tests Node :
// `@/lib/units` → `<racine>/lib/units.js` (ou .jsx). Chargé via
// `node --import ./tests/setup-alias.mjs` dans les scripts npm de test ; les
// tests qui enregistrent leur propre hook restent valides (même règle).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = new URL(`../${specifier.slice(2)}`, import.meta.url);
    // `@/lib/i18n` → lib/i18n/index.js (dossier avec index, comme les bundlers).
    for (const ext of ["", ".js", ".jsx", ".mjs", "/index.js"]) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate)) && ext !== "" || (ext === "" && /\.(m?js|jsx)$/.test(base.href) && existsSync(fileURLToPath(base)))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
