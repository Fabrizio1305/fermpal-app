import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeDriver } from "../mobile/src/db/nodeDriver.js";
import { MIGRATIONS, DATA_TABLES } from "../mobile/src/db/schema.js";
import { runMigrations, currentSchemaVersion, verifyDatabase, MigrationError } from "../mobile/src/db/migrations.js";
import { saveRecipe, countRecipes } from "../mobile/src/data/recipes.js";

const EXPECTED_TABLES = [...DATA_TABLES, "schema_migrations"];

async function freshDb() {
  const db = createNodeDriver();
  await runMigrations(db);
  return db;
}

test("base vierge : migrations appliquées, schéma vérifié, aucune copie préalable", async () => {
  const db = createNodeDriver();
  let backups = 0;
  const r = await runMigrations(db, { beforeMigrate: async () => { backups++; } });
  assert.equal(r.from, 0);
  assert.equal(r.to, MIGRATIONS.at(-1).version);
  assert.deepEqual(r.applied, MIGRATIONS.map((m) => m.version));
  assert.equal(backups, 0, "une base vide n'a rien à sauvegarder");
  assert.deepEqual(await verifyDatabase(db, { expectedTables: EXPECTED_TABLES }), { ok: true });
  assert.equal(await currentSchemaVersion(db), MIGRATIONS.at(-1).version);
});

test("base v1 (L1) peuplée → v2 (L2) : copie préalable, recettes intactes, nouvelles tables présentes", async () => {
  const db = createNodeDriver();
  await runMigrations(db, { targetVersion: 1 });
  assert.equal(await currentSchemaVersion(db), 1);
  await saveRecipe(db, { recipe: { title: "Kéfir de L1", type: "kefir_eau", tags: ["l1"] }, phases: [{ key: "p", name: "F1" }], ingredients: [{ phaseKey: "p", name: "Sucre", amount: 50, unit: "g" }] });
  const backups = [];
  const r = await runMigrations(db, { beforeMigrate: async (x) => backups.push(x) });
  assert.deepEqual(r.applied, MIGRATIONS.filter((m) => m.version > 1).map((m) => m.version));
  assert.deepEqual(backups, [{ from: 1, to: MIGRATIONS.at(-1).version }]);
  assert.equal(await countRecipes(db), 1);
  const tables = new Set((await db.query("select name from sqlite_master where type = 'table'")).map((t) => t.name));
  for (const t of DATA_TABLES) assert.ok(tables.has(t), "table " + t + " présente");
  assert.deepEqual(await verifyDatabase(db, { expectedTables: EXPECTED_TABLES }), { ok: true });
});

test("relance sans migration en attente : rien n'est réappliqué", async () => {
  const db = await freshDb();
  const r = await runMigrations(db);
  assert.deepEqual(r.applied, []);
});

test("base plus récente que l'application : refus explicite, aucune écriture", async () => {
  const db = await freshDb();
  await db.run("insert into schema_migrations (version, name, applied_at) values (99, 'future', '2030-01-01T00:00:00Z')");
  await assert.rejects(runMigrations(db), (err) => err instanceof MigrationError && err.code === "schema_too_new" && err.from === 99);
  assert.equal(await currentSchemaVersion(db), 99);
});

test("migration interrompue à mi-chemin : base intacte à la version précédente, reprise possible", async () => {
  const db = await freshDb();
  await saveRecipe(db, { recipe: { title: "Kéfir témoin", type: "kefir_eau", tags: ["a"] }, phases: [{ key: "p1", name: "F1" }], ingredients: [{ phaseKey: "p1", name: "Sucre", amount: 50, unit: "g" }] });
  const backups = [];
  const next = MIGRATIONS.at(-1).version + 1;
  const broken = [
    ...MIGRATIONS,
    {
      version: next,
      name: "ajout_table_puis_panne",
      sql: "create table brassins_test (id text primary key); insert into brassins_test values ('x');",
      up: async () => {
        throw new Error("coupure simulée pendant la migration");
      },
    },
  ];
  await assert.rejects(runMigrations(db, { migrations: broken, beforeMigrate: async (x) => backups.push(x) }), /coupure simulée/);
  assert.deepEqual(backups, [{ from: next - 1, to: next }], "la copie préalable a été demandée avant de toucher la base");
  assert.equal(await currentSchemaVersion(db), next - 1, "la version n'a pas bougé");
  const tables = (await db.query("select name from sqlite_master where type = 'table'")).map((r) => r.name);
  assert.ok(!tables.includes("brassins_test"), "la table créée pendant la migration ratée a été annulée");
  assert.equal(await countRecipes(db), 1, "les données existantes sont intactes");
  assert.deepEqual(await verifyDatabase(db, { expectedTables: EXPECTED_TABLES }), { ok: true });

  // « Relance » avec la migration corrigée : elle passe, données conservées.
  const fixed = [...MIGRATIONS, { version: next, name: "ajout_table", sql: "create table brassins_test (id text primary key);" }];
  const r = await runMigrations(db, { migrations: fixed, beforeMigrate: async (x) => backups.push(x) });
  assert.deepEqual(r.applied, [next]);
  assert.equal(backups.length, 2);
  assert.equal(await currentSchemaVersion(db), next);
  assert.equal(await countRecipes(db), 1);
});

test("copie préalable impossible : la migration n'est pas tentée", async () => {
  const db = await freshDb();
  const next = MIGRATIONS.at(-1).version + 1;
  const withNext = [...MIGRATIONS, { version: next, name: "suivante", sql: "create table t2 (id text primary key);" }];
  await assert.rejects(runMigrations(db, { migrations: withNext, beforeMigrate: async () => { throw new Error("plus d'espace libre"); } }), /espace libre/);
  assert.equal(await currentSchemaVersion(db), next - 1);
  const tables = (await db.query("select name from sqlite_master where type = 'table'")).map((r) => r.name);
  assert.ok(!tables.includes("t2"));
});

test("vérification : une référence orpheline est détectée avant ouverture normale", async () => {
  const db = await freshDb();
  await db.exec("pragma foreign_keys = off");
  await db.run("insert into recipe_phases (id, recipe_id, name, sort_order) values ('ph', 'recette-absente', 'F1', 0)");
  await db.exec("pragma foreign_keys = on");
  await assert.rejects(verifyDatabase(db, { expectedTables: EXPECTED_TABLES }), (err) => err.code === "foreign_keys");
});
