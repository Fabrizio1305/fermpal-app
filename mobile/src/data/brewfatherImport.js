// Écriture d'un plan d'import Brewfather (lib/brewfather.js) dans le carnet,
// en UNE transaction : tout ou rien. Un élément déjà importé (même
// external_id) est ignoré : réimporter le même fichier n'ajoute rien.
//
// Les brassins arrivent archivés, sans prélèvement de stock ni rappel de phase.

import { newId, nowIso } from "./rows.js";

// Instructions par aller-retour vers le moteur (pont natif coûteux par appel).
const CHUNK = 400;

async function existingIds(db, table) {
  const rows = await db.query(`select id, external_id from ${table} where external_id is not null`);
  return new Map(rows.map((r) => [r.external_id, r.id]));
}

// Ce que l'import ajouterait, sans rien écrire.
export async function previewBrewfatherImport(db, plan) {
  const recipes = await existingIds(db, "recipes");
  const batches = await existingIds(db, "batches");
  const freshRecipes = plan.recipes.filter((r) => !recipes.has(r.external_id));
  const freshBatches = plan.batches.filter((b) => !batches.has(b.external_id));
  return {
    recipes: freshRecipes.filter((r) => !r.archived).length,
    archives: freshRecipes.filter((r) => r.archived).length,
    batches: freshBatches.length,
    alreadyPresent: plan.recipes.length - freshRecipes.length + plan.batches.length - freshBatches.length,
    planning: plan.skipped.planning,
  };
}

export async function importBrewfatherPlan(db, plan, { now } = {}) {
  const ts = nowIso(now);
  return db.transaction(async () => {
    const recipeIds = await existingIds(db, "recipes");
    const batchIds = await existingIds(db, "batches");
    const phaseIds = new Map(); // external_id de la recette → { clé de phase → id }
    const items = [];
    const add = (sql, params) => items.push({ sql, params });
    const counts = { recipes: 0, archives: 0, batches: 0 };

    for (const r of plan.recipes) {
      if (recipeIds.has(r.external_id)) continue;
      const id = newId();
      recipeIds.set(r.external_id, id);
      const rec = r.recipe;
      add(
        `insert into recipes (id, title, type, source_type, instructions, batch_size_ref, style, boil_time,
           expected_og, expected_fg, expected_abv, expected_ibu, expected_ebc, current_version, tags, created_at, updated_at,
           external_id, archived, archive_of)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [id, rec.title, rec.type, rec.source_type, rec.instructions, rec.batch_size_ref, rec.style, rec.boil_time,
          rec.expected_og, rec.expected_fg, rec.expected_abv, rec.expected_ibu, rec.expected_ebc, JSON.stringify(rec.tags || []),
          rec.created_at || ts, ts, r.external_id, r.archived ? 1 : 0, recipeIds.get(r.archive_of_external_id) ?? null],
      );
      const keys = {};
      r.phases.forEach((p, i) => {
        keys[p.key] = newId();
        add("insert into recipe_phases (id, recipe_id, name, sort_order, duration_value, duration_unit, temperature_target, notes) values (?, ?, ?, ?, ?, ?, ?, ?)", [
          keys[p.key], id, p.name, i, p.duration_value, p.duration_unit, p.temperature_target, p.notes || null,
        ]);
      });
      phaseIds.set(r.external_id, keys);
      r.ingredients.forEach((l, i) => {
        add(
          `insert into recipe_ingredients (id, recipe_id, phase_id, category, name, amount, unit, sub_type, alpha_acid_pct, timing, notes, sort_order, is_starter)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [newId(), id, keys[l.phaseKey] ?? null, l.category, l.name, l.amount, l.unit, l.category === "houblon" ? null : l.sub_type ?? null,
            l.alpha_acid_pct ?? null, l.timing ?? null, l.notes ?? null, i],
        );
      });
      counts[r.archived ? "archives" : "recipes"]++;
    }

    for (const b of plan.batches) {
      if (batchIds.has(b.external_id)) continue;
      const recipeId = recipeIds.get(b.recipe_external_id);
      if (!recipeId) continue;
      let keys = phaseIds.get(b.recipe_external_id);
      if (!keys) {
        // Recette arrivée lors d'un import précédent : ses phases, dans l'ordre du plan.
        const rows = await db.query("select id from recipe_phases where recipe_id = ? order by sort_order, id", [recipeId]);
        const planned = plan.recipes.find((r) => r.external_id === b.recipe_external_id);
        keys = Object.fromEntries((planned?.phases || []).map((p, i) => [p.key, rows[i]?.id ?? null]));
        phaseIds.set(b.recipe_external_id, keys);
      }
      const id = newId();
      add(
        `insert into batches (id, recipe_id, title, status, volume, rating, notes, created_at, completed_at, external_id)
         values (?, ?, ?, 'archive', ?, ?, ?, ?, ?, ?)`,
        [id, recipeId, b.title, b.volume, b.rating, b.notes, b.created_at || ts, b.completed_at || ts, b.external_id],
      );
      for (const l of b.log) {
        add("insert into batch_phase_log (id, batch_id, stage, phase_id, entered_at) values (?, ?, ?, ?, ?)", [newId(), id, l.stage, l.phaseKey ? keys[l.phaseKey] ?? null : null, l.entered_at || ts]);
      }
      for (const j of b.journal) {
        add("insert into batch_journal (id, batch_id, phase_id, timestamp, content, category) values (?, ?, null, ?, ?, 'observation')", [newId(), id, j.timestamp || ts, j.content]);
      }
      for (const l of b.lines) {
        add("insert into batch_ingredients (id, batch_id, phase_id, category, name, amount, unit) values (?, ?, ?, ?, ?, ?, ?)", [newId(), id, keys[l.phaseKey] ?? null, l.category, l.name, l.amount, l.unit]);
      }
      counts.batches++;
    }

    for (let i = 0; i < items.length; i += CHUNK) await db.runBatch(items.slice(i, i + CHUNK));
    return counts;
  });
}
