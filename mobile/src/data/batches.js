// Couche données « brassins » du carnet local. Pure : reçoit un pilote,
// aucune dépendance plateforme. Tout geste qui écrit plusieurs lignes est UNE
// transaction (contrat W06 : un brassin est créé entier ou pas du tout).
//
// Les gestes qui touchent le stock (cocher un ingrédient, retirer une ligne,
// revenir de phase, supprimer, séparer, redimensionner) passent par
// stockOperations.js ; ici : création, progression, journal, dégustation,
// titre, report en recette, lignes non prélevées, relations (lots, relances).

import { RECIPE_TYPES } from "../../../lib/recipeTypes.js";
import { applyStarterToRows, starterPhaseId, withoutStarterAdjustment } from "../../../lib/rollingBatch.js";
import { scaleRatio, toRecipeRows } from "../../../lib/batchRecipeDiff.js";
import { newId, nowIso, rowToBatch, rowToLine, rowToRecipe, rowToRecipeIngredient } from "./rows.js";
import { phaseName } from "@/lib/recipeTypes";
import { t } from "@/lib/i18n";

async function one(db, sql, params) {
  return (await db.query(sql, params))[0] ?? null;
}

async function insertPhaseLog(db, batchId, stage, phaseId, at) {
  await db.run("insert into batch_phase_log (id, batch_id, stage, phase_id, entered_at) values (?, ?, ?, ?, ?)", [newId(), batchId, stage, phaseId ?? null, at]);
}

const touchBatch = (db, id) => db.run("update batches set stock_revision = stock_revision + 1 where id = ?", [id]);

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

// Liste enrichie : titre de la recette et phase courante (nom, durée), comme
// la jointure `recipes(title), recipe_phases(...)` du site.
export async function listBatches(db, { includeArchived = true } = {}) {
  const rows = await db.query(
    `select b.*, r.title as recipe_title, p.name as phase_name, p.duration_value as phase_duration_value, p.duration_unit as phase_duration_unit
     from batches b
     left join recipes r on r.id = b.recipe_id
     left join recipe_phases p on p.id = b.current_phase_id
     ${includeArchived ? "" : "where b.status <> 'archive'"}
     order by b.created_at desc`,
  );
  return rows.map((r) => ({
    ...rowToBatch(r),
    recipes: r.recipe_title != null ? { title: r.recipe_title } : null,
    recipe_phases: r.phase_name != null ? { name: r.phase_name, duration_value: r.phase_duration_value, duration_unit: r.phase_duration_unit } : null,
  }));
}

export async function getBatch(db, id) {
  return rowToBatch(await one(db, "select * from batches where id = ?", [id]));
}

export async function listBatchLines(db, batchId) {
  return (await db.query("select * from batch_ingredients where batch_id = ? order by id", [batchId])).map(rowToLine);
}

// Tout ce que la fiche brassin affiche, en une lecture.
export async function getBatchFull(db, id) {
  const batch = await getBatch(db, id);
  if (!batch) return null;
  const recipe = batch.recipe_id ? rowToRecipe(await one(db, "select * from recipes where id = ?", [batch.recipe_id])) : null;
  const phases = recipe ? await db.query("select * from recipe_phases where recipe_id = ? order by sort_order, id", [recipe.id]) : [];
  const recipeIngredients = recipe ? (await db.query("select * from recipe_ingredients where recipe_id = ? order by sort_order", [recipe.id])).map(rowToRecipeIngredient) : [];
  const lines = await listBatchLines(db, id);
  const stock = await db.query("select * from ingredients order by id");
  const aliases = await db.query("select alias, stock_name from ingredient_aliases order by alias");
  const log = await db.query("select * from batch_phase_log where batch_id = ? order by entered_at, id", [id]);
  const journal = await db.query("select * from batch_journal where batch_id = ? order by timestamp desc, id desc", [id]);
  const lots = (await db.query("select * from batches where parent_batch_id = ? order by created_at, id", [id])).map(rowToBatch);
  const lotIngredients = lots.length
    ? (await db.query(`select * from batch_ingredients where batch_id in (${lots.map(() => "?").join(",")}) order by id`, lots.map((l) => l.id))).map(rowToLine)
    : [];
  const parentBatch = batch.parent_batch_id ? await one(db, "select id, title from batches where id = ?", [batch.parent_batch_id]) : null;
  const starterSource = batch.starter_batch_id ? await one(db, "select id, title from batches where id = ?", [batch.starter_batch_id]) : null;
  const rolledInto = await db.query("select id, title, starter_volume from batches where starter_batch_id = ? order by created_at, id", [id]);
  return { batch, recipe, phases, recipeIngredients, lines, stock, aliases, log, journal, lots, lotIngredients, parentBatch, starterSource, rolledInto };
}

// ---------------------------------------------------------------------------
// Création (miroir de lib/createBatch.js, en une transaction, sans quota)
// ---------------------------------------------------------------------------

export async function createBatchForRecipe(db, { recipe, title, volume, starter = null, lang = "en", now } = {}) {
  const ts = nowIso(now);
  const reuse = starter?.batchId && Number(starter.volume) > 0 ? Number(starter.volume) : 0;
  return db.transaction(async () => {
    const r = rowToRecipe(await one(db, "select * from recipes where id = ?", [recipe.id]));
    if (!r) throw new Error(t("common.recipeNotFound", null, lang));
    // Rebrasser une recette d'archive la remet dans la liste des recettes.
    if (r.archived) await db.run("update recipes set archived = 0, updated_at = ? where id = ?", [ts, r.id]);
    let source = null;
    if (reuse > 0) {
      source = await one(db, "select id, title, culture_generation from batches where id = ?", [starter.batchId]);
      if (!source) throw new Error(t("batch.starterBatchNotFound", null, lang));
    }
    const id = newId();
    const vol = volume ? Number(volume) : null;
    await db.run(
      `insert into batches (id, recipe_id, title, volume, status, created_at, starter_batch_id, starter_volume, culture_generation)
       values (?, ?, ?, ?, 'planifie', ?, ?, ?, ?)`,
      [id, r.id, String(title || r.title).trim() || r.title, vol, ts, source?.id ?? null, source ? reuse : null,
        source ? (Number(source.culture_generation) || 1) + 1 : null],
    );
    await insertPhaseLog(db, id, "planifie", null, ts);

    const ri = (await db.query("select * from recipe_ingredients where recipe_id = ? order by sort_order", [r.id])).map(rowToRecipeIngredient);
    const ratio = r.batch_size_ref && vol ? vol / Number(r.batch_size_ref) : 1;
    let rows = ri.map((x) => ({
      phase_id: x.phase_id,
      category: x.category,
      name: x.name,
      amount: Math.round(x.amount * ratio * 100) / 100,
      unit: x.unit,
      is_starter: x.is_starter || false,
    }));
    if (source) {
      const phases = await db.query("select id, name, sort_order from recipe_phases where recipe_id = ? order by sort_order", [r.id]);
      const waterPhase = rows.find((x) => /^(eau|water)/i.test(x.name || ""))?.phase_id ?? null;
      rows = applyStarterToRows(rows, {
        starterVolume: reuse,
        starterName: t("batch.starterLiquid", { title: source.title }, lang),
        phaseId: starterPhaseId(phases, waterPhase),
      }).rows;
    }
    if (rows.length > 0) {
      await db.runBatch(rows.map((x) => ({
        sql: "insert into batch_ingredients (id, batch_id, phase_id, category, name, amount, unit, is_starter) values (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [newId(), id, x.phase_id ?? null, x.category || "autre", x.name, x.amount, x.unit || "g", x.is_starter ? 1 : 0],
      })));
    }
    return getBatch(db, id);
  });
}

// Recette créée à la volée depuis le formulaire de brassin : titre + type +
// phases par défaut du type, aucun ingrédient.
export async function createRecipeOnTheFly(db, { title, type, volume, lang = "en", now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const id = newId();
    await db.run(
      "insert into recipes (id, title, type, source_type, batch_size_ref, current_version, tags, created_at, updated_at) values (?, ?, ?, 'manual', ?, 1, '[]', ?, ?)",
      [id, String(title).trim(), type, volume ? Number(volume) : null, ts, ts],
    );
    const template = RECIPE_TYPES[type]?.phaseTemplate || [];
    for (let i = 0; i < template.length; i++) {
      const tpl = template[i];
      await db.run("insert into recipe_phases (id, recipe_id, name, sort_order, duration_value, duration_unit, temperature_target) values (?, ?, ?, ?, ?, ?, ?)", [
        newId(), id, phaseName(tpl, lang), i, tpl.durationValue ?? null, tpl.durationUnit || null, tpl.temperatureTarget ?? null,
      ]);
    }
    return rowToRecipe(await one(db, "select * from recipes where id = ?", [id]));
  });
}

// ---------------------------------------------------------------------------
// Progression (démarrer, phase suivante, archiver) — le retour de phase passe
// par stockOperation("batch_previous_phase")
// ---------------------------------------------------------------------------

export async function startBatch(db, batchId, { now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b) throw new Error("batch_not_found");
    if (b.status !== "planifie") throw new Error("invalid_transition");
    const phases = b.recipe_id ? await db.query("select id from recipe_phases where recipe_id = ? order by sort_order, id", [b.recipe_id]) : [];
    if (phases.length === 0) {
      await db.run("update batches set status = 'degustation', stock_revision = stock_revision + 1 where id = ?", [batchId]);
      await insertPhaseLog(db, batchId, "degustation", null, ts);
    } else {
      await db.run("update batches set status = 'en_cours', current_phase_id = ?, phase_started_at = ?, stock_revision = stock_revision + 1 where id = ?", [phases[0].id, ts, batchId]);
      await insertPhaseLog(db, batchId, "en_cours", phases[0].id, ts);
    }
    return getBatch(db, batchId);
  });
}

export async function nextPhase(db, batchId, { now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b) throw new Error("batch_not_found");
    if (b.status !== "en_cours") throw new Error("invalid_transition");
    const phases = b.recipe_id ? await db.query("select id from recipe_phases where recipe_id = ? order by sort_order, id", [b.recipe_id]) : [];
    const idx = phases.findIndex((p) => p.id === b.current_phase_id);
    // idx === -1 : la phase courante n'existe plus (recette modifiée) → on
    // saute à la dégustation plutôt que de reboucler sur la première phase.
    const next = idx === -1 ? undefined : phases[idx + 1];
    if (next) {
      await db.run("update batches set current_phase_id = ?, phase_started_at = ?, stock_revision = stock_revision + 1 where id = ?", [next.id, ts, batchId]);
      await insertPhaseLog(db, batchId, "en_cours", next.id, ts);
    } else {
      await db.run("update batches set status = 'degustation', current_phase_id = null, stock_revision = stock_revision + 1 where id = ?", [batchId]);
      await insertPhaseLog(db, batchId, "degustation", null, ts);
    }
    return getBatch(db, batchId);
  });
}

export async function archiveBatch(db, batchId, { rating = null, notes = null, now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b) throw new Error("batch_not_found");
    if (b.status !== "degustation") throw new Error("invalid_transition");
    await db.run("update batches set status = 'archive', completed_at = ?, rating = ?, notes = ?, stock_revision = stock_revision + 1 where id = ?", [
      ts, rating ?? null, (notes || "").trim() || null, batchId,
    ]);
    await insertPhaseLog(db, batchId, "archive", null, ts);
    return getBatch(db, batchId);
  });
}

// Dégustation (note + étoiles) enregistrée dès la saisie — contrat W09 : un
// brouillon ne doit plus disparaître au prochain rechargement de la fiche.
export async function saveTasting(db, batchId, { rating, notes }) {
  const r = await db.run("update batches set rating = ?, notes = ? where id = ?", [rating ?? null, (notes ?? "").trim() || null, batchId]);
  if (r.changes !== 1) throw new Error("batch_not_found");
  await db.persist();
}

export async function renameBatch(db, batchId, title) {
  const next = String(title || "").trim();
  if (!next) throw new Error("title_required");
  await db.transaction(async () => {
    const r = await db.run("update batches set title = ?, stock_revision = stock_revision + 1 where id = ?", [next, batchId]);
    if (r.changes !== 1) throw new Error("batch_not_found");
  });
}

// ---------------------------------------------------------------------------
// Journal et avancement
// ---------------------------------------------------------------------------

export async function addJournalEntry(db, batchId, { content, category = "observation", now } = {}) {
  const text = String(content || "").trim();
  if (!text) return null;
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b) throw new Error("batch_not_found");
    const id = newId();
    await db.run("insert into batch_journal (id, batch_id, phase_id, timestamp, content, category) values (?, ?, ?, ?, ?, ?)", [
      id, batchId, b.status === "en_cours" ? b.current_phase_id : null, nowIso(now), text, category,
    ]);
    return one(db, "select * from batch_journal where id = ?", [id]);
  });
}

// Après une correction ou une suppression dans l'avancement, le départ de la
// phase courante suit la plus récente entrée `en_cours` de cette phase (sinon
// l'échéance compterait depuis une date fausse). S'il n'en reste aucune, on
// garde la date héritée.
async function syncPhaseStart(db, batchId) {
  const b = await getBatch(db, batchId);
  if (!b || b.status !== "en_cours" || !b.current_phase_id) return;
  const latest = await one(db, "select entered_at from batch_phase_log where batch_id = ? and stage = 'en_cours' and phase_id = ? order by entered_at desc limit 1", [batchId, b.current_phase_id]);
  if (latest) await db.run("update batches set phase_started_at = ? where id = ?", [latest.entered_at, batchId]);
}

export async function updateLogDate(db, batchId, logId, enteredAt) {
  const iso = new Date(enteredAt).toISOString();
  await db.transaction(async () => {
    const r = await db.run("update batch_phase_log set entered_at = ? where id = ? and batch_id = ?", [iso, logId, batchId]);
    if (r.changes !== 1) throw new Error("log_not_found");
    await syncPhaseStart(db, batchId);
    await touchBatch(db, batchId);
  });
}

export async function deleteLog(db, batchId, logId) {
  await db.transaction(async () => {
    const r = await db.run("delete from batch_phase_log where id = ? and batch_id = ?", [logId, batchId]);
    if (r.changes !== 1) throw new Error("log_not_found");
    await syncPhaseStart(db, batchId);
    await touchBatch(db, batchId);
  });
}

// ---------------------------------------------------------------------------
// Lignes non prélevées (ajout direct) et alias
// ---------------------------------------------------------------------------

export async function addBatchIngredient(db, batchId, values) {
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b) throw new Error("batch_not_found");
    const id = newId();
    await db.run("insert into batch_ingredients (id, batch_id, phase_id, category, name, amount, unit, is_starter) values (?, ?, ?, ?, ?, ?, ?, ?)", [
      id, batchId, values.phase_id ?? null, values.category || "autre", String(values.name).trim(), Number(values.amount) || 0, values.unit || "g", values.is_starter ? 1 : 0,
    ]);
    await touchBatch(db, batchId);
    return rowToLine(await one(db, "select * from batch_ingredients where id = ?", [id]));
  });
}

export async function upsertAlias(db, alias, stockName, { now } = {}) {
  await db.transaction(async () => {
    await db.run("insert into ingredient_aliases (id, alias, stock_name, created_at) values (?, ?, ?, ?) on conflict(alias) do update set stock_name = excluded.stock_name", [
      newId(), alias, stockName, nowIso(now),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Report du brassin dans la recette (nouvelle version / nouvelle recette)
// ---------------------------------------------------------------------------

export const SPLIT_RECIPE_BLOCKED = "split_recipe_blocked";

async function assertReportAllowed(db, batch) {
  const kids = await one(db, "select id from batches where parent_batch_id = ? limit 1", [batch.id]);
  if (batch.has_been_split || batch.parent_batch_id || kids) throw new Error(SPLIT_RECIPE_BLOCKED);
}

// Nouvelle version : on n'écrit QUE les ingrédients (les phases restent, sinon
// ce brassin et les autres en cours perdraient leur phase courante).
export async function saveBatchAsNewVersion(db, batchId, { now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b || !b.recipe_id) throw new Error("batch_not_found");
    await assertReportAllowed(db, b);
    const prev = rowToRecipe(await one(db, "select * from recipes where id = ?", [b.recipe_id]));
    if (!prev) throw new Error("recipe_not_found");
    const prevPhases = await db.query("select * from recipe_phases where recipe_id = ? order by sort_order", [prev.id]);
    const prevIngredients = (await db.query("select * from recipe_ingredients where recipe_id = ? order by sort_order", [prev.id])).map(rowToRecipeIngredient);
    const prevVersion = prev.current_version || 1;
    await db.run("insert into recipe_versions (id, recipe_id, version, snapshot, created_at) values (?, ?, ?, ?, ?)", [
      newId(), prev.id, prevVersion, JSON.stringify({ recipe: prev, phases: prevPhases, ingredients: prevIngredients }), ts,
    ]);
    const lines = withoutStarterAdjustment(await listBatchLines(db, batchId), b.starter_volume);
    const ratio = scaleRatio(b.volume, prev.batch_size_ref);
    const rows = toRecipeRows(lines, prevIngredients, { recipeId: prev.id, ratio });
    await db.run("delete from recipe_ingredients where recipe_id = ?", [prev.id]);
    if (rows.length) {
      await db.runBatch(rows.map((r) => ({
        sql: "insert into recipe_ingredients (id, recipe_id, phase_id, category, name, amount, unit, sub_type, alpha_acid_pct, timing, sort_order, is_starter) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [newId(), r.recipe_id, r.phase_id, r.category, r.name, r.amount, r.unit, r.sub_type, r.alpha_acid_pct, r.timing, r.sort_order, r.is_starter ? 1 : 0],
      })));
    }
    await db.run("update recipes set current_version = ?, updated_at = ? where id = ?", [prevVersion + 1, ts, prev.id]);
    return { recipeId: prev.id, version: prevVersion + 1 };
  });
}

// Nouvelle recette : ce qui a été brassé, tel quel (ratio 1), volume du brassin
// en référence. Phases recopiées avec de nouveaux identifiants.
export async function saveBatchAsNewRecipe(db, batchId, title, { now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const b = await getBatch(db, batchId);
    if (!b || !b.recipe_id) throw new Error("batch_not_found");
    await assertReportAllowed(db, b);
    const src = rowToRecipe(await one(db, "select * from recipes where id = ?", [b.recipe_id]));
    if (!src) throw new Error("recipe_not_found");
    const phases = await db.query("select * from recipe_phases where recipe_id = ? order by sort_order, id", [src.id]);
    const srcIngredients = (await db.query("select * from recipe_ingredients where recipe_id = ? order by sort_order", [src.id])).map(rowToRecipeIngredient);
    const id = newId();
    await db.run(
      "insert into recipes (id, title, type, source_type, instructions, style, batch_size_ref, current_version, tags, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 1, '[]', ?, ?)",
      [id, String(title).trim(), src.type, src.source_type, src.instructions, src.style, b.volume ?? src.batch_size_ref, ts, ts],
    );
    const phaseIdMap = {};
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const pid = newId();
      phaseIdMap[p.id] = pid;
      await db.run("insert into recipe_phases (id, recipe_id, name, sort_order, duration_value, duration_unit, temperature_target, notes) values (?, ?, ?, ?, ?, ?, ?, ?)", [
        pid, id, p.name, i, p.duration_value, p.duration_unit, p.temperature_target, p.notes,
      ]);
    }
    const lines = withoutStarterAdjustment(await listBatchLines(db, batchId), b.starter_volume);
    const rows = toRecipeRows(lines, srcIngredients, { recipeId: id, ratio: 1, phaseIdMap });
    if (rows.length) {
      await db.runBatch(rows.map((r) => ({
        sql: "insert into recipe_ingredients (id, recipe_id, phase_id, category, name, amount, unit, sub_type, alpha_acid_pct, timing, sort_order, is_starter) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [newId(), r.recipe_id, r.phase_id, r.category, r.name, r.amount, r.unit, r.sub_type, r.alpha_acid_pct, r.timing, r.sort_order, r.is_starter ? 1 : 0],
      })));
    }
    return { recipeId: id };
  });
}
