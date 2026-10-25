// Garde-fou du build : les seuls hôtes distants que le bundle embarqué peut
// nommer sont ceux de l'usage personnel (23/10) — Gemini (recettes IA, avec la
// clé collée dans Paramètres) et l'API kDrive d'Infomaniak (copies du carnet) —
// plus quelques URL inertes de documentation présentes dans les bibliothèques
// (React, W3C…) et la page des clés Gemini, ouverte dans le navigateur. Tout
// autre hôte (Supabase, fermpal.com, Sentry, Vercel, Creem…) fait échouer le
// build : sans clé ni kDrive relié, le carnet ne parle à personne.
//
// Usage : node mobile/scripts/check-hosts.mjs [dossier dist]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = process.argv[2] || path.join(here, "..", "dist");

const allowed = new Set(
  [
    "generativelanguage.googleapis.com",
    "api.infomaniak.com",
    "aistudio.google.com",
    // Liens de documentation inertes dans le code des bibliothèques (React, et
    // — mode web seulement, absent de l'APK — jeep-sqlite/Stencil).
    "www.w3.org",
    "react.dev",
    "reactjs.org",
    "github.com",
    "mozilla.github.io",
    "stuk.github.io",
    "stenciljs.com",
    "chat.stenciljs.com",
  ].map((h) => h.toLowerCase()),
);

const found = new Map();
for (const file of readdirSync(path.join(dist, "assets"))) {
  if (!/\.(js|css|html)$/.test(file)) continue;
  const text = readFileSync(path.join(dist, "assets", file), "utf8");
  for (const m of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[/"'`\s)?#:]|$)/gi)) {
    const host = m[1].toLowerCase();
    if (!found.has(host)) found.set(host, new Set());
    found.get(host).add(file);
  }
}

const unexpected = [...found].filter(([host]) => !allowed.has(host));
if (unexpected.length) {
  console.error("Hôtes distants inattendus dans le bundle :");
  for (const [host, files] of unexpected) console.error(`  ${host}  (${[...files].join(", ")})`);
  process.exit(1);
}
console.log(`hôtes du bundle : ${[...found.keys()].join(", ") || "aucun"} — tous autorisés`);
