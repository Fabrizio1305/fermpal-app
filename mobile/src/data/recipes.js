// Couche données « recettes » du carnet local. Pure : reçoit un pilote
// (driver.js ou nodeDriver.js), aucune dépendance plateforme.
//
// Chaque geste complexe est UNE transaction (cadrage §4, contrat W06) : la
// recette, ses phases, ses lignes et l'instantané de version sont tous écrits
// ou aucun. Les phases conservées gardent leur identifiant (contrat W07 : un
// brassin qui pointera sur une phase ne sera pas détaché par une correction de
// titre) — même réconciliation que l'éditeur web, ici sous transaction.

export function newId() {
  return globalThis.crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

function parseTags(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowToRecipe(r) {
  return { ...r, tags: parseTags(r.tags), is_ai_generated: !!r.is_ai_generated };
}

function rowToIngredient(r) {
  return { ...r, is_starter: !!r.is_starter };
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function listRecipes(db) {
  const rows = await db.query("select * from recipes order by created_at desc, title asc");
  return rows.map(rowToRecipe);
}

export async function countRecipes(db) {
  const rows = await db.query("select count(*) as c from recipes");
  return Number(rows[0].c);
}

export async function getRecipeFull(db, id) {
  const [recipe] = await db.query("select * from recipes where id = ?", [id]);
  if (!recipe) return null;
  const phases = await db.query("select * from recipe_phases where recipe_id = ? order by sort_order", [id]);
  const ingredients = (await db.query("select * from recipe_ingredients where recipe_id = ? order by sort_order", [id])).map(rowToIngredient);
  const versions = (await db.query("select * from recipe_versions where recipe_id = ? order by version desc", [id])).map((v) => ({
    ...v,
    snapshot: JSON.parse(v.snapshot),
  }));
  return { recipe: rowToRecipe(recipe), phases, ingredients, versions };
}

// Tags et styles déjà utilisés (suggestions de l'éditeur).
export async function listTagsAndStyles(db) {
  const rows = await db.query("select tags, style from recipes");
  const tags = [...new Set(rows.flatMap((r) => parseTags(r.tags)))].sort();
  const styles = [...new Set(rows.map((r) => r.style).filter(Boolean))].sort();
  return { tags, styles };
}

// Forme d'entrée de saveRecipe :
//   recipe      : { title, type, batch_size_ref, style, instructions, tags, source_type? }
//   phases      : [{ key, id?, name, duration_value, duration_unit, temperature_target, notes }]
//                 `key` = identifiant côté formulaire ; `id` présent = phase existante à conserver
//   ingredients : [{ phaseKey|null, category, name, amount, unit, sub_type, alpha_acid_pct, timing, is_starter }]
// Retourne { id, version }.
export async function saveRecipe(db, { id = null, recipe, phases = [], ingredients = [] }) {
  const title = (recipe.title || "").trim();
  if (!title) throw new Error("title_required");
  const ts = nowIso();
  const recipeRow = {
    title,
    type: recipe.type || "hybride",
    batch_size_ref: numOrNull(recipe.batch_size_ref),
    style: (recipe.style || "").trim() || null,
    instructions: (recipe.instructions || "").trim() || null,
    tags: JSON.stringify(Array.isArray(recipe.tags) ? recipe.tags : []),
  };

  return db.transaction(async () => {
    let recipeId = id;
    let version = 1;
    const keyToId = {};

    if (!recipeId) {
      recipeId = newId();
      await db.run(
        `insert into recipes (id, title, type, source_type, is_ai_generated, instructions, batch_size_ref, style, boil_time, current_version, tags, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [recipeId, recipeRow.title, recipeRow.type, recipe.source_type || "manual", recipe.is_ai_generated ? 1 : 0, recipeRow.instructions, recipeRow.batch_size_ref, recipeRow.style, numOrNull(recipe.boil_time), recipeRow.tags, ts, ts],
      );
    } else {
      const [prev] = await db.query("select * from recipes where id = ?", [recipeId]);
      if (!prev) throw new Error("recipe_not_found");
      const prevPhases = await db.query("select * from recipe_phases where recipe_id = ? order by sort_order", [recipeId]);
      const prevIngredients = await db.query("select * from recipe_ingredients where recipe_id = ? order by sort_order", [recipeId]);
      const prevVersion = prev.current_version || 1;
      version = prevVersion + 1;
      await db.run("insert into recipe_versions (id, recipe_id, version, snapshot, created_at) values (?, ?, ?, ?, ?)", [
        newId(),
        recipeId,
        prevVersion,
        JSON.stringify({ recipe: rowToRecipe(prev), phases: prevPhases, ingredients: prevIngredients.map(rowToIngredient) }),
        ts,
      ]);
      await db.run(
        "update recipes set title = ?, type = ?, batch_size_ref = ?, style = ?, instructions = ?, tags = ?, current_version = ?, updated_at = ? where id = ?",
        [recipeRow.title, recipeRow.type, recipeRow.batch_size_ref, recipeRow.style, recipeRow.instructions, recipeRow.tags, version, ts, recipeId],
      );
      // Phases retirées dans l'éditeur : supprimées. Les lignes qui y pointaient
      // sont recréées ci-dessous sans phase (on delete set null couvre le reste).
      const keptIds = new Set(phases.filter((p) => p.id).map((p) => p.id));
      for (const p of prevPhases) {
        if (!keptIds.has(p.id)) await db.run("delete from recipe_phases where id = ?", [p.id]);
      }
      await db.run("delete from recipe_ingredients where recipe_id = ?", [recipeId]);
    }

    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const row = [
        (p.name || "").trim() || `Phase ${i + 1}`,
        i,
        numOrNull(p.duration_value),
        p.duration_unit || null,
        numOrNull(p.temperature_target),
        (p.notes || "").trim() || null,
      ];
      if (p.id) {
        const r = await db.run(
          "update recipe_phases set name = ?, sort_order = ?, duration_value = ?, duration_unit = ?, temperature_target = ?, notes = ? where id = ? and recipe_id = ?",
          [...row, p.id, recipeId],
        );
        if (r.changes !== 1) throw new Error("phase_not_found");
        keyToId[p.key] = p.id;
      } else {
        const pid = newId();
        await db.run("insert into recipe_phases (id, recipe_id, name, sort_order, duration_value, duration_unit, temperature_target, notes) values (?, ?, ?, ?, ?, ?, ?, ?)", [pid, recipeId, ...row]);
        keyToId[p.key] = pid;
      }
    }

    const valid = ingredients.filter((l) => (l.name || "").trim());
    for (let i = 0; i < valid.length; i++) {
      const l = valid[i];
      await db.run(
        `insert into recipe_ingredients (id, recipe_id, phase_id, category, name, amount, unit, sub_type, alpha_acid_pct, timing, notes, sort_order, is_starter)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          recipeId,
          l.phaseKey ? keyToId[l.phaseKey] || null : null,
          l.category || "autre",
          l.name.trim(),
          Number(l.amount) || 0,
          l.unit || "g",
          l.category === "houblon" ? null : (l.sub_type || "").trim() || null,
          numOrNull(l.alpha_acid_pct),
          (l.timing || "").trim() || null,
          (l.notes || "").trim() || null,
          i,
          l.is_starter ? 1 : 0,
        ],
      );
    }
    return { id: recipeId, version };
  });
}

export async function deleteRecipe(db, id) {
  return db.transaction(async () => {
    const r = await db.run("delete from recipes where id = ?", [id]);
    return r.changes === 1;
  });
}

// Copie complète (phases + lignes rattachées) sous un nouveau titre.
export async function duplicateRecipe(db, id, { suffix = "(copie)" } = {}) {
  const full = await getRecipeFull(db, id);
  if (!full) throw new Error("recipe_not_found");
  const keyed = full.phases.map((p) => ({ key: p.id, ...p, id: undefined }));
  return saveRecipe(db, {
    recipe: { ...full.recipe, title: `${full.recipe.title} ${suffix}`, source_type: full.recipe.source_type },
    phases: keyed,
    ingredients: full.ingredients.map((l) => ({ ...l, phaseKey: l.phase_id })),
  });
}
