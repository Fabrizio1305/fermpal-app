import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeDriver } from "../mobile/src/db/nodeDriver.js";
import { runMigrations } from "../mobile/src/db/migrations.js";
import { saveRecipe, getRecipeFull } from "../mobile/src/data/recipes.js";
import { stockOperation, runStockOperation, stockSnapshot, StockOperationError } from "../mobile/src/data/stockOperations.js";
import { createBatchForRecipe, getBatch, listBatchLines, startBatch, nextPhase, archiveBatch, saveTasting, addJournalEntry, updateLogDate, deleteLog, getBatchFull, saveBatchAsNewVersion, saveBatchAsNewRecipe, SPLIT_RECIPE_BLOCKED, renameBatch, listBatches, createRecipeOnTheFly } from "../mobile/src/data/batches.js";
import { addShoppingRows, listShopping, removeShoppingItem, clearBought } from "../mobile/src/data/shopping.js";
import { listStock } from "../mobile/src/data/stock.js";

const NOW = "2026-09-11T10:00:00.000Z";

async function freshDb() {
  const db = createNodeDriver();
  await runMigrations(db);
  return db;
}

// Kombucha 1 L : thé (prépa), sucre + eau (F1), gingembre (F2), SCOBY starter (F1).
async function kombucha(db) {
  const { id } = await saveRecipe(db, {
    recipe: { title: "Kombucha", type: "kombucha", batch_size_ref: 1 },
    phases: [
      { key: "prep", name: "Préparation du thé", duration_value: 20, duration_unit: "minutes" },
      { key: "f1", name: "Fermentation primaire (F1)", duration_value: 7, duration_unit: "jours" },
      { key: "f2", name: "Fermentation secondaire (F2)", duration_value: 3, duration_unit: "jours" },
    ],
    ingredients: [
      { phaseKey: "prep", category: "thé", name: "Thé noir", amount: 8, unit: "g" },
      { phaseKey: "f1", category: "sucre", name: "Sucre blanc", amount: 0.07, unit: "kg" },
      { phaseKey: "f1", category: "autre", name: "Eau", amount: 1, unit: "L" },
      { phaseKey: "f1", category: "levure", name: "SCOBY", amount: 1, unit: "pièce", is_starter: true },
      { phaseKey: "f2", category: "fruit", name: "Gingembre", amount: 20, unit: "g" },
    ],
  });
  return getRecipeFull(db, id);
}

async function stock(db, rows) {
  const r = await runStockOperation(db, { kind: "stock_create", payload: { rows } }, { now: NOW });
  return r.stocks;
}

const byName = (rows, name) => rows.find((r) => r.name === name);

async function checkLine(db, batch, line, stockRows, opts = {}) {
  return stockOperation(db, {
    requestId: opts.requestId,
    kind: "batch_ingredient_set",
    payload: {
      batchId: batch.id, lineId: line.id, expectedRevision: line.stock_revision, expectedBatchRevision: batch.stock_revision,
      deducted: true, stockId: opts.stockId === undefined ? (byName(stockRows, line.name)?.id ?? null) : opts.stockId, expectedStock: stockSnapshot(stockRows),
    },
  }, { now: NOW });
}

// ---------------------------------------------------------------------------

test("stock : création, correction avec conversion d'unité, suppression ; journal des mouvements", async () => {
  const db = await freshDb();
  const [sucre] = await stock(db, [{ name: "Sucre blanc", quantity: 1000, unit: "g", category: "sucre" }]);
  assert.equal(sucre.stock_revision, 0);

  // kg sans quantité : le solde est converti (1000 g → 1 kg)
  let r = await runStockOperation(db, { kind: "stock_update", payload: { stockId: sucre.id, expectedRevision: 0, values: { unit: "kg" } } }, { now: NOW });
  assert.equal(r.stock.quantity, 1);
  assert.equal(r.stock.unit, "kg");
  assert.equal(r.stock.stock_revision, 1);
  assert.equal(r.movements[0].action, "stock_correction");
  assert.equal(r.movements[0].delta, 0);
  assert.equal(r.movements[0].unit_before, "g");

  // unité incompatible sans quantité : refus, rien ne change
  r = await stockOperation(db, { kind: "stock_update", payload: { stockId: sucre.id, expectedRevision: 1, values: { unit: "pièce" } } }, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.code, "STOCK_UNIT_INCOMPATIBLE");
  assert.equal((await listStock(db))[0].unit, "kg");

  // unité incompatible AVEC quantité : correction assumée, reason unit_reset
  r = await runStockOperation(db, { kind: "stock_update", payload: { stockId: sucre.id, expectedRevision: 1, values: { unit: "pièce", quantity: 3 } } }, { now: NOW });
  assert.equal(r.stock.quantity, 3);
  assert.equal(r.movements[0].reason, "unit_reset");
  assert.equal(r.movements[0].quantity_before, 1);
  assert.equal(r.movements[0].quantity_after, 3);

  // révision périmée : STOCK_STALE, aucun effet
  r = await stockOperation(db, { kind: "stock_update", payload: { stockId: sucre.id, expectedRevision: 0, values: { quantity: 99 } } }, { now: NOW });
  assert.equal(r.code, "STOCK_STALE");
  assert.equal((await listStock(db))[0].quantity, 3);

  r = await runStockOperation(db, { kind: "stock_remove", payload: { stockId: sucre.id, expectedRevision: 2 } }, { now: NOW });
  assert.equal(r.removed_id, sucre.id);
  assert.equal((await listStock(db)).length, 0);
  assert.equal((await db.query("select count(*) c from stock_movements"))[0].c, 4);
});

test("rejeu : même clé + mêmes arguments = même résultat sans nouvel effet ; autres arguments = collision", async () => {
  const db = await freshDb();
  const req = { requestId: "11111111-1111-4111-8111-111111111111", kind: "stock_create", payload: { rows: [{ name: "Miel", quantity: 500, unit: "g" }] } };
  const a = await stockOperation(db, req, { now: NOW });
  const b = await stockOperation(db, req, { now: NOW });
  assert.deepEqual(a, b);
  assert.equal((await listStock(db)).length, 1, "un seul stock créé malgré deux appels");
  await assert.rejects(stockOperation(db, { ...req, payload: { rows: [{ name: "Autre" }] } }), (e) => e instanceof StockOperationError && e.code === "STOCK_REQUEST_COLLISION");
  // un refus est lui aussi mémorisé et rejoué à l'identique
  const bad = { requestId: "22222222-2222-4222-8222-222222222222", kind: "stock_update", payload: { stockId: "absent", expectedRevision: 0, values: { quantity: 1 } } };
  const r1 = await stockOperation(db, bad);
  const r2 = await stockOperation(db, bad);
  assert.equal(r1.ok, false);
  assert.deepEqual(r1, r2);
});

test("création d'un brassin : instantané mis à l'échelle, journal, une transaction ; panne à mi-chemin = rien", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  const batch = await createBatchForRecipe(db, { recipe, title: "Kombucha #1", volume: 2, lang: "fr", now: NOW });
  assert.equal(batch.status, "planifie");
  assert.equal(batch.volume, 2);
  const lines = await listBatchLines(db, batch.id);
  assert.equal(lines.length, 5);
  assert.equal(byName(lines, "Sucre blanc").amount, 0.14, "×2");
  assert.equal(byName(lines, "Eau").amount, 2);
  assert.equal(byName(lines, "SCOBY").is_starter, true);
  const log = await db.query("select * from batch_phase_log where batch_id = ?", [batch.id]);
  assert.equal(log.length, 1);
  assert.equal(log[0].stage, "planifie");

  // Panne au milieu : le pilote échoue à l'insertion des lignes.
  const flaky = { ...db, runBatch: async () => { throw new Error("coupure"); } };
  await assert.rejects(createBatchForRecipe(flaky, { recipe, title: "Raté", volume: 1, now: NOW }), /coupure/);
  assert.equal((await db.query("select count(*) c from batches"))[0].c, 1, "aucun brassin fantôme");
  assert.equal((await db.query("select count(*) c from batch_phase_log"))[0].c, 1, "aucun journal orphelin");
});

test("brassin en chaîne : le démarreur remplace de l'eau, génération +1", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  const first = await createBatchForRecipe(db, { recipe, title: "Kombucha #1", volume: 2, lang: "fr", now: NOW });
  const second = await createBatchForRecipe(db, { recipe, title: "Kombucha #2", volume: 2, starter: { batchId: first.id, volume: 0.5 }, lang: "fr", now: NOW });
  assert.equal(second.starter_batch_id, first.id);
  assert.equal(second.starter_volume, 0.5);
  assert.equal(second.culture_generation, 2);
  const lines = await listBatchLines(db, second.id);
  assert.equal(byName(lines, "Eau").amount, 1.5, "2 L − 0,5 L de démarreur");
  assert.equal(byName(lines, "Sucre blanc").amount, 0.14, "le sucre reste sur le volume cible");
  const starter = lines.find((l) => l.name.startsWith("Liquide de démarrage"));
  assert.ok(starter && starter.is_starter && starter.amount === 0.5 && starter.unit === "L");
});

test("cocher un ingrédient : prélèvement converti (kg → g), stock introuvable, unité incompatible, starter ; décocher restitue", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 1, lang: "fr", now: NOW });
  batch = await startBatch(db, batch.id, { now: NOW });
  batch = await nextPhase(db, batch.id, { now: NOW }); // → F1
  let stockRows = await stock(db, [
    { name: "Sucre blanc", quantity: 500, unit: "g", category: "sucre" },
    { name: "Eau", quantity: 3, unit: "pièce" }, // unité incompatible avec des litres
  ]);
  let lines = await listBatchLines(db, batch.id);

  // kg → g
  let r = await checkLine(db, batch, byName(lines, "Sucre blanc"), stockRows);
  assert.equal(r.ok, true);
  assert.equal(r.line.deducted, true);
  assert.ok(r.line.stock_movement_id);
  assert.equal(r.movements[0].delta, -70);
  assert.equal(r.movements[0].unit, "g");
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 430);
  assert.equal(r.batch.stock_revision, batch.stock_revision + 1, "la révision du brassin bouge avec la ligne");

  // stock introuvable : coché, aucun mouvement
  batch = r.batch;
  stockRows = await listStock(db);
  lines = await listBatchLines(db, batch.id);
  r = await checkLine(db, batch, byName(lines, "Gingembre"), stockRows, { stockId: null });
  assert.equal(r.movements[0].reason, "no_stock");
  assert.equal(r.movements[0].delta, 0);

  // unité incompatible : coché, stock intact
  batch = r.batch;
  stockRows = await listStock(db);
  lines = await listBatchLines(db, batch.id);
  r = await checkLine(db, batch, byName(lines, "Eau"), stockRows);
  assert.equal(r.movements[0].reason, "incompatible_unit");
  assert.equal(byName(await listStock(db), "Eau").quantity, 3);

  // starter : coché, jamais prélevé
  batch = r.batch;
  stockRows = await listStock(db);
  lines = await listBatchLines(db, batch.id);
  r = await checkLine(db, batch, byName(lines, "SCOBY"), stockRows, { stockId: null });
  assert.equal(r.movements[0].reason, "starter");

  // instantané du stock périmé : refus
  batch = r.batch;
  lines = await listBatchLines(db, batch.id);
  const stale = stockRows.map((s) => ({ ...s, stock_revision: s.stock_revision + 5 }));
  r = await checkLine(db, batch, byName(lines, "Thé noir"), stale, { stockId: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, "STOCK_STALE");

  // décocher le sucre : restitution exacte, mouvement lié à l'origine
  lines = await listBatchLines(db, batch.id);
  const sucre = byName(lines, "Sucre blanc");
  r = await runStockOperation(db, { kind: "batch_ingredient_set", payload: { batchId: batch.id, lineId: sucre.id, expectedRevision: sucre.stock_revision, expectedBatchRevision: batch.stock_revision, deducted: false } }, { now: NOW });
  assert.equal(r.line.deducted, false);
  assert.equal(r.line.stock_movement_id, null);
  assert.equal(r.movements[0].action, "batch_restore");
  assert.equal(r.movements[0].delta, 70);
  assert.equal(r.movements[0].reverses, sucre.stock_movement_id);
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 500);

  // double appui : la seconde intention porte des révisions périmées → refusée, pas de double restitution
  r = await stockOperation(db, { kind: "batch_ingredient_set", payload: { batchId: batch.id, lineId: sucre.id, expectedRevision: sucre.stock_revision, expectedBatchRevision: batch.stock_revision, deducted: false } }, { now: NOW });
  assert.equal(r.code, "STOCK_STALE");
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 500);
});

test("modifier une ligne prélevée : la différence est rendue puis reprise ; renommer décoche ; retirer restitue", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 1, lang: "fr", now: NOW });
  batch = await nextPhase(db, (await startBatch(db, batch.id, { now: NOW })).id, { now: NOW });
  let stockRows = await stock(db, [{ name: "Sucre blanc", quantity: 500, unit: "g", category: "sucre" }]);
  let lines = await listBatchLines(db, batch.id);
  let r = await checkLine(db, batch, byName(lines, "Sucre blanc"), stockRows);
  batch = r.batch;
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 430);

  // 70 g → 100 g : restitution 70 puis prélèvement 100, reste 400, ligne toujours cochée
  let line = r.line;
  r = await runStockOperation(db, { kind: "batch_ingredient_edit", payload: { batchId: batch.id, lineId: line.id, expectedRevision: line.stock_revision, expectedBatchRevision: batch.stock_revision, values: { amount: 100, unit: "g" } } }, { now: NOW });
  assert.equal(r.line.deducted, true);
  assert.equal(r.line.amount, 100);
  assert.deepEqual(r.movements.map((m) => [m.action, m.delta]), [["batch_restore", 70], ["batch_debit", -100]]);
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 400);

  // renommer : restitution, ligne décochée
  batch = r.batch;
  line = r.line;
  r = await runStockOperation(db, { kind: "batch_ingredient_edit", payload: { batchId: batch.id, lineId: line.id, expectedRevision: line.stock_revision, expectedBatchRevision: batch.stock_revision, values: { name: "Sucre roux" } } }, { now: NOW });
  assert.equal(r.line.deducted, false);
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 500);

  // retirer une ligne prélevée : restitution + suppression
  batch = r.batch;
  stockRows = await listStock(db);
  lines = await listBatchLines(db, batch.id);
  r = await checkLine(db, batch, byName(lines, "Sucre roux"), stockRows, { stockId: byName(stockRows, "Sucre blanc").id });
  batch = r.batch;
  line = r.line;
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 400);
  r = await runStockOperation(db, { kind: "batch_ingredient_remove", payload: { batchId: batch.id, lineId: line.id, expectedRevision: line.stock_revision, expectedBatchRevision: batch.stock_revision } }, { now: NOW });
  assert.equal(r.removed_id, line.id);
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 500);
  assert.equal((await listBatchLines(db, batch.id)).length, 4);
});

test("ligne historique cochée sans trace : refus sans renoncement explicite, journal du renoncement avec", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 1, lang: "fr", now: NOW });
  const lines = await listBatchLines(db, batch.id);
  const sucre = byName(lines, "Sucre blanc");
  // Simule une ligne importée d'un ancien carnet : cochée, aucune trace.
  await db.run("update batch_ingredients set deducted = 1, deducted_at = ? where id = ?", [NOW, sucre.id]);
  batch = await getBatch(db, batch.id);
  let r = await stockOperation(db, { kind: "batch_ingredient_set", payload: { batchId: batch.id, lineId: sucre.id, expectedRevision: 0, expectedBatchRevision: batch.stock_revision, deducted: false } }, { now: NOW });
  assert.equal(r.code, "STOCK_LEGACY_TRACE_REQUIRED");
  r = await runStockOperation(db, { kind: "batch_ingredient_set", payload: { batchId: batch.id, lineId: sucre.id, expectedRevision: 0, expectedBatchRevision: batch.stock_revision, deducted: false, legacyNoRestock: true } }, { now: NOW });
  assert.equal(r.line.deducted, false);
  assert.equal(r.movements[0].reason, "legacy_waived");
  assert.equal(r.movements[0].delta, 0);
  assert.equal(r.movements[0].line_snapshot.amount, 0.07);
});

test("retour de phase : les lignes prélevées de la phase quittée sont rendues ; dégustation → dernière phase sans mouvement", async () => {
  const db = await freshDb();
  const { recipe, phases } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 1, lang: "fr", now: NOW });
  batch = await nextPhase(db, (await startBatch(db, batch.id, { now: NOW })).id, { now: NOW }); // F1
  const stockRows = await stock(db, [{ name: "Sucre blanc", quantity: 500, unit: "g" }]);
  let lines = await listBatchLines(db, batch.id);
  batch = (await checkLine(db, batch, byName(lines, "Sucre blanc"), stockRows)).batch;
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 430);

  lines = await listBatchLines(db, batch.id);
  const expectedPhases = phases.map(({ id, sort_order }) => ({ id, sort_order }));
  let r = await runStockOperation(db, {
    kind: "batch_previous_phase",
    payload: {
      batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines),
      expectedStage: { status: "en_cours", current_phase_id: phases[1].id }, expectedPhases,
      targetPhase: { status: "en_cours", current_phase_id: phases[0].id },
    },
  }, { now: NOW });
  assert.equal(r.batch.current_phase_id, phases[0].id);
  assert.equal(r.movements.filter((m) => m.action === "batch_restore").length, 1);
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 500);
  assert.equal(byName(await listBatchLines(db, batch.id), "Sucre blanc").deducted, false);

  // cible fausse → STOCK_STALE
  batch = r.batch;
  lines = await listBatchLines(db, batch.id);
  r = await stockOperation(db, {
    kind: "batch_previous_phase",
    payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedStage: { status: "en_cours", current_phase_id: phases[0].id }, expectedPhases, targetPhase: { status: "en_cours", current_phase_id: phases[2].id } },
  }, { now: NOW });
  assert.equal(r.code, "STOCK_STALE");

  // jusqu'à la dégustation puis retour : dernière phase, aucun mouvement
  batch = await nextPhase(db, batch.id, { now: NOW });
  batch = await nextPhase(db, batch.id, { now: NOW });
  batch = await nextPhase(db, batch.id, { now: NOW });
  assert.equal(batch.status, "degustation");
  lines = await listBatchLines(db, batch.id);
  r = await runStockOperation(db, {
    kind: "batch_previous_phase",
    payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedStage: { status: "degustation", current_phase_id: null }, expectedPhases, targetPhase: { status: "en_cours", current_phase_id: phases[2].id } },
  }, { now: NOW });
  assert.equal(r.batch.status, "en_cours");
  assert.equal(r.batch.current_phase_id, phases[2].id);
  assert.equal(r.movements.length, 0);
});

test("supprimer un brassin : restitutions, cascades, enfants détachés", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 1, lang: "fr", now: NOW });
  batch = await nextPhase(db, (await startBatch(db, batch.id, { now: NOW })).id, { now: NOW });
  const stockRows = await stock(db, [{ name: "Sucre blanc", quantity: 500, unit: "g" }]);
  let lines = await listBatchLines(db, batch.id);
  batch = (await checkLine(db, batch, byName(lines, "Sucre blanc"), stockRows)).batch;
  await addJournalEntry(db, batch.id, { content: "Ça bulle.", now: NOW });
  const child = await createBatchForRecipe(db, { recipe, title: "K #2", volume: 1, starter: { batchId: batch.id, volume: 0.2 }, lang: "fr", now: NOW });

  lines = await listBatchLines(db, batch.id);
  const r = await runStockOperation(db, { kind: "batch_remove", payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines) } }, { now: NOW });
  assert.equal(r.removed_id, batch.id);
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 500);
  assert.equal(await getBatch(db, batch.id), null);
  for (const t of ["batch_ingredients", "batch_journal", "batch_phase_log"]) {
    assert.equal((await db.query(`select count(*) c from ${t} where batch_id = ?`, [batch.id]))[0].c, 0, t);
  }
  assert.equal((await getBatch(db, child.id)).starter_batch_id, null, "l'enfant reste, détaché");
  assert.equal((await db.query("select count(*) c from stock_movements where batch_id = ?", [batch.id]))[0].c, 2, "le journal des mouvements survit");
});

test("séparer en lots : lignes non prélevées de la phase courante et suivantes copiées, parent réduit, marqueur posé", async () => {
  const db = await freshDb();
  const { recipe, phases } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 2, lang: "fr", now: NOW });
  batch = await nextPhase(db, (await startBatch(db, batch.id, { now: NOW })).id, { now: NOW }); // F1
  const stockRows = await stock(db, [{ name: "Sucre blanc", quantity: 500, unit: "g" }]);
  let lines = await listBatchLines(db, batch.id);
  batch = (await checkLine(db, batch, byName(lines, "Sucre blanc"), stockRows)).batch; // sucre F1 prélevé
  lines = await listBatchLines(db, batch.id);
  const expectedPhases = phases.map(({ id, sort_order }) => ({ id, sort_order }));

  let r = await stockOperation(db, { kind: "batch_split", payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedPhases, lots: [{ name: "Lot 2", volume: 2 }], splitAt: NOW } }, { now: NOW });
  assert.equal(r.code, "STOCK_INVALID_PAYLOAD", "il doit rester du volume au parent");

  r = await runStockOperation(db, { kind: "batch_split", payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedPhases, lots: [{ name: "Lot figue", volume: 0.5 }, { name: "Lot citron", volume: 0.5 }], splitAt: NOW } }, { now: NOW });
  assert.equal(r.lots.length, 2);
  assert.equal(r.batch.volume, 1);
  assert.equal(r.batch.has_been_split, true);
  assert.ok(r.lots.every((l) => l.has_been_split && l.parent_batch_id === batch.id && l.status === "en_cours" && l.current_phase_id === phases[1].id));
  const lot = await listBatchLines(db, r.lots[0].id);
  const names = lot.map((l) => l.name).sort();
  assert.deepEqual(names, ["Eau", "Gingembre", "SCOBY"], "thé (phase passée) et sucre (prélevé) non copiés");
  assert.equal(byName(lot, "Eau").amount, 0.5, "2 L × 0,25");
  assert.equal(byName(lot, "Gingembre").amount, 10);
  const parent = await listBatchLines(db, batch.id);
  assert.equal(byName(parent, "Sucre blanc").amount, 0.14, "ligne prélevée intacte");
  assert.equal(byName(parent, "Eau").amount, 1, "2 L × 0,5");
  assert.equal(byName(parent, "Gingembre").amount, 20, "40 g × 0,5");

  // Le report en recette est bloqué des deux côtés.
  await assert.rejects(saveBatchAsNewVersion(db, batch.id), new RegExp(SPLIT_RECIPE_BLOCKED));
  await assert.rejects(saveBatchAsNewRecipe(db, r.lots[0].id, "Variante"), new RegExp(SPLIT_RECIPE_BLOCKED));
});

test("redimensionner : produit en croix sur les lignes non prélevées ; brassin en chaîne : eau recalculée, démarreur intact", async () => {
  const db = await freshDb();
  const { recipe, phases } = await kombucha(db);
  const first = await createBatchForRecipe(db, { recipe, title: "K1", volume: 2, lang: "fr", now: NOW });
  let batch = await createBatchForRecipe(db, { recipe, title: "K2", volume: 2, starter: { batchId: first.id, volume: 0.5 }, lang: "fr", now: NOW });
  let lines = await listBatchLines(db, batch.id);
  assert.equal(byName(lines, "Eau").amount, 1.5);
  const expectedPhases = phases.map(({ id, sort_order }) => ({ id, sort_order }));

  let r = await stockOperation(db, { kind: "batch_resize", payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedPhases, volume: 4, rescale: true, expectedBaseVolume: 3 } }, { now: NOW });
  assert.equal(r.code, "STOCK_STALE", "base affichée ≠ base réelle");

  r = await runStockOperation(db, { kind: "batch_resize", payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedPhases, volume: 4, rescale: true, expectedBaseVolume: 2 } }, { now: NOW });
  assert.equal(r.batch.volume, 4);
  assert.equal(r.batch.starter_volume, 0.5, "starter_volume ne bouge pas");
  lines = await listBatchLines(db, batch.id);
  assert.equal(byName(lines, "Eau").amount, 3.5, "(1,5 + 0,5) × 2 − 0,5");
  assert.equal(byName(lines, "Sucre blanc").amount, 0.28);
  assert.equal(lines.find((l) => l.name.startsWith("Liquide de démarrage")).amount, 0.5, "le démarreur est un fait, pas une proportion");

  // volume seul, sans recalcul
  batch = r.batch;
  lines = await listBatchLines(db, batch.id);
  r = await runStockOperation(db, { kind: "batch_resize", payload: { batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(lines), expectedPhases, volume: 5, rescale: false, expectedBaseVolume: 4 } }, { now: NOW });
  assert.equal(r.batch.volume, 5);
  assert.equal(byName(await listBatchLines(db, batch.id), "Eau").amount, 3.5);
});

test("courses : cocher crée ou incrémente le stock (conversion), sans quantité aucun mouvement, décocher ne retire rien", async () => {
  const db = await freshDb();
  const [idSucre, idMiel, idSel] = await addShoppingRows(db, [
    { name: "Sucre blanc", amount: 0.5, unit: "kg", category: "sucre" },
    { name: "Miel", amount: 250, unit: "g" },
    { name: "Sel" },
  ], { now: NOW });
  const [sucre] = await stock(db, [{ name: "Sucre blanc", quantity: 100, unit: "g", category: "sucre" }]);
  let items = await listShopping(db);
  const snap = stockSnapshot(await listStock(db));

  // candidat existant, kg → g
  let r = await runStockOperation(db, { kind: "shopping_set", payload: { shoppingId: idSucre, expectedRevision: 0, checked: true, stockId: sucre.id, expectedStock: snap } }, { now: NOW });
  assert.equal(r.shopping.checked, true);
  assert.equal(r.stock.quantity, 600);
  assert.equal(r.movements[0].delta, 500);
  assert.equal(r.movements[0].action, "shopping");

  // pas de candidat : stock créé depuis la ligne
  r = await runStockOperation(db, { kind: "shopping_set", payload: { shoppingId: idMiel, expectedRevision: 0, checked: true, stockId: null, expectedStock: stockSnapshot(await listStock(db)) } }, { now: NOW });
  assert.equal(r.stock.name, "Miel");
  assert.equal(r.stock.quantity, 250);
  assert.equal(r.stock.unit, "g");

  // sans quantité : stock créé à 0, raison no_amount
  r = await runStockOperation(db, { kind: "shopping_set", payload: { shoppingId: idSel, expectedRevision: 0, checked: true, stockId: null, expectedStock: stockSnapshot(await listStock(db)) } }, { now: NOW });
  assert.equal(r.movements[0].reason, "no_amount");
  assert.equal(r.stock.quantity, 0);

  // décocher : remis à acheter, stock intact
  items = await listShopping(db);
  r = await runStockOperation(db, { kind: "shopping_set", payload: { shoppingId: idSucre, expectedRevision: byName(items, "Sucre blanc").stock_revision, checked: false } }, { now: NOW });
  assert.equal(r.shopping.checked, false);
  assert.equal(r.movements[0].reason, "unchecked");
  assert.equal(byName(await listStock(db), "Sucre blanc").quantity, 600);

  assert.equal(await clearBought(db), 2);
  assert.equal(await removeShoppingItem(db, idSucre), true);
  assert.equal((await listShopping(db)).length, 0);
});

test("progression, dégustation sauvegardée à la saisie (W09), titre, journal, correction de date d'avancement", async () => {
  const db = await freshDb();
  const { recipe, phases } = await kombucha(db);
  let batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 1, lang: "fr", now: NOW });
  await assert.rejects(nextPhase(db, batch.id), /invalid_transition/);
  batch = await startBatch(db, batch.id, { now: NOW });
  assert.equal(batch.status, "en_cours");
  assert.equal(batch.current_phase_id, phases[0].id);
  assert.equal(batch.phase_started_at, NOW);

  // correction de la date d'entrée en phase → phase_started_at suit
  const log = await db.query("select * from batch_phase_log where batch_id = ? and stage = 'en_cours'", [batch.id]);
  await updateLogDate(db, batch.id, log[0].id, "2026-09-10T08:00:00.000Z");
  assert.equal((await getBatch(db, batch.id)).phase_started_at, "2026-09-10T08:00:00.000Z");
  await deleteLog(db, batch.id, log[0].id);
  assert.equal((await getBatch(db, batch.id)).phase_started_at, "2026-09-10T08:00:00.000Z", "plus d'entrée : date héritée conservée");

  const note = await addJournalEntry(db, batch.id, { content: "  Odeur acide.  ", category: "gout", now: NOW });
  assert.equal(note.content, "Odeur acide.");
  assert.equal(note.phase_id, phases[0].id);
  assert.equal(await addJournalEntry(db, batch.id, { content: "   " }), null);

  await renameBatch(db, batch.id, "Kombucha figue");
  await assert.rejects(renameBatch(db, batch.id, "  "), /title_required/);

  batch = await nextPhase(db, batch.id, { now: NOW });
  batch = await nextPhase(db, batch.id, { now: NOW });
  batch = await nextPhase(db, batch.id, { now: NOW });
  assert.equal(batch.status, "degustation");
  await saveTasting(db, batch.id, { rating: 4, notes: "Pétillant, un peu vinaigré." });
  const full = await getBatchFull(db, batch.id);
  assert.equal(full.batch.rating, 4, "la dégustation est en base avant l'archivage");
  assert.equal(full.batch.title, "Kombucha figue");
  assert.equal(full.journal.length, 1);
  batch = await archiveBatch(db, batch.id, { rating: 5, notes: "Finalement excellent.", now: NOW });
  assert.equal(batch.status, "archive");
  assert.equal(batch.rating, 5);
  assert.equal(batch.completed_at, NOW);

  const list = await listBatches(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].recipes.title, "Kombucha");
  assert.equal((await listBatches(db, { includeArchived: false })).length, 0);
});

test("report du brassin dans la recette : nouvelle version ramenée au volume de référence ; nouvelle recette telle que brassée", async () => {
  const db = await freshDb();
  const { recipe } = await kombucha(db);
  const batch = await createBatchForRecipe(db, { recipe, title: "K", volume: 2, lang: "fr", now: NOW });
  const lines = await listBatchLines(db, batch.id);
  // 40 g de gingembre (2 L) → 60 g : en recette (1 L) ça fait 30 g
  const ging = byName(lines, "Gingembre");
  await runStockOperation(db, { kind: "batch_ingredient_edit", payload: { batchId: batch.id, lineId: ging.id, expectedRevision: ging.stock_revision, expectedBatchRevision: batch.stock_revision, values: { amount: 60 } } }, { now: NOW });

  const v = await saveBatchAsNewVersion(db, batch.id, { now: NOW });
  assert.equal(v.version, 2);
  const full = await getRecipeFull(db, recipe.id);
  assert.equal(full.recipe.current_version, 2);
  assert.equal(byName(full.ingredients, "Gingembre").amount, 30);
  assert.equal(full.versions.length, 1);
  assert.equal(full.phases.length, 3, "les phases ne sont pas touchées");

  const created = await saveBatchAsNewRecipe(db, batch.id, "Kombucha gingembre fort", { now: NOW });
  const nr = await getRecipeFull(db, created.recipeId);
  assert.equal(nr.recipe.batch_size_ref, 2);
  assert.equal(byName(nr.ingredients, "Gingembre").amount, 60);
  assert.equal(nr.phases.length, 3);
  assert.ok(nr.ingredients.every((l) => l.phase_id == null || nr.phases.some((p) => p.id === l.phase_id)), "phases remappées");

  const otf = await createRecipeOnTheFly(db, { title: "Vite fait", type: "cidre", volume: 5, lang: "fr", now: NOW });
  const otfFull = await getRecipeFull(db, otf.id);
  assert.equal(otfFull.phases.map((p) => p.name).join("|"), "Fermentation|Garde");
});
