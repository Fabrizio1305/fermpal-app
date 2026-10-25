import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeDriver } from "../mobile/src/db/nodeDriver.js";
import { runMigrations } from "../mobile/src/db/migrations.js";
import { saveRecipe, getRecipeFull, countRecipes, listRecipes } from "../mobile/src/data/recipes.js";
import { seedSyntheticRecipes } from "../mobile/src/data/seed.js";
import { buildExportBundle, verifyBundle, restoreBundle, readAllData, canonicalJson, sha256Hex, exportFileName, EXPORT_FORMAT } from "../mobile/src/data/exportImport.js";
import { SCHEMA_VERSION } from "../mobile/src/db/schema.js";

async function freshDb() {
  const db = createNodeDriver();
  await runMigrations(db);
  return db;
}

async function populated() {
  const db = await freshDb();
  await seedSyntheticRecipes(db, { count: 40 });
  const [first] = await listRecipes(db);
  const full = await getRecipeFull(db, first.id);
  // une modification → une version dans l'historique
  await saveRecipe(db, { id: first.id, recipe: { ...full.recipe, title: full.recipe.title + " (revue)" }, phases: full.phases.map((p) => ({ key: p.id, ...p })), ingredients: full.ingredients.map((l) => ({ ...l, phaseKey: l.phase_id })) });
  return db;
}

async function fingerprint(db) {
  return sha256Hex(canonicalJson(await readAllData(db)));
}

// Re-signe un paquet modifié (pour tester les contrôles au-delà de l'empreinte).
async function resign(bundle) {
  const counts = Object.fromEntries(Object.entries(bundle.data).map(([t, rows]) => [t, rows.length]));
  return { ...bundle, manifest: { counts, sha256: await sha256Hex(canonicalJson(bundle.data)) } };
}

test("export → restauration dans une base vide : mêmes données, même empreinte", async () => {
  const src = await populated();
  const bundle = await buildExportBundle(src, { platform: "test" });
  assert.equal(bundle.format, EXPORT_FORMAT);
  assert.equal(bundle.schemaVersion, SCHEMA_VERSION);
  assert.equal(bundle.manifest.counts.recipes, 40);
  assert.equal(bundle.manifest.counts.recipe_versions, 1);
  assert.deepEqual(await verifyBundle(bundle), { counts: bundle.manifest.counts, sha256: bundle.manifest.sha256 });

  // aller-retour texte, comme un fichier
  const parsed = JSON.parse(JSON.stringify(bundle));
  const dst = await freshDb();
  const backups = [];
  const counts = await restoreBundle(dst, parsed, { openTempDb: async () => createNodeDriver(), backup: async (b) => backups.push(b) });
  assert.deepEqual(counts, bundle.manifest.counts);
  assert.equal(await fingerprint(dst), await fingerprint(src), "données identiques au bit près");
  assert.equal(backups.length, 1, "copie de secours de l'état courant écrite avant remplacement");
  assert.equal(backups[0].manifest.counts.recipes, 0);
  assert.equal((await dst.query("pragma foreign_key_check")).length, 0);
});

test("empreinte canonique : indépendante de l'ordre des clés", async () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: null, c: "x" }] }), '{"a":[{"c":"x","d":null}],"b":1}');
  assert.equal(await sha256Hex(canonicalJson({ b: 1, a: 2 })), await sha256Hex(canonicalJson({ a: 2, b: 1 })));
});

test("paquet altéré, tronqué ou étranger : refusé avec un code explicite", async () => {
  const src = await populated();
  const bundle = await buildExportBundle(src);
  const clone = () => JSON.parse(JSON.stringify(bundle));

  let b = clone();
  b.data.recipes[0].title = "modifié après export";
  await assert.rejects(verifyBundle(b), (e) => e.code === "hash_mismatch");

  b = clone();
  b.data.recipe_phases.pop();
  await assert.rejects(verifyBundle(b), (e) => e.code === "count_mismatch");

  b = await resign({ ...clone(), data: { ...clone().data, recipe_ingredients: [...clone().data.recipe_ingredients, { ...clone().data.recipe_ingredients[0], id: "orphan", recipe_id: "inconnue" }] } });
  await assert.rejects(verifyBundle(b), (e) => e.code === "orphan");

  b = clone();
  const ing = b.data.recipe_ingredients[0];
  const otherRecipePhase = b.data.recipe_phases.find((p) => p.recipe_id !== ing.recipe_id);
  ing.phase_id = otherRecipePhase.id;
  b = await resign(b);
  await assert.rejects(verifyBundle(b), (e) => e.code === "orphan", "une ligne ne peut pointer la phase d'une autre recette");

  b = clone();
  b.schemaVersion = 99;
  await assert.rejects(verifyBundle(b), (e) => e.code === "app_too_old");

  await assert.rejects(verifyBundle({ format: "autre-chose" }), (e) => e.code === "bad_format");
  await assert.rejects(verifyBundle("pas un objet"), (e) => e.code === "not_object");
  await assert.rejects(verifyBundle(JSON.parse('{"format":"fermpal-local-export","formatVersion":1,"schemaVersion":1,"data":{"recipes":[]}}')), (e) => e.code === "missing_table");
});

test("restauration d'un paquet invalide : la base courante n'est pas touchée, aucune copie de secours écrite", async () => {
  const db = await populated();
  const before = await fingerprint(db);
  const bundle = await buildExportBundle(db);
  bundle.data.recipes[0].title = "corrompu";
  let backups = 0;
  await assert.rejects(restoreBundle(db, bundle, { openTempDb: async () => createNodeDriver(), backup: async () => { backups++; } }), (e) => e.code === "hash_mismatch");
  assert.equal(await fingerprint(db), before);
  assert.equal(backups, 0);
});

test("restauration : la base temporaire attrape ce que le manifeste laisse passer (type invalide), base réelle intacte", async () => {
  const db = await populated();
  const before = await fingerprint(db);
  const bundle = await buildExportBundle(db);
  // recette sans updated_at (not null en base) mais paquet cohérent et re-signé
  delete bundle.data.recipes[0].updated_at;
  const signed = await resign(bundle);
  await assert.rejects(restoreBundle(db, signed, { openTempDb: async () => createNodeDriver(), backup: async () => {} }), /NOT NULL|not null/i);
  assert.equal(await fingerprint(db), before);
});

test("restauration remplace le carnet courant (pas de fusion) et garde une copie de l'ancien", async () => {
  const dst = await freshDb();
  await saveRecipe(dst, { recipe: { title: "Ancienne recette locale", type: "cidre" } });
  const src = await populated();
  const bundle = await buildExportBundle(src);
  const backups = [];
  await restoreBundle(dst, bundle, { openTempDb: async () => createNodeDriver(), backup: async (b) => backups.push(b) });
  assert.equal(await countRecipes(dst), 40);
  assert.ok(!(await listRecipes(dst)).some((r) => r.title === "Ancienne recette locale"));
  assert.equal(backups[0].data.recipes[0].title, "Ancienne recette locale", "l'ancien carnet est dans la copie de secours");
  // et la copie de secours est elle-même restaurable
  const again = await freshDb();
  await restoreBundle(again, backups[0], { openTempDb: async () => createNodeDriver() });
  assert.equal((await listRecipes(again))[0].title, "Ancienne recette locale");
});

test("paquet v1 (export de L1) restauré dans une application v2 : recettes reprises, tables L2 vides", async () => {
  const old = createNodeDriver();
  await runMigrations(old, { targetVersion: 1 });
  await seedSyntheticRecipes(old, { count: 12 });
  const bundle = await buildExportBundle(old);
  assert.equal(bundle.schemaVersion, 1);
  assert.deepEqual(Object.keys(bundle.data), ["recipes", "recipe_phases", "recipe_ingredients", "recipe_versions"]);
  const dst = await freshDb();
  const counts = await restoreBundle(dst, JSON.parse(JSON.stringify(bundle)), { openTempDb: async () => createNodeDriver() });
  assert.equal(counts.recipes, 12);
  assert.equal(counts.batches, 0);
  assert.equal(await countRecipes(dst), 12);
  assert.equal((await dst.query("pragma foreign_key_check")).length, 0);
});

test("nom de fichier d'export horodaté", () => {
  assert.equal(exportFileName(new Date(2026, 8, 11, 9, 5)), "fermpal-carnet-20260911-0905.json");
});
