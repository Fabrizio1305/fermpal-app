import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeDriver } from "../mobile/src/db/nodeDriver.js";
import { runMigrations } from "../mobile/src/db/migrations.js";
import { saveRecipe, getRecipeFull, listRecipes, deleteRecipe, duplicateRecipe, listTagsAndStyles, countRecipes } from "../mobile/src/data/recipes.js";
import { seedSyntheticRecipes, deleteSyntheticRecipes, generateSyntheticRecipes } from "../mobile/src/data/seed.js";

async function freshDb() {
  const db = createNodeDriver();
  await runMigrations(db);
  return db;
}

const KOMBUCHA = {
  recipe: { title: "  Kombucha gingembre ", type: "kombucha", batch_size_ref: "3", style: "Nature", instructions: "Infuser.", tags: ["été", "favori"] },
  phases: [
    { key: "a", name: "Préparation du thé", duration_value: "20", duration_unit: "minutes", temperature_target: "95" },
    { key: "b", name: "F1", duration_value: 7, duration_unit: "jours", temperature_target: 22, notes: "Couvrir." },
    { key: "c", name: "F2", duration_value: 3, duration_unit: "jours" },
  ],
  ingredients: [
    { phaseKey: "a", category: "thé", name: "Thé noir", amount: "12", unit: "g" },
    { phaseKey: "a", category: "sucre", name: "Sucre blanc", amount: 200, unit: "g" },
    { phaseKey: "c", category: "fruit", name: "Gingembre frais", amount: 30, unit: "g", sub_type: "râpé" },
    { phaseKey: "b", category: "levure", name: "SCOBY kombucha", amount: 1, unit: "pièce", is_starter: true },
    { phaseKey: null, category: "autre", name: "   ", amount: 0 }, // ligne vide ignorée
  ],
};

test("création : recette, phases ordonnées et lignes rattachées à leurs phases", async () => {
  const db = await freshDb();
  const { id, version } = await saveRecipe(db, KOMBUCHA);
  assert.equal(version, 1);
  const full = await getRecipeFull(db, id);
  assert.equal(full.recipe.title, "Kombucha gingembre");
  assert.equal(full.recipe.batch_size_ref, 3);
  assert.deepEqual(full.recipe.tags, ["été", "favori"]);
  assert.equal(full.recipe.current_version, 1);
  assert.deepEqual(full.phases.map((p) => [p.name, p.sort_order, p.duration_value]), [["Préparation du thé", 0, 20], ["F1", 1, 7], ["F2", 2, 3]]);
  assert.equal(full.ingredients.length, 4, "la ligne sans nom n'est pas enregistrée");
  const byName = Object.fromEntries(full.ingredients.map((l) => [l.name, l]));
  assert.equal(byName["Thé noir"].phase_id, full.phases[0].id);
  assert.equal(byName["Gingembre frais"].phase_id, full.phases[2].id);
  assert.equal(byName["Gingembre frais"].sub_type, "râpé");
  assert.equal(byName["SCOBY kombucha"].is_starter, true);
  assert.equal(full.versions.length, 0);
});

test("modification : instantané de version, phases conservées avec le même identifiant, phase retirée détachée", async () => {
  const db = await freshDb();
  const { id } = await saveRecipe(db, KOMBUCHA);
  const before = await getRecipeFull(db, id);
  const [thé, f1, f2] = before.phases;

  const { version } = await saveRecipe(db, {
    id,
    recipe: { ...before.recipe, title: "Kombucha gingembre v2", tags: ["favori"] },
    // F2 retirée, F1 renommée, une nouvelle phase ajoutée.
    phases: [
      { key: "k1", id: thé.id, name: thé.name, duration_value: 15, duration_unit: "minutes", temperature_target: 90 },
      { key: "k2", id: f1.id, name: "F1 longue", duration_value: 10, duration_unit: "jours", temperature_target: 22 },
      { key: "k3", name: "Garde", duration_value: 2, duration_unit: "jours" },
    ],
    ingredients: before.ingredients.map((l) => ({
      ...l,
      // le gingembre pointait sur F2 (retirée) → il perd sa phase
      phaseKey: l.phase_id === thé.id ? "k1" : l.phase_id === f1.id ? "k2" : null,
    })),
  });
  assert.equal(version, 2);
  const after = await getRecipeFull(db, id);
  assert.equal(after.recipe.title, "Kombucha gingembre v2");
  assert.equal(after.recipe.current_version, 2);
  assert.deepEqual(after.phases.map((p) => p.name), ["Préparation du thé", "F1 longue", "Garde"]);
  assert.equal(after.phases[0].id, thé.id, "phase conservée : identifiant préservé (W07)");
  assert.equal(after.phases[1].id, f1.id);
  assert.equal(after.phases[1].duration_value, 10);
  assert.ok(!after.phases.some((p) => p.id === f2.id), "F2 supprimée");
  const gingembre = after.ingredients.find((l) => l.name === "Gingembre frais");
  assert.equal(gingembre.phase_id, null);
  assert.equal(after.versions.length, 1);
  assert.equal(after.versions[0].version, 1);
  assert.equal(after.versions[0].snapshot.recipe.title, "Kombucha gingembre");
  assert.equal(after.versions[0].snapshot.phases.length, 3);
  assert.equal(after.versions[0].snapshot.ingredients.length, 4);
});

test("titre vide : refus, rien n'est écrit", async () => {
  const db = await freshDb();
  await assert.rejects(saveRecipe(db, { recipe: { title: "  " }, phases: [], ingredients: [] }), /title_required/);
  assert.equal(await countRecipes(db), 0);
});

test("panne au milieu de l'enregistrement : tout est annulé, y compris l'instantané et la mise à jour de la recette", async () => {
  const db = await freshDb();
  const { id } = await saveRecipe(db, KOMBUCHA);
  const before = await getRecipeFull(db, id);
  await assert.rejects(
    saveRecipe(db, {
      id,
      recipe: { ...before.recipe, title: "Ne doit pas apparaître" },
      // identifiant de phase inexistant → échec après la mise à jour de la recette
      phases: [{ key: "x", id: "phase-inexistante", name: "?" }],
      ingredients: [],
    }),
    /phase_not_found/,
  );
  const after = await getRecipeFull(db, id);
  assert.equal(after.recipe.title, "Kombucha gingembre");
  assert.equal(after.recipe.current_version, 1);
  assert.equal(after.versions.length, 0, "pas d'instantané orphelin");
  assert.equal(after.phases.length, 3);
  assert.equal(after.ingredients.length, 4, "les lignes n'ont pas été effacées");
});

test("suppression : phases, lignes et versions partent avec la recette", async () => {
  const db = await freshDb();
  const { id } = await saveRecipe(db, KOMBUCHA);
  const full = await getRecipeFull(db, id);
  await saveRecipe(db, { id, recipe: full.recipe, phases: full.phases.map((p) => ({ key: p.id, ...p })), ingredients: full.ingredients.map((l) => ({ ...l, phaseKey: l.phase_id })) });
  assert.equal(await deleteRecipe(db, id), true);
  assert.equal(await getRecipeFull(db, id), null);
  for (const t of ["recipe_phases", "recipe_ingredients", "recipe_versions"]) {
    assert.equal((await db.query(`select count(*) as c from ${t}`))[0].c, 0, t);
  }
  assert.equal(await deleteRecipe(db, id), false);
});

test("duplication : copie complète sous un nouvel identifiant, liens phase → ligne reconstruits", async () => {
  const db = await freshDb();
  const { id } = await saveRecipe(db, KOMBUCHA);
  const { id: copyId } = await duplicateRecipe(db, id);
  assert.notEqual(copyId, id);
  const orig = await getRecipeFull(db, id);
  const copy = await getRecipeFull(db, copyId);
  assert.equal(copy.recipe.title, "Kombucha gingembre (copie)");
  assert.deepEqual(copy.phases.map((p) => p.name), orig.phases.map((p) => p.name));
  assert.ok(copy.phases.every((p) => !orig.phases.some((o) => o.id === p.id)), "nouveaux identifiants de phase");
  const phaseName = (full, l) => full.phases.find((p) => p.id === l.phase_id)?.name ?? null;
  assert.deepEqual(copy.ingredients.map((l) => [l.name, phaseName(copy, l)]), orig.ingredients.map((l) => [l.name, phaseName(orig, l)]));
  assert.equal((await listRecipes(db)).length, 2);
});

test("suggestions : tags et styles distincts, triés", async () => {
  const db = await freshDb();
  await saveRecipe(db, KOMBUCHA);
  await saveRecipe(db, { recipe: { title: "Bière", type: "biere", style: "IPA", tags: ["favori", "houblonnée"] } });
  assert.deepEqual(await listTagsAndStyles(db), { tags: ["favori", "houblonnée", "été"], styles: ["IPA", "Nature"] });
});

test("300 recettes synthétiques : déterministes, insérées en une transaction, retirables d'un geste", async () => {
  const a = generateSyntheticRecipes(300);
  const b = generateSyntheticRecipes(300);
  assert.equal(a.length, 300);
  assert.deepEqual(a.map((r) => r.recipe.title), b.map((r) => r.recipe.title), "même graine → mêmes recettes");
  assert.ok(a.every((r) => r.phases.length >= 1 && r.ingredients.length >= 1));
  assert.equal(new Set(a.map((r) => r.recipe.type)).size, 13, "les 13 types de boisson sont représentés");

  const db = await freshDb();
  assert.equal(await seedSyntheticRecipes(db, { count: 300 }), 300);
  assert.equal(await countRecipes(db), 300);
  const phases = (await db.query("select count(*) as c from recipe_phases"))[0].c;
  const lines = (await db.query("select count(*) as c from recipe_ingredients"))[0].c;
  assert.ok(phases >= 300 && lines >= 300, `phases ${phases}, lignes ${lines}`);
  assert.equal((await db.query("pragma foreign_key_check")).length, 0);
  await saveRecipe(db, { recipe: { title: "Ma vraie recette", type: "hydromel" } });
  assert.equal(await deleteSyntheticRecipes(db), 300);
  assert.equal(await countRecipes(db), 1, "la recette réelle reste");
});
