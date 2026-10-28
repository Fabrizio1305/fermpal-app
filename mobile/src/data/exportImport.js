// Export portable et restauration du carnet (cadrage §4).
//
// Le paquet exporté est versionné, contient les données, leurs liens, les
// versions de recettes et un manifeste d'intégrité (comptes + SHA-256 des
// données canonisées). Il ne contient ni session, ni clé, ni droit Pro : il
// n'y en a pas dans le carnet local.
//
// Restauration : le paquet est vérifié (format, version de schéma, empreinte,
// comptes, références), puis importé dans une base TEMPORAIRE au schéma du
// paquet, migrée jusqu'au schéma courant par le chemin normal des migrations
// (un paquet d'une ancienne version se restaure donc comme une base ancienne
// s'ouvre), avec clés étrangères actives ; puis seulement copié dans la base
// réelle en une transaction. Une copie de secours de l'état courant est écrite
// avant le remplacement.

import { DATA_TABLES, SCHEMA_VERSION } from "../db/schema.js";
import { runMigrations } from "../db/migrations.js";

export const EXPORT_FORMAT = "fermpal-local-export";
export const EXPORT_FORMAT_VERSION = 1;

// Tables présentes à chaque version de schéma : un paquet v1 ne contient que
// les recettes, il reste restaurable dans une application v2.
const TABLES_BY_SCHEMA = {
  1: ["recipes", "recipe_phases", "recipe_ingredients", "recipe_versions"],
  2: DATA_TABLES,
  3: DATA_TABLES,
};

export function tablesForSchema(version) {
  return TABLES_BY_SCHEMA[version] || DATA_TABLES;
}

export class BundleError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "BundleError";
    this.code = code;
    Object.assign(this, extra);
  }
}

// JSON canonique : clés triées à tous les niveaux, pour une empreinte stable
// quel que soit l'ordre de lecture des colonnes.
export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Empreinte du carnet entier (= manifest.sha256 d'un export fait au même
// instant) : sert à savoir si quelque chose a changé depuis la dernière
// sauvegarde en ligne, sans conserver le paquet.
export async function notebookFingerprint(db, tables = DATA_TABLES) {
  return sha256Hex(canonicalJson(await readAllData(db, tables)));
}

export async function readAllData(db, tables = DATA_TABLES) {
  const data = {};
  for (const t of tables) {
    data[t] = await db.query(`select * from ${t} order by rowid`);
  }
  return data;
}

export function countsOf(data, tables = Object.keys(data)) {
  return Object.fromEntries(tables.map((t) => [t, (data[t] || []).length]));
}

export async function buildExportBundle(db, { platform = "unknown", schemaVersion } = {}) {
  const version = Number(schemaVersion ?? (await db.query("select coalesce(max(version), 0) as v from schema_migrations"))[0].v);
  const tables = tablesForSchema(version);
  return bundleFromData(await readAllData(db, tables), { schemaVersion: version, source: { app: "fermpal-local", platform } });
}

// Paquet complet (manifeste inclus) à partir de données déjà en mémoire — le
// même format que l'export, donc restaurable par le même chemin vérifié. Sert à
// l'export du carnet et à la récupération du carnet web (lot L3). Les tables
// absentes du jeu de données sont présentes vides.
export async function bundleFromData(data, { schemaVersion = SCHEMA_VERSION, source = { app: "fermpal-local", platform: "unknown" }, exportedAt = new Date().toISOString() } = {}) {
  const tables = tablesForSchema(schemaVersion);
  const complete = Object.fromEntries(tables.map((t) => [t, data[t] || []]));
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion,
    exportedAt,
    source,
    data: complete,
    manifest: { counts: countsOf(complete, tables), sha256: await sha256Hex(canonicalJson(complete)) },
  };
}

function ids(rows, label) {
  const set = new Set();
  for (const r of rows) {
    if (typeof r.id !== "string" || !r.id) throw new BundleError("bad_row", `${label} sans identifiant.`);
    if (set.has(r.id)) throw new BundleError("duplicate_id", `${label} ${r.id} en double.`);
    set.add(r.id);
  }
  return set;
}

function requireRef(row, field, set, label, { nullable = false } = {}) {
  const v = row[field];
  if (v == null) {
    if (nullable) return;
    throw new BundleError("orphan", `${label} ${row.id} : ${field} manquant.`);
  }
  if (!set.has(v)) throw new BundleError("orphan", `${label} ${row.id} : ${field} ${v} absent du paquet.`);
}

// Vérifie un paquet lu depuis un fichier. Lève BundleError(code).
export async function verifyBundle(bundle, { schemaVersion = SCHEMA_VERSION } = {}) {
  if (!bundle || typeof bundle !== "object") throw new BundleError("not_object", "Le fichier n'est pas un paquet FermPal.");
  if (bundle.format !== EXPORT_FORMAT) throw new BundleError("bad_format", "Le fichier n'est pas un export FermPal.");
  if (bundle.formatVersion !== EXPORT_FORMAT_VERSION) throw new BundleError("bad_format_version", `Version de format ${bundle.formatVersion} inconnue.`);
  if (!Number.isInteger(bundle.schemaVersion) || bundle.schemaVersion < 1) throw new BundleError("bad_schema_version", "Version de schéma invalide.");
  if (bundle.schemaVersion > schemaVersion) {
    throw new BundleError("app_too_old", `Ce paquet vient d'une version plus récente de l'application (schéma ${bundle.schemaVersion} > ${schemaVersion}). Mets l'application à jour avant de restaurer.`);
  }
  const tables = tablesForSchema(bundle.schemaVersion);
  const data = bundle.data;
  if (!data || typeof data !== "object") throw new BundleError("no_data", "Paquet sans données.");
  for (const t of tables) {
    if (!Array.isArray(data[t])) throw new BundleError("missing_table", `Table ${t} absente du paquet.`);
  }
  for (const t of Object.keys(data)) {
    if (!tables.includes(t)) throw new BundleError("unknown_table", `Table ${t} inconnue pour le schéma ${bundle.schemaVersion}.`);
  }
  const manifest = bundle.manifest || {};
  const counts = countsOf(data, tables);
  for (const t of tables) {
    if (manifest.counts?.[t] !== counts[t]) throw new BundleError("count_mismatch", `Nombre de lignes de ${t} différent du manifeste.`, { table: t });
  }
  const hash = await sha256Hex(canonicalJson(data));
  if (manifest.sha256 !== hash) throw new BundleError("hash_mismatch", "Empreinte des données différente du manifeste : fichier altéré ou tronqué.");

  // Références : chaque lien doit exister dans le paquet lui-même.
  const recipeIds = ids(data.recipes, "Recette");
  for (const r of data.recipes) {
    if (typeof r.title !== "string" || !r.title.trim()) throw new BundleError("bad_row", `Recette ${r.id} sans titre.`);
    requireRef(r, "archive_of", recipeIds, "Recette", { nullable: true });
  }
  const phaseIds = ids(data.recipe_phases, "Phase");
  const phaseRecipe = new Map(data.recipe_phases.map((p) => [p.id, p.recipe_id]));
  for (const p of data.recipe_phases) requireRef(p, "recipe_id", recipeIds, "Phase");
  ids(data.recipe_ingredients, "Ingrédient");
  for (const l of data.recipe_ingredients) {
    requireRef(l, "recipe_id", recipeIds, "Ingrédient");
    if (l.phase_id != null && phaseRecipe.get(l.phase_id) !== l.recipe_id) throw new BundleError("orphan", `Ingrédient ${l.id} : phase ${l.phase_id} absente ou d'une autre recette.`);
  }
  ids(data.recipe_versions, "Version");
  for (const v of data.recipe_versions) {
    requireRef(v, "recipe_id", recipeIds, "Version");
    try {
      JSON.parse(v.snapshot);
    } catch {
      throw new BundleError("bad_row", `Version ${v.id} : instantané JSON invalide.`);
    }
  }

  if (bundle.schemaVersion >= 2) {
    ids(data.ingredients, "Stock");
    const aliases = new Set();
    for (const a of data.ingredient_aliases) {
      if (typeof a.alias !== "string" || !a.alias) throw new BundleError("bad_row", "Alias vide.");
      if (aliases.has(a.alias)) throw new BundleError("duplicate_id", `Alias ${a.alias} en double.`);
      aliases.add(a.alias);
    }
    const batchIds = ids(data.batches, "Brassin");
    for (const b of data.batches) {
      if (typeof b.title !== "string" || !b.title.trim()) throw new BundleError("bad_row", `Brassin ${b.id} sans titre.`);
      requireRef(b, "recipe_id", recipeIds, "Brassin", { nullable: true });
      requireRef(b, "current_phase_id", phaseIds, "Brassin", { nullable: true });
      requireRef(b, "parent_batch_id", batchIds, "Brassin", { nullable: true });
      requireRef(b, "starter_batch_id", batchIds, "Brassin", { nullable: true });
      if (b.parent_batch_id === b.id || b.starter_batch_id === b.id) throw new BundleError("bad_row", `Brassin ${b.id} se référence lui-même.`);
    }
    ids(data.batch_ingredients, "Ligne de brassin");
    for (const l of data.batch_ingredients) {
      requireRef(l, "batch_id", batchIds, "Ligne de brassin");
      requireRef(l, "phase_id", phaseIds, "Ligne de brassin", { nullable: true });
    }
    ids(data.batch_phase_log, "Avancement");
    for (const l of data.batch_phase_log) {
      requireRef(l, "batch_id", batchIds, "Avancement");
      requireRef(l, "phase_id", phaseIds, "Avancement", { nullable: true });
    }
    ids(data.batch_journal, "Note");
    for (const j of data.batch_journal) {
      requireRef(j, "batch_id", batchIds, "Note");
      requireRef(j, "phase_id", phaseIds, "Note", { nullable: true });
    }
    ids(data.shopping_list, "Course");
    ids(data.stock_movements, "Mouvement");
    const requests = new Set();
    for (const r of data.stock_operation_requests) {
      if (typeof r.request_id !== "string" || requests.has(r.request_id)) throw new BundleError("duplicate_id", "Opération de stock en double.");
      requests.add(r.request_id);
    }
  }
  return { counts, sha256: hash };
}

// Insère toutes les lignes d'un paquet dans `db` (déjà migrée au schéma du
// paquet), dans une transaction ouverte par l'appelant. Les clés étrangères
// sont vérifiées à la validation, pas ligne par ligne : `batches` se
// référence lui-même (lots, relances) et l'ordre du paquet n'est pas garanti.
export async function insertBundleRows(db, data, tables = Object.keys(data)) {
  await db.exec("pragma defer_foreign_keys = on");
  const items = [];
  for (const t of tables) {
    for (const row of data[t] || []) {
      const cols = Object.keys(row);
      items.push({ sql: `insert into ${t} (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`, params: cols.map((c) => row[c]) });
    }
  }
  await db.runBatch(items);
}

// Restauration complète. `openTempDb()` fournit un pilote sur une base vide
// et jetable ; `backup(bundle)` écrit la copie de secours de l'état courant.
export async function restoreBundle(db, bundle, { openTempDb, backup, platform = "unknown" }) {
  const verified = await verifyBundle(bundle);
  const bundleTables = tablesForSchema(bundle.schemaVersion);

  // 1. Répétition générale dans une base temporaire : schéma du paquet, lignes,
  //    puis migration jusqu'au schéma courant. Toute incohérence casse ici.
  const temp = await openTempDb();
  let upgraded;
  try {
    await runMigrations(temp, { targetVersion: bundle.schemaVersion });
    await temp.transaction(() => insertBundleRows(temp, bundle.data, bundleTables));
    let check = await temp.query("pragma foreign_key_check");
    if (check.length > 0) throw new BundleError("orphan", "Références incohérentes détectées à l'import.");
    const counts = countsOf(await readAllData(temp, bundleTables), bundleTables);
    for (const t of bundleTables) {
      if (counts[t] !== verified.counts[t]) throw new BundleError("count_mismatch", `Import partiel de ${t}.`, { table: t });
    }
    await runMigrations(temp);
    check = await temp.query("pragma foreign_key_check");
    if (check.length > 0) throw new BundleError("orphan", "Références incohérentes après mise à niveau du paquet.");
    upgraded = await readAllData(temp);
  } finally {
    // destroy() efface ET ferme ; s'il échoue, on ferme au moins. Un reste
    // éventuel est traité à l'ouverture suivante (openTempDatabase).
    if (temp.destroy) await temp.destroy().catch(() => temp.close().catch(() => {}));
    else await temp.close().catch(() => {});
  }

  // 2. Copie de secours de l'état courant, avant tout remplacement.
  if (backup) {
    const current = await buildExportBundle(db, { platform });
    await backup(current);
  }

  // 3. Remplacement atomique dans la base réelle, au schéma courant.
  await db.transaction(async () => {
    for (const t of [...DATA_TABLES].reverse()) await db.run(`delete from ${t}`);
    await insertBundleRows(db, upgraded, DATA_TABLES);
  });
  return countsOf(upgraded, DATA_TABLES);
}

export function exportFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `fermpal-carnet-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}
