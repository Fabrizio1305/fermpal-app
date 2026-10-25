// Contrôle des textes de l'app : tout texte affiché passe par les dictionnaires
// lib/i18n/{fr,en,it}.json.
//
//   node scripts/i18n-check.mjs            rapport ; échoue sur les erreurs
//   node scripts/i18n-check.mjs --strict   échoue aussi sur tout texte résiduel
//
// Erreurs (toujours) : clé t("…") utilisée mais absente de fr.json ; préfixe
// dynamique t(`a.b.${x}`) qui ne correspond à aucune clé.
// Résiduels (avertissement, erreur en --strict) : ternaires `fr ? … : …`,
// tables `{ fr: …, en: … }`, champs `labelFr`/`nameFr`, tests `lang === "fr"`,
// locales en dur, pluriels `? "s" : ""`, lecture directe de localStorage.
// Avertissement : clés définies mais jamais référencées.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

// Périmètre : tout le code de l'app. fermentationTools reste un jeu de données
// FR/EN (outils), catalogs.js un jeu de données généré.
const SCOPE = ["lib", "app/components", "components", "mobile/src"];
const EXCLUDE = [/^lib\/i18n\//, /^lib\/fermentationTools\.js$/, /^mobile\/src\/data\/catalogs\.js$/];
// Fichiers dont on relève les clés t("…") mais pas les textes résiduels : le
// prompt de la recette IA reste FR/EN par conception (consigne au modèle), et
// les deux outils (calculateur de F2, guide pH) sont rédigés en FR/EN.
const RESIDUAL_EXEMPT = [/^lib\/recipeAi\.js$/, /^components\/tools\//];
// Clés référencées par des données, pas par un appel t("…") littéral :
// `nameKey: "phases.…"` dans lib/recipeTypes.js.
const DATA_PREFIXES = ["phases."];
// Forme d'une clé de dictionnaire : t("stock.title"), t("types.kefir_eau.label").
// Tout autre littéral passé à une fonction t() locale (storeDemo.js) est ignoré.
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9][a-zA-Z0-9_]*)+$/;

const RESIDUALS = [
  ["ternaire fr ?", /\bfr\s*\?/g],
  ["table { fr: … }", /\bfr:\s/g],
  ["labelFr / nameFr", /\b(label|name)Fr\b/g],
  ['lang === "fr"/"en"', /\blang\s*[!=]==\s*"(fr|en)"/g],
  ["locale en dur", /"(fr|en|it)-(CH|FR|GB|US)"/g],
  ['pluriel ? "s" : ""', /\?\s*"s"\s*:\s*""/g],
  ["localStorage fermpal_lang", /localStorage\.getItem\("fermpal_lang"\)/g],
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = SCOPE.flatMap((s) => walk(path.join(root, s), []))
  .map((f) => path.relative(root, f))
  .filter((f) => !EXCLUDE.some((re) => re.test(f)))
  .sort();

const fr = JSON.parse(readFileSync(path.join(root, "lib/i18n/fr.json"), "utf8"));
const defined = new Set(Object.keys(fr));
// Les variantes de pluriel se référencent par leur racine : t("x.days", { count }).
const roots = new Set([...defined].map((k) => k.replace(/\.(zero|one|two|few|many|other)$/, "")));

const errors = [];
const residuals = new Map(); // fichier → { motif: nombre }
const usedKeys = new Set();
const dynamicPrefixes = new Set();

for (const file of files) {
  const src = readFileSync(path.join(root, file), "utf8");
  for (const [label, re] of RESIDUALS) {
    if (RESIDUAL_EXEMPT.some((x) => x.test(file))) break;
    const n = (src.match(re) || []).length;
    if (n) {
      if (!residuals.has(file)) residuals.set(file, {});
      residuals.get(file)[label] = n;
    }
  }
  for (const m of src.matchAll(/\bt\(\s*(["'])([^"'`\n]+?)\1/g)) {
    if (!KEY_SHAPE.test(m[2])) continue;
    usedKeys.add(m[2]);
    if (!defined.has(m[2]) && !roots.has(m[2])) errors.push(`${file} : clé inconnue t("${m[2]}")`);
  }
  for (const m of src.matchAll(/\bt\(\s*`([^`$\n]*)\$\{/g)) {
    const prefix = m[1];
    dynamicPrefixes.add(prefix);
    if (![...defined].some((k) => k.startsWith(prefix))) errors.push(`${file} : préfixe dynamique t(\`${prefix}…\`) sans clé correspondante`);
  }
}

const unused = [...defined].filter((k) => {
  const base = k.replace(/\.(zero|one|two|few|many|other)$/, "");
  return !usedKeys.has(k) && !usedKeys.has(base) && ![...dynamicPrefixes, ...DATA_PREFIXES].some((p) => k.startsWith(p));
});

let residualTotal = 0;
for (const counts of residuals.values()) for (const n of Object.values(counts)) residualTotal += n;

console.log(`i18n-check — ${files.length} fichiers, ${defined.size} clés dans fr.json, ${usedKeys.size} clés référencées`);
if (residuals.size) {
  console.log(`\nTextes résiduels hors dictionnaire : ${residualTotal} dans ${residuals.size} fichiers${strict ? " (ERREUR en --strict)" : ""}`);
  for (const [file, counts] of residuals) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`  ${String(total).padStart(4)}  ${file}  (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")})`);
  }
} else {
  console.log("\nAucun texte résiduel dans le périmètre.");
}
if (unused.length) {
  console.log(`\nClés définies mais jamais référencées (${unused.length}) :`);
  for (const k of unused) console.log(`  ${k}`);
}
if (errors.length) {
  console.log(`\nERREURS (${errors.length}) :`);
  for (const e of errors) console.log(`  ${e}`);
}

if (errors.length || (strict && residualTotal)) {
  console.log("\ni18n-check : ÉCHEC");
  process.exit(1);
}
console.log("\ni18n-check : OK");
