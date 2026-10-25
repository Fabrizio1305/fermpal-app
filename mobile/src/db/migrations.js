// Exécution des migrations du carnet local.
//
// Contrat (docs/LOCAL-FIRST-2026-09-10.md §4) :
// - migrations numérotées, appliquées automatiquement, chacune dans une
//   transaction avec son enregistrement → une interruption laisse la base à la
//   version précédente, intacte (SQLite annule la transaction à la réouverture) ;
// - copie cohérente AVANT toute migration d'une base qui contient déjà des
//   données (`beforeMigrate`) ; si la copie échoue, on ne migre pas ;
// - vérification de la base avant ouverture normale (`verifyDatabase`) ;
// - base plus récente que l'app → erreur `schema_too_new`, jamais de rétrogradation
//   improvisée ni de remise à zéro.
//
// Indépendant de la plateforme : `db` est un pilote (voir driver.js).

import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";

export class MigrationError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export async function ensureMigrationTable(db) {
  await db.exec(`create table if not exists schema_migrations (
    version integer primary key,
    name text not null,
    applied_at text not null
  )`);
}

export async function currentSchemaVersion(db) {
  await ensureMigrationTable(db);
  const rows = await db.query("select coalesce(max(version), 0) as v from schema_migrations");
  return Number(rows[0]?.v ?? 0);
}

// `migrations` est injectable pour les tests (migration qui échoue à mi-chemin).
export async function runMigrations(db, { migrations = MIGRATIONS, targetVersion, beforeMigrate, onApplied } = {}) {
  const target = targetVersion ?? Math.max(...migrations.map((m) => m.version));
  const from = await currentSchemaVersion(db);
  if (from > target) {
    throw new MigrationError("schema_too_new", `Base en version ${from}, application en version ${target}`, { from, to: target });
  }
  const pending = migrations.filter((m) => m.version > from && m.version <= target).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return { from, to: from, applied: [] };

  // Base déjà peuplée : copie cohérente d'abord. Une base vierge (version 0)
  // n'a rien à protéger.
  if (from > 0 && beforeMigrate) {
    await beforeMigrate({ from, to: target });
  }

  const applied = [];
  for (const m of pending) {
    await db.transaction(async () => {
      if (m.sql) await db.exec(m.sql);
      if (m.up) await m.up(db);
      await db.run("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)", [m.version, m.name, new Date().toISOString()]);
    });
    applied.push(m.version);
    if (onApplied) await onApplied(m);
  }
  await db.persist();
  return { from, to: target, applied };
}

// Contrôles avant ouverture normale : intégrité du fichier, clés étrangères,
// tables attendues. Lève `MigrationError` avec un code explicite ; l'appelant
// décide (écran de récupération/export, pas d'écriture).
export async function verifyDatabase(db, { expectedTables }) {
  const quick = await db.query("pragma quick_check");
  const status = quick.map((r) => Object.values(r)[0]).join(";");
  if (status !== "ok") throw new MigrationError("integrity", `quick_check : ${status}`);
  const fk = await db.query("pragma foreign_key_check");
  if (fk.length > 0) throw new MigrationError("foreign_keys", `${fk.length} référence(s) orpheline(s)`, { rows: fk });
  const tables = new Set((await db.query("select name from sqlite_master where type = 'table'")).map((r) => r.name));
  const missing = expectedTables.filter((t) => !tables.has(t));
  if (missing.length > 0) throw new MigrationError("missing_tables", `Tables absentes : ${missing.join(", ")}`, { missing });
  return { ok: true };
}

export { SCHEMA_VERSION };
