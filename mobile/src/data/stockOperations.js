// Opérations de stock du carnet local : traduction en JavaScript de la RPC
// `public.stock_operation` (supabase/migrations/20260909010000_stock_operations.sql,
// contrat docs/LOT2-RPC-CONTRACT.md), au-dessus du pilote SQLite.
//
// Ce qui est conservé du contrat :
// - une opération = UNE transaction : tous les effets métier (stock, lignes,
//   brassins, journal des mouvements) sont écrits ou aucun ;
// - révisions (`stock_revision`) vérifiées sous transaction : une opération
//   préparée sur des données périmées est refusée (STOCK_STALE), jamais
//   appliquée par-dessus un autre changement ;
// - journal `stock_movements` en ajout seul : chaque prélèvement, restitution,
//   achat et correction y laisse une trace (delta signé, unité du stock,
//   quantités avant/après, raison quand il n'y a pas de mouvement) ;
// - rejeu : même `requestId` + mêmes arguments = même résultat, sans nouvel
//   effet ; même clé avec d'autres arguments = STOCK_REQUEST_COLLISION ;
// - anciennes lignes cochées sans trace (`deducted && !stock_movement_id`,
//   possibles après import d'un carnet web en L3) : restitution refusée sauf
//   `legacyNoRestock: true`, qui journalise le renoncement (rien remis en stock).
//
// Ce qui tombe, parce qu'il n'y a plus ni serveur ni compte : identité
// (`user_id`, `p_expected_user_id`), RLS, verrous d'avis, quota Free sur les
// lots. Les refus métier renvoient `{ ok: false, code }` et sont mémorisés
// comme en SQL ; une erreur imprévue annule tout et remonte.

import { convertAmount, round2 } from "../../../lib/units.js";
import { isDilutionWater } from "../../../lib/rollingBatch.js";
import { newId, nowIso, rowToBatch, rowToLine, rowToMovement, rowToShopping } from "./rows.js";
import { canonicalJson } from "./exportImport.js";
import { t } from "@/lib/i18n";

export const STOCK_KINDS = [
  "batch_ingredient_set", "batch_ingredient_edit", "batch_ingredient_remove",
  "batch_previous_phase", "batch_remove", "batch_split", "batch_resize",
  "shopping_set", "stock_create", "stock_update", "stock_remove",
];

// Refus métier : conservé comme résultat `ok: false`, sans effet.
class Refusal extends Error {
  constructor(code) {
    super(code);
    this.name = "StockRefusal";
    this.code = code;
  }
}
const refuse = (code) => {
  throw new Refusal(code);
};

// Erreur remontée à l'appelant (collision de clé, ou refus quand on préfère
// une exception au résultat).
export class StockOperationError extends Error {
  constructor(code, result = null) {
    super(code);
    this.name = "StockOperationError";
    this.code = code;
    this.result = result;
  }
}

// ---------------------------------------------------------------------------
// Assertions du contrat (miroir de stock_private.assert_* et validate_values)
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertKeys(value, required, optional = []) {
  if (!isPlainObject(value)) refuse("STOCK_INVALID_PAYLOAD");
  for (const k of required) if (!Object.hasOwn(value, k)) refuse("STOCK_INVALID_PAYLOAD");
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(value)) if (!allowed.has(k)) refuse("STOCK_INVALID_PAYLOAD");
}

function assertRevision(expected, actual) {
  if (!Number.isInteger(expected) || expected < 0) refuse("STOCK_INVALID_PAYLOAD");
  if (expected !== Number(actual)) refuse("STOCK_STALE");
}

// `expected` : [{ id, stock_revision }] ; `actualRows` : lignes en base.
function assertSnapshot(expected, actualRows) {
  if (!Array.isArray(expected)) refuse("STOCK_INVALID_PAYLOAD");
  const ids = new Set();
  const norm = expected.map((e) => {
    if (!isPlainObject(e) || typeof e.id !== "string" || !Number.isInteger(e.stock_revision) || e.stock_revision < 0 || ids.has(e.id)) refuse("STOCK_INVALID_PAYLOAD");
    ids.add(e.id);
    return `${e.id}:${e.stock_revision}`;
  }).sort();
  const actual = actualRows.map((r) => `${r.id}:${Number(r.stock_revision)}`).sort();
  if (norm.length !== actual.length || norm.some((v, i) => v !== actual[i])) refuse("STOCK_STALE");
}

const NULLABLE_VALUES = new Set(["phase_id", "expiry_date", "supplier", "low_stock_threshold"]);
function validateValues(values) {
  if (!isPlainObject(values) || Object.keys(values).length === 0) refuse("STOCK_INVALID_PAYLOAD");
  for (const [k, v] of Object.entries(values)) {
    if (v === null) {
      if (!NULLABLE_VALUES.has(k)) refuse("STOCK_INVALID_PAYLOAD");
    } else if (k === "amount" || k === "quantity" || k === "low_stock_threshold") {
      if (typeof v !== "number" || !Number.isFinite(v)) refuse("STOCK_INVALID_PAYLOAD");
      if (k !== "quantity" && v < 0) refuse("STOCK_INVALID_PAYLOAD");
    } else if (k === "is_starter") {
      if (typeof v !== "boolean") refuse("STOCK_INVALID_PAYLOAD");
    } else {
      if (typeof v !== "string") refuse("STOCK_INVALID_PAYLOAD");
      if (k === "name" && v.trim() === "") refuse("STOCK_INVALID_PAYLOAD");
    }
  }
}

function finiteNonNegative(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

// ---------------------------------------------------------------------------
// Accès aux lignes (toutes les lectures sous la transaction courante)
// ---------------------------------------------------------------------------

async function one(db, sql, params) {
  const rows = await db.query(sql, params);
  return rows[0] ?? null;
}

const getBatch = async (db, id) => rowToBatch(await one(db, "select * from batches where id = ?", [id]));
const getLine = async (db, id, batchId) => rowToLine(await one(db, "select * from batch_ingredients where id = ? and batch_id = ?", [id, batchId]));
const getStock = async (db, id) => one(db, "select * from ingredients where id = ?", [id]);
const getShopping = async (db, id) => rowToShopping(await one(db, "select * from shopping_list where id = ?", [id]));
const getMovement = async (db, id) => rowToMovement(await one(db, "select * from stock_movements where id = ?", [id]));
const batchLines = async (db, batchId) => (await db.query("select * from batch_ingredients where batch_id = ? order by id", [batchId])).map(rowToLine);
const allStock = (db) => db.query("select * from ingredients order by id");

// Révisions : ce que faisaient les triggers touch_* côté Postgres.
const touchStock = (db, id) => db.run("update ingredients set stock_revision = stock_revision + 1, updated_at = ? where id = ?", [nowIso(), id]);
const touchBatch = (db, id) => db.run("update batches set stock_revision = stock_revision + 1 where id = ?", [id]);
async function touchLine(db, lineId, batchId) {
  await db.run("update batch_ingredients set stock_revision = stock_revision + 1 where id = ?", [lineId]);
  await touchBatch(db, batchId);
}

async function insertMovement(db, ctx, fields) {
  const id = newId();
  const cols = { id, request_id: ctx.requestId, created_at: ctx.now, amount: 0, delta: 0, ...fields };
  if (cols.line_snapshot && typeof cols.line_snapshot !== "string") cols.line_snapshot = JSON.stringify(cols.line_snapshot);
  const keys = Object.keys(cols);
  await db.run(`insert into stock_movements (${keys.join(", ")}) values (${keys.map(() => "?").join(", ")})`, keys.map((k) => cols[k] ?? null));
  return id;
}

// Arrondi à 6 décimales : SQLite calcule en flottant (0,86 + 0,5 donnerait
// 1,3599999…) là où Postgres avait du numeric exact. Six décimales gardent le
// milligramme sur un stock en kilos et effacent le bruit binaire.
async function adjustStockQuantity(db, stock, delta) {
  await db.run("update ingredients set quantity = round(quantity + ?, 6) where id = ?", [delta, stock.id]);
  await touchStock(db, stock.id);
}

// ---------------------------------------------------------------------------
// Prélèvement, restitution, renoncement (miroir de consume_line / restore_line
// / waive_legacy_line)
// ---------------------------------------------------------------------------

async function consumeLine(db, ctx, line, stockId, strict = false, noMovement = null) {
  if (!finiteNonNegative(Number(line.amount))) refuse("STOCK_INVALID_PAYLOAD");
  let stock = null;
  if (stockId != null) {
    stock = await getStock(db, stockId);
    if (!stock) refuse("STOCK_NOT_FOUND");
  }
  let amount = 0;
  let why = noMovement;
  if (line.is_starter) why = "starter";
  else if (why != null) {
    /* raison imposée par l'appelant (édition : non-mouvement explicite conservé) */
  } else if (!stock) why = "no_stock";
  else {
    amount = convertAmount(line.amount, line.unit, stock.unit);
    if (amount == null) {
      if (strict) refuse("STOCK_UNIT_INCOMPATIBLE");
      why = "incompatible_unit";
      amount = 0;
    } else if (amount === 0) why = "zero_amount";
  }
  const before = stock ? Number(stock.quantity) : null;
  if (amount !== 0) await adjustStockQuantity(db, stock, -amount);
  return insertMovement(db, ctx, {
    action: "batch_debit",
    batch_id: line.batch_id,
    line_id: line.id,
    stock_id: stock?.id ?? null,
    amount,
    delta: -amount,
    unit: stock?.unit ?? null,
    reason: why,
    quantity_before: before,
    quantity_after: before == null ? null : round2(before - amount),
  });
}

async function restoreLine(db, ctx, line) {
  if (!line.deducted) return;
  if (!line.stock_movement_id) refuse("STOCK_LEGACY_TRACE_REQUIRED");
  const m = await getMovement(db, line.stock_movement_id);
  const reversed = m ? await one(db, "select id from stock_movements where reverses = ?", [m.id]) : null;
  if (!m || m.action !== "batch_debit" || m.line_id !== line.id || m.batch_id !== line.batch_id || Number(m.delta) > 0 || reversed) {
    refuse("STOCK_TRACE_INVALID");
  }
  let delta = 0;
  let stock = null;
  if (Number(m.delta) !== 0) {
    stock = await getStock(db, m.stock_id);
    if (!stock) refuse("STOCK_RESTORE_TARGET_MISSING");
    delta = convertAmount(m.amount, m.unit, stock.unit);
    if (delta == null) refuse("STOCK_UNIT_INCOMPATIBLE");
    await adjustStockQuantity(db, stock, delta);
  }
  const before = stock ? Number(stock.quantity) : null;
  await insertMovement(db, ctx, {
    action: "batch_restore",
    batch_id: line.batch_id,
    line_id: line.id,
    stock_id: m.stock_id,
    amount: Math.abs(delta),
    delta,
    unit: stock?.unit ?? m.unit,
    reason: m.reason,
    reverses: m.id,
    quantity_before: before,
    quantity_after: before == null ? null : round2(before + delta),
  });
}

async function waiveLegacyLine(db, ctx, line, confirmed, action) {
  if (line.deducted !== true || line.stock_movement_id != null || !["batch_debit", "batch_restore"].includes(action)) refuse("STOCK_TRACE_INVALID");
  if (confirmed !== true) refuse("STOCK_LEGACY_TRACE_REQUIRED");
  return insertMovement(db, ctx, {
    action,
    batch_id: line.batch_id,
    line_id: line.id,
    reason: "legacy_waived",
    line_snapshot: { ...line, deducted: line.deducted ? 1 : 0, is_starter: line.is_starter ? 1 : 0 },
  });
}

// Restitue ou renonce, selon la trace de la ligne.
async function releaseLine(db, ctx, line, legacyNoRestock) {
  if (line.deducted && !line.stock_movement_id) await waiveLegacyLine(db, ctx, line, legacyNoRestock, "batch_restore");
  else await restoreLine(db, ctx, line);
}

// ---------------------------------------------------------------------------
// Les onze opérations
// ---------------------------------------------------------------------------

async function opBatchIngredient(db, ctx, kind, p) {
  const legacy = p.legacyNoRestock === true;
  let used = null;
  if (kind === "batch_ingredient_set") {
    if (typeof p.deducted !== "boolean") refuse("STOCK_INVALID_PAYLOAD");
    used = p.deducted;
    assertKeys(p, ["batchId", "lineId", "expectedRevision", "expectedBatchRevision", "deducted", ...(used ? ["stockId", "expectedStock"] : [])], used ? [] : ["legacyNoRestock"]);
  } else if (kind === "batch_ingredient_edit") {
    assertKeys(p, ["batchId", "lineId", "expectedRevision", "expectedBatchRevision", "values"], ["legacyNoRestock"]);
  } else {
    assertKeys(p, ["batchId", "lineId", "expectedRevision", "expectedBatchRevision"], ["legacyNoRestock"]);
  }
  let b = await getBatch(db, p.batchId);
  if (!b) refuse("STOCK_NOT_FOUND");
  assertRevision(p.expectedBatchRevision, b.stock_revision);
  let line = await getLine(db, p.lineId, b.id);
  if (!line) refuse("STOCK_NOT_FOUND");
  assertRevision(p.expectedRevision, line.stock_revision);
  const result = {};

  if (kind === "batch_ingredient_set") {
    let candidate = null;
    if (used) {
      assertSnapshot(p.expectedStock, await allStock(db));
      candidate = p.stockId ?? null;
      if (candidate != null && !(await getStock(db, candidate))) refuse("STOCK_NOT_FOUND");
    }
    if (line.deducted !== used) {
      let movement = null;
      if (used) movement = await consumeLine(db, ctx, line, candidate);
      else await releaseLine(db, ctx, line, legacy);
      await db.run("update batch_ingredients set deducted = ?, deducted_at = ?, stock_movement_id = ? where id = ?", [used ? 1 : 0, used ? ctx.now : null, movement, line.id]);
      await touchLine(db, line.id, b.id);
    } else {
      await insertMovement(db, ctx, { action: "batch_unchanged", batch_id: b.id, line_id: line.id, reason: "unchanged" });
    }
    line = await getLine(db, line.id, b.id);
  } else if (kind === "batch_ingredient_edit") {
    const values = p.values;
    assertKeys(values, [], ["name", "amount", "unit", "category", "phase_id", "is_starter"]);
    validateValues(values);
    if (values.phase_id != null) {
      const ph = await one(db, "select id from recipe_phases where id = ?", [values.phase_id]);
      if (!ph) refuse("STOCK_NOT_FOUND");
    }
    const original = line;
    const next = { ...line, ...values };
    const keepDeducted = original.deducted && !next.is_starter && next.name.trim().toLowerCase() === original.name.trim().toLowerCase();
    let movement = null;
    let origin = null;
    if (original.deducted && !original.stock_movement_id) {
      movement = await waiveLegacyLine(db, ctx, original, legacy, "batch_debit");
    } else if (original.deducted) {
      await restoreLine(db, ctx, original);
      origin = await getMovement(db, original.stock_movement_id);
    }
    await db.run(
      "update batch_ingredients set name = ?, amount = ?, unit = ?, category = ?, phase_id = ?, is_starter = ?, deducted = ?, deducted_at = ?, stock_movement_id = ? where id = ?",
      [next.name, next.amount, next.unit, next.category, next.phase_id ?? null, next.is_starter ? 1 : 0, movement ? 1 : 0, movement ? original.deducted_at : null, movement, line.id],
    );
    line = await getLine(db, line.id, b.id);
    if (keepDeducted && !movement) {
      // Pas de nouvel appariement à l'édition : un non-mouvement explicite le reste.
      const why = ["no_stock", "incompatible_unit", "starter", "no_amount", "legacy_waived"].includes(origin?.reason) ? origin.reason : null;
      const candidate = why == null ? origin?.stock_id ?? null : null;
      movement = await consumeLine(db, ctx, line, candidate, true, why);
      await db.run("update batch_ingredients set deducted = 1, deducted_at = ?, stock_movement_id = ? where id = ?", [original.deducted_at, movement, line.id]);
      line = await getLine(db, line.id, b.id);
    }
    await touchLine(db, line.id, b.id);
    line = await getLine(db, line.id, b.id);
  } else {
    await releaseLine(db, ctx, line, legacy);
    await db.run("delete from batch_ingredients where id = ?", [line.id]);
    await touchBatch(db, b.id);
    result.removed_id = line.id;
  }
  if (kind !== "batch_ingredient_remove") result.line = line;
  result.batch = await getBatch(db, b.id);
  return result;
}

// Phases de la recette du brassin, dans l'ordre affiché (sort_order puis ordre
// du payload pour les égalités), après vérification de l'instantané.
async function orderedPhases(db, b, expectedPhases) {
  if (b.recipe_id != null && !(await one(db, "select id from recipes where id = ?", [b.recipe_id]))) refuse("STOCK_NOT_FOUND");
  const phases = b.recipe_id ? await db.query("select id, sort_order from recipe_phases where recipe_id = ?", [b.recipe_id]) : [];
  if (!Array.isArray(expectedPhases)) refuse("STOCK_INVALID_PAYLOAD");
  const exp = expectedPhases.map((e) => {
    if (!isPlainObject(e) || typeof e.id !== "string" || !Number.isInteger(e.sort_order)) refuse("STOCK_INVALID_PAYLOAD");
    return `${e.id}:${e.sort_order}`;
  }).sort();
  const act = phases.map((ph) => `${ph.id}:${Number(ph.sort_order)}`).sort();
  if (exp.length !== act.length || exp.some((v, i) => v !== act[i])) refuse("STOCK_STALE");
  const ordinal = new Map(expectedPhases.map((e, i) => [e.id, i]));
  return phases.slice().sort((x, y) => Number(x.sort_order) - Number(y.sort_order) || ordinal.get(x.id) - ordinal.get(y.id)).map((ph) => ph.id);
}

async function opBatchWhole(db, ctx, kind, p) {
  const legacy = p.legacyNoRestock === true;
  const extra = {
    batch_previous_phase: ["expectedStage", "expectedPhases", "targetPhase"],
    batch_split: ["expectedPhases", "lots", "splitAt"],
    batch_resize: ["expectedPhases", "volume", "rescale", "expectedBaseVolume"],
    batch_remove: [],
  }[kind];
  assertKeys(p, ["batchId", "expectedRevision", "expectedLines", ...extra], ["batch_previous_phase", "batch_remove"].includes(kind) ? ["legacyNoRestock"] : []);
  let b = await getBatch(db, p.batchId);
  if (!b) refuse("STOCK_NOT_FOUND");
  assertRevision(p.expectedRevision, b.stock_revision);
  const lines = await batchLines(db, b.id);
  assertSnapshot(p.expectedLines, lines);
  let phaseIds = [];
  if (kind !== "batch_remove") {
    phaseIds = await orderedPhases(db, b, p.expectedPhases);
    if (kind === "batch_previous_phase") {
      const dup = await one(db, "select sort_order from recipe_phases where recipe_id = ? group by sort_order having count(*) > 1", [b.recipe_id]);
      if (dup) refuse("STOCK_INVALID_TRANSITION");
    }
  }
  const result = {};

  if (kind === "batch_split") {
    if (!Array.isArray(p.lots) || typeof p.splitAt !== "string") refuse("STOCK_INVALID_PAYLOAD");
    if (p.lots.length < 1 || p.lots.length > 100 || !/(Z|[+-]\d{2}:\d{2})$/.test(p.splitAt)) refuse("STOCK_INVALID_PAYLOAD");
    const splitDate = new Date(p.splitAt);
    if (!Number.isFinite(splitDate.getTime()) || b.volume == null || !(Number(b.volume) > 0) || !Number.isFinite(Number(b.volume))) refuse("STOCK_INVALID_PAYLOAD");
    const splitAt = splitDate.toISOString();
    let remaining = Number(b.volume);
    for (const lot of p.lots) {
      assertKeys(lot, ["name", "volume"]);
      if (typeof lot.name !== "string" || lot.name.trim() === "" || typeof lot.volume !== "number" || !Number.isFinite(lot.volume) || lot.volume <= 0) refuse("STOCK_INVALID_PAYLOAD");
      remaining -= lot.volume;
    }
    remaining = round2(remaining);
    if (remaining <= 0) refuse("STOCK_INVALID_PAYLOAD");
    const phaseIndex = b.status === "en_cours" ? phaseIds.indexOf(b.current_phase_id) : -1;
    const childIds = [];
    for (const lot of p.lots) {
      const ratio = lot.volume / Number(b.volume);
      const childId = newId();
      await db.run(
        `insert into batches (id, recipe_id, parent_batch_id, title, volume, status, current_phase_id, phase_started_at, starter_batch_id, starter_volume, culture_generation, has_been_split, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [childId, b.recipe_id, b.id, lot.name.trim(), lot.volume, b.status, b.current_phase_id, splitAt, b.starter_batch_id,
          b.starter_volume ? round2(Number(b.starter_volume) * ratio) : null, b.culture_generation, ctx.now],
      );
      childIds.push(childId);
      await db.run("insert into batch_phase_log (id, batch_id, stage, phase_id, entered_at) values (?, ?, ?, ?, ?)", [newId(), childId, b.status, b.current_phase_id, splitAt]);
      if (phaseIndex >= 0) {
        for (const l of lines) {
          if (l.deducted || l.phase_id == null) continue;
          if (phaseIds.indexOf(l.phase_id) < phaseIndex) continue;
          await db.run(
            "insert into batch_ingredients (id, batch_id, phase_id, category, name, amount, unit, is_starter) values (?, ?, ?, ?, ?, ?, ?, ?)",
            [newId(), childId, l.phase_id, l.category, l.name, round2(Number(l.amount) * ratio), l.unit, l.is_starter ? 1 : 0],
          );
        }
      }
    }
    const ratio = remaining / Number(b.volume);
    for (const l of lines) {
      if (l.deducted) continue;
      await db.run("update batch_ingredients set amount = ?, stock_revision = stock_revision + 1 where id = ?", [round2(Number(l.amount) * ratio), l.id]);
    }
    await db.run("update batches set volume = ?, starter_volume = ?, has_been_split = 1, stock_revision = stock_revision + 1 where id = ?", [
      remaining, b.starter_volume ? round2(Number(b.starter_volume) * ratio) : b.starter_volume, b.id,
    ]);
    result.batch = await getBatch(db, b.id);
    result.lots = [];
    for (const id of childIds) result.lots.push(await getBatch(db, id));
  } else if (kind === "batch_resize") {
    if (typeof p.rescale !== "boolean" || !(p.volume === null || typeof p.volume === "number")) refuse("STOCK_INVALID_PAYLOAD");
    const target = p.volume;
    if (target != null && (!Number.isFinite(target) || target < 0)) refuse("STOCK_INVALID_PAYLOAD");
    const recipe = b.recipe_id ? await one(db, "select batch_size_ref from recipes where id = ?", [b.recipe_id]) : null;
    const base = Number(b.volume) || Number(recipe?.batch_size_ref) || null;
    if ((p.expectedBaseVolume ?? null) !== base) refuse("STOCK_STALE");
    if (p.rescale && base && target) {
      const ratio = target / base;
      if (ratio > 0 && ratio !== 1) {
        const starter = Number(b.starter_volume) || 0;
        let waterId = null;
        if (starter > 0) {
          // Plus grosse eau de dilution non prélevée ; égalités : ordre affiché.
          const ordinal = new Map(p.expectedLines.map((e, i) => [e.id, i]));
          let best = -1;
          for (const l of lines.slice().sort((x, y) => ordinal.get(x.id) - ordinal.get(y.id))) {
            if (l.deducted || !isDilutionWater(l.name, l.unit)) continue;
            const litres = convertAmount(l.amount, l.unit, "l");
            if (litres != null && litres > best) {
              best = litres;
              waterId = l.id;
            }
          }
        }
        for (const l of lines) {
          if (l.deducted) continue;
          if (starter > 0 && l.is_starter) {
            const litres = convertAmount(l.amount, l.unit, "l");
            if (litres != null && Number(Math.abs(litres - starter).toFixed(12)) < 0.005) continue;
          }
          let next;
          if (l.id === waterId) {
            const cut = convertAmount(starter, "l", l.unit);
            next = Math.max(0, round2((Number(l.amount) + cut) * ratio - cut));
          } else next = round2(Number(l.amount) * ratio);
          if (next !== Number(l.amount)) await db.run("update batch_ingredients set amount = ?, stock_revision = stock_revision + 1 where id = ?", [next, l.id]);
        }
      }
    }
    await db.run("update batches set volume = ?, stock_revision = stock_revision + 1 where id = ?", [target, b.id]);
    result.batch = await getBatch(db, b.id);
  } else if (kind === "batch_previous_phase") {
    assertKeys(p.expectedStage, ["status", "current_phase_id"]);
    assertKeys(p.targetPhase, ["status", "current_phase_id"]);
    if (p.expectedStage.status !== b.status || (p.expectedStage.current_phase_id ?? null) !== (b.current_phase_id ?? null)) refuse("STOCK_STALE");
    let nextPhase;
    if (b.status === "degustation") nextPhase = phaseIds.at(-1) ?? null;
    else if (b.status === "en_cours") {
      const idx = phaseIds.indexOf(b.current_phase_id);
      nextPhase = idx > 0 ? phaseIds[idx - 1] : null;
    } else refuse("STOCK_INVALID_TRANSITION");
    const nextStatus = nextPhase ? "en_cours" : "planifie";
    if (p.targetPhase.status !== nextStatus || (p.targetPhase.current_phase_id ?? null) !== (nextPhase ?? null)) refuse("STOCK_STALE");
    if (b.status === "en_cours") {
      for (const l of lines) {
        if (!l.deducted || (l.phase_id ?? null) !== (b.current_phase_id ?? null)) continue;
        await releaseLine(db, ctx, l, legacy);
        await db.run("update batch_ingredients set deducted = 0, deducted_at = null, stock_movement_id = null, stock_revision = stock_revision + 1 where id = ?", [l.id]);
      }
    }
    await db.run("update batches set status = ?, current_phase_id = ?, phase_started_at = ?, stock_revision = stock_revision + 1 where id = ?", [
      nextStatus, nextPhase, nextStatus === "en_cours" ? ctx.now : b.phase_started_at, b.id,
    ]);
    await db.run("insert into batch_phase_log (id, batch_id, stage, phase_id, entered_at) values (?, ?, ?, ?, ?)", [newId(), b.id, nextStatus, nextPhase, ctx.now]);
    result.batch = await getBatch(db, b.id);
  } else {
    for (const l of lines) if (l.deducted) await releaseLine(db, ctx, l, legacy);
    await db.run("delete from batches where id = ?", [b.id]);
    result.removed_id = b.id;
  }
  return result;
}

async function opShoppingSet(db, ctx, p) {
  if (typeof p.checked !== "boolean") refuse("STOCK_INVALID_PAYLOAD");
  const checked = p.checked;
  assertKeys(p, ["shoppingId", "expectedRevision", "checked", ...(checked ? ["stockId", "expectedStock"] : [])]);
  let shopping = await getShopping(db, p.shoppingId);
  if (!shopping) refuse("STOCK_NOT_FOUND");
  assertRevision(p.expectedRevision, shopping.stock_revision);
  let stock = null;
  if (checked) {
    assertSnapshot(p.expectedStock, await allStock(db));
    if (p.stockId != null) {
      stock = await getStock(db, p.stockId);
      if (!stock) refuse("STOCK_NOT_FOUND");
    }
  }
  const result = {};
  if (shopping.checked !== checked) {
    let delta = 0;
    let why = "unchecked";
    let before = null;
    if (checked) {
      if (shopping.amount != null && !finiteNonNegative(Number(shopping.amount))) refuse("STOCK_INVALID_PAYLOAD");
      if (!stock) {
        const id = newId();
        await db.run("insert into ingredients (id, name, quantity, unit, category, created_at, updated_at) values (?, ?, 0, ?, ?, ?, ?)", [id, shopping.name, shopping.unit || "g", shopping.category, ctx.now, ctx.now]);
        stock = await getStock(db, id);
        delta = Number(shopping.amount ?? 0);
        why = shopping.amount == null ? "no_amount" : delta === 0 ? "zero_amount" : null;
      } else if (shopping.amount == null) why = "no_amount";
      else {
        delta = convertAmount(shopping.amount, shopping.unit, stock.unit);
        why = delta == null ? "incompatible_unit" : delta === 0 ? "zero_amount" : null;
        delta = delta ?? 0;
      }
      before = Number(stock.quantity);
      if (delta !== 0) {
        await adjustStockQuantity(db, stock, delta);
        stock = await getStock(db, stock.id);
      }
      result.stock = stock;
    }
    await insertMovement(db, ctx, {
      action: "shopping", shopping_id: shopping.id, stock_id: stock?.id ?? null, amount: Math.abs(delta), delta,
      unit: stock?.unit ?? null, reason: why, quantity_before: before, quantity_after: stock ? Number(stock.quantity) : null,
    });
    await db.run("update shopping_list set checked = ?, checked_at = ?, stock_revision = stock_revision + 1 where id = ?", [checked ? 1 : 0, checked ? ctx.now : null, shopping.id]);
  } else {
    await insertMovement(db, ctx, { action: "shopping", shopping_id: shopping.id, reason: "unchanged" });
  }
  result.shopping = await getShopping(db, shopping.id);
  return result;
}

const STOCK_FIELDS = ["name", "quantity", "unit", "category", "expiry_date", "supplier", "low_stock_threshold"];

async function opStock(db, ctx, kind, p) {
  const result = {};
  if (kind === "stock_create") {
    assertKeys(p, ["rows"]);
    if (!Array.isArray(p.rows) || p.rows.length < 1 || p.rows.length > 500) refuse("STOCK_INVALID_PAYLOAD");
    result.stocks = [];
    for (const entry of p.rows) {
      assertKeys(entry, ["name"], STOCK_FIELDS.filter((f) => f !== "name"));
      validateValues(entry);
      const s = { quantity: 0, unit: "g", category: "autre", expiry_date: null, supplier: null, low_stock_threshold: null, ...entry };
      const id = newId();
      await db.run(
        "insert into ingredients (id, name, quantity, unit, category, expiry_date, supplier, low_stock_threshold, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, s.name, s.quantity, s.unit, s.category, s.expiry_date, s.supplier, s.low_stock_threshold, ctx.now, ctx.now],
      );
      const created = await getStock(db, id);
      await insertMovement(db, ctx, { action: "stock_create", stock_id: id, amount: Math.abs(Number(s.quantity)), delta: Number(s.quantity), unit: s.unit, quantity_before: 0, quantity_after: Number(s.quantity) });
      result.stocks.push(created);
    }
    return result;
  }
  assertKeys(p, ["stockId", "expectedRevision", ...(kind === "stock_update" ? ["values"] : [])]);
  const prior = await getStock(db, p.stockId);
  if (!prior) refuse("STOCK_NOT_FOUND");
  assertRevision(p.expectedRevision, prior.stock_revision);
  if (kind === "stock_update") {
    assertKeys(p.values, [], STOCK_FIELDS);
    validateValues(p.values);
    const s = { ...prior, ...p.values };
    let converted = convertAmount(prior.quantity, prior.unit, s.unit);
    if (!Object.hasOwn(p.values, "quantity") && s.unit !== prior.unit) {
      if (converted == null) refuse("STOCK_UNIT_INCOMPATIBLE");
      s.quantity = converted;
    }
    await db.run(
      "update ingredients set name = ?, quantity = ?, unit = ?, category = ?, expiry_date = ?, supplier = ?, low_stock_threshold = ? where id = ?",
      [s.name, s.quantity, s.unit, s.category, s.expiry_date ?? null, s.supplier ?? null, s.low_stock_threshold ?? null, s.id],
    );
    await touchStock(db, s.id);
    const after = await getStock(db, s.id);
    const delta = converted == null ? 0 : Number(after.quantity) - converted;
    await insertMovement(db, ctx, {
      action: "stock_correction", stock_id: s.id, amount: Math.abs(delta), delta, unit: after.unit,
      reason: converted == null ? "unit_reset" : null, quantity_before: Number(prior.quantity), quantity_after: Number(after.quantity), unit_before: prior.unit,
    });
    result.stock = after;
  } else {
    await db.run("delete from ingredients where id = ?", [prior.id]);
    await insertMovement(db, ctx, { action: "stock_remove", stock_id: prior.id, amount: Math.abs(Number(prior.quantity)), delta: -Number(prior.quantity), unit: prior.unit, quantity_before: Number(prior.quantity), quantity_after: 0 });
    result.removed_id = prior.id;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

async function movementsOf(db, requestId) {
  return (await db.query("select * from stock_movements where request_id = ? order by rowid", [requestId])).map(rowToMovement);
}

/**
 * Exécute une opération de stock. Renvoie le résultat `{ ok, request_id, kind,
 * … , movements }` ; un refus métier renvoie `{ ok: false, code }` (mémorisé),
 * une collision de clé lève StockOperationError("STOCK_REQUEST_COLLISION").
 */
export async function stockOperation(db, { requestId = newId(), kind, payload }, { now } = {}) {
  if (typeof requestId !== "string" || !requestId || typeof kind !== "string" || !isPlainObject(payload)) {
    throw new StockOperationError("STOCK_INVALID_PAYLOAD");
  }
  const payloadJson = canonicalJson(payload);
  const cached = await one(db, "select * from stock_operation_requests where request_id = ?", [requestId]);
  if (cached) {
    if (cached.kind !== kind || cached.payload !== payloadJson) throw new StockOperationError("STOCK_REQUEST_COLLISION");
    return JSON.parse(cached.result);
  }
  const ctx = { requestId, now: nowIso(now) };
  let result;
  try {
    result = await db.transaction(async () => {
      if (Object.hasOwn(payload, "legacyNoRestock") && typeof payload.legacyNoRestock !== "boolean") refuse("STOCK_INVALID_PAYLOAD");
      let out;
      if (["batch_ingredient_set", "batch_ingredient_edit", "batch_ingredient_remove"].includes(kind)) out = await opBatchIngredient(db, ctx, kind, payload);
      else if (["batch_previous_phase", "batch_remove", "batch_split", "batch_resize"].includes(kind)) out = await opBatchWhole(db, ctx, kind, payload);
      else if (kind === "shopping_set") out = await opShoppingSet(db, ctx, payload);
      else if (["stock_create", "stock_update", "stock_remove"].includes(kind)) out = await opStock(db, ctx, kind, payload);
      else refuse("STOCK_INVALID_PAYLOAD");
      const full = { ok: true, request_id: requestId, kind, ...out, movements: await movementsOf(db, requestId) };
      await db.run("insert into stock_operation_requests (request_id, kind, payload, result, created_at) values (?, ?, ?, ?, ?)", [requestId, kind, payloadJson, JSON.stringify(full), ctx.now]);
      return full;
    });
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    // Refus métier : la transaction a tout annulé ; on garde le reçu du refus
    // pour qu'un rejeu de la même demande rende la même réponse.
    result = { ok: false, request_id: requestId, kind, code: err.code };
    await db.transaction(() =>
      db.run("insert into stock_operation_requests (request_id, kind, payload, result, created_at) values (?, ?, ?, ?, ?)", [requestId, kind, payloadJson, JSON.stringify(result), ctx.now]),
    );
  }
  return result;
}

// Variante qui lève sur refus (pratique côté écran : un seul chemin d'erreur).
export async function runStockOperation(db, request, options) {
  const result = await stockOperation(db, request, options);
  if (!result.ok) throw new StockOperationError(result.code, result);
  return result;
}

// Instantané [{ id, stock_revision }] d'une liste de lignes (contrat).
export function stockSnapshot(rows) {
  return (rows || []).map(({ id, stock_revision }) => ({ id, stock_revision: Number(stock_revision) }));
}

// Un message par code (clés stock.appErr.<CODE> dans lib/i18n) ; code inconnu → « Opération refusée ».
const KNOWN_CODES = new Set([
  "STOCK_INVALID_PAYLOAD",
  "STOCK_NOT_FOUND",
  "STOCK_STALE",
  "STOCK_REQUEST_COLLISION",
  "STOCK_LEGACY_TRACE_REQUIRED",
  "STOCK_TRACE_INVALID",
  "STOCK_RESTORE_TARGET_MISSING",
  "STOCK_UNIT_INCOMPATIBLE",
  "STOCK_INVALID_TRANSITION",
]);

export function stockOperationMessage(errorOrCode, lang = "fr") {
  const code = typeof errorOrCode === "string" ? errorOrCode : errorOrCode?.code;
  if (KNOWN_CODES.has(code)) return t(`stock.appErr.${code}`, null, lang);
  return t("stock.appErr.refused", { code: code || t("stock.appErr.unknownCode", null, lang) }, lang);
}
