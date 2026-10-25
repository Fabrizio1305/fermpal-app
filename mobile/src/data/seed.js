// Recettes synthétiques pour la preuve L1 : 300 recettes générées de façon
// déterministe (même graine → mêmes recettes), aux types, phases et ingrédients
// plausibles. Ce ne sont pas de vraies recettes : des données de démonstration.
// Marquées `source_type = 'synthetic'` pour être retirées d'un geste.

// Chemin relatif (pas l'alias `@/` de Vite) : ce module tourne aussi sous Node
// dans les tests unitaires.
import { RECIPE_TYPES } from "../../../lib/recipeTypes.js";
import { INGREDIENT_CATALOG, STYLE_CATALOG } from "./catalogs.js";
import { newId } from "./recipes.js";
import { typeLabel, phaseName } from "@/lib/recipeTypes";

// mulberry32 : générateur pseudo-aléatoire 32 bits, déterministe.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ["Maison", "Classique", "d'été", "d'hiver", "Express", "Douce", "Sauvage", "du dimanche", "Épicée", "Fruitée", "Légère", "Ambrée"];
const FRUITS = ["Citron", "Gingembre frais", "Framboises", "Fraises", "Mangue"];
const TAGS = ["favori", "essai", "sans-alcool", "cadeau", "rapide", "test-l1"];

const BY_TYPE = {
  kefir_eau: ["Sucre blanc", "Sucre roux", "Grains de kéfir d'eau", "Citron"],
  kefir_lait: ["Grains de kéfir d'eau", "Sucre blanc"],
  kombucha: ["Thé noir", "Thé vert", "Sucre blanc", "SCOBY kombucha"],
  jun: ["Thé vert", "Miel", "SCOBY kombucha"],
  ginger_beer: ["Gingembre frais", "Sucre de canne", "Citron"],
  soda_plante: ["Sucre blanc", "Gingembre frais", "Levure de boulanger"],
  kvas: ["Riz", "Sucre roux", "Levure de boulanger"],
  amazake: ["Riz"],
  biere: ["Orge maltée", "Blé malté", "Cascade", "Citra", "Saaz", "Levure de bière ale"],
  braggot: ["Orge maltée", "Miel", "Hallertau", "Levure de bière ale"],
  cidre: ["Sucre blanc", "Levure de bière ale"],
  hydromel: ["Miel", "Levure de bière ale", "Cannelle"],
  hybride: ["Sucre blanc", "Miel", "Vanille"],
};

const STARTERS = new Set(["Grains de kéfir d'eau", "SCOBY kombucha"]);

export function generateSyntheticRecipes(count = 300, seed = 20260911) {
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const types = Object.keys(RECIPE_TYPES);
  const catalogByName = new Map(INGREDIENT_CATALOG.map((c) => [c.name, c]));
  const recipes = [];
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const def = RECIPE_TYPES[type];
    const styles = STYLE_CATALOG.filter((s) => s.recipe_type === type);
    const style = styles.length && rand() < 0.7 ? pick(styles).name : null;
    const title = `${typeLabel(type, "fr")} ${pick(ADJ)} n°${i + 1}`;
    const phases = def.phaseTemplate.map((t, idx) => ({
      key: `p${idx}`,
      name: phaseName(t, "fr"),
      duration_value: t.durationValue,
      duration_unit: t.durationUnit,
      temperature_target: t.temperatureTarget,
      notes: idx === 0 ? `Étape ${idx + 1} générée pour la preuve locale.` : null,
    }));
    const names = [...new Set([...BY_TYPE[type], ...(rand() < 0.5 ? [pick(FRUITS)] : [])])];
    const ingredients = names.map((name, idx) => {
      const cat = catalogByName.get(name);
      const phaseKey = phases.length ? phases[Math.min(idx, phases.length - 1)].key : null;
      return {
        phaseKey,
        category: cat?.category || "autre",
        name,
        amount: Math.round((5 + rand() * 495) * 10) / 10,
        unit: cat?.default_unit || "g",
        sub_type: null,
        alpha_acid_pct: cat?.alpha_acid_min != null ? Math.round(((cat.alpha_acid_min + cat.alpha_acid_max) / 2) * 10) / 10 : null,
        timing: cat?.category === "houblon" ? pick(["ébullition 60 min", "ébullition 10 min", "dry-hop"]) : null,
        is_starter: STARTERS.has(name),
      };
    });
    const tags = [...new Set([TAGS[i % TAGS.length], ...(rand() < 0.3 ? [pick(TAGS)] : [])])];
    recipes.push({
      recipe: {
        title,
        type,
        source_type: "synthetic",
        batch_size_ref: pick([1, 2, 3, 5, 10, 20]),
        style,
        instructions: `Recette synthétique ${i + 1}/${count} (graine ${seed}). Sert à vérifier le carnet local : volume, export, restauration.`,
        tags,
        created_at: new Date(base + i * 3_600_000).toISOString(),
      },
      phases,
      ingredients,
    });
  }
  return recipes;
}

// Insère les recettes générées en UNE transaction (300 recettes ≈ 900 phases
// et 1 500 lignes). Retourne le nombre inséré.
export async function seedSyntheticRecipes(db, { count = 300, seed = 20260911 } = {}) {
  const items = generateSyntheticRecipes(count, seed);
  // Toutes les instructions sont préparées puis envoyées en un seul lot dans
  // une seule transaction (parents avant enfants : recettes, phases, lignes).
  const recipeRows = [];
  const phaseRows = [];
  const lineRows = [];
  for (const { recipe, phases, ingredients } of items) {
    const id = newId();
    const ts = recipe.created_at;
    recipeRows.push({
      sql: `insert into recipes (id, title, type, source_type, is_ai_generated, instructions, batch_size_ref, style, current_version, tags, created_at, updated_at)
            values (?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?)`,
      params: [id, recipe.title, recipe.type, recipe.source_type, recipe.instructions, recipe.batch_size_ref, recipe.style, JSON.stringify(recipe.tags), ts, ts],
    });
    const keyToId = {};
    phases.forEach((p, i) => {
      const pid = newId();
      keyToId[p.key] = pid;
      phaseRows.push({
        sql: "insert into recipe_phases (id, recipe_id, name, sort_order, duration_value, duration_unit, temperature_target, notes) values (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [pid, id, p.name, i, p.duration_value, p.duration_unit, p.temperature_target, p.notes],
      });
    });
    ingredients.forEach((l, i) => {
      lineRows.push({
        sql: `insert into recipe_ingredients (id, recipe_id, phase_id, category, name, amount, unit, sub_type, alpha_acid_pct, timing, notes, sort_order, is_starter)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [newId(), id, l.phaseKey ? keyToId[l.phaseKey] : null, l.category, l.name, l.amount, l.unit, l.sub_type, l.alpha_acid_pct, l.timing, null, i, l.is_starter ? 1 : 0],
      });
    });
  }
  await db.transaction(async () => {
    await db.runBatch([...recipeRows, ...phaseRows, ...lineRows]);
  });
  return items.length;
}

export async function deleteSyntheticRecipes(db) {
  return db.transaction(async () => {
    const r = await db.run("delete from recipes where source_type = 'synthetic'");
    return r.changes;
  });
}
