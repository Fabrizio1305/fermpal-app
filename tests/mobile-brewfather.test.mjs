import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeDriver } from "../mobile/src/db/nodeDriver.js";
import { runMigrations } from "../mobile/src/db/migrations.js";
import { mapRecipe, planBrewfatherImport, readBrewfatherExport } from "../lib/brewfather.js";
import { importBrewfatherPlan, previewBrewfatherImport } from "../mobile/src/data/brewfatherImport.js";
import { listRecipes, listRecipeBatches, getRecipeFull, countArchivedRecipes, duplicateRecipe } from "../mobile/src/data/recipes.js";
import { createBatchForRecipe, getBatchFull } from "../mobile/src/data/batches.js";
import { buildExportBundle, verifyBundle } from "../mobile/src/data/exportImport.js";

async function freshDb() {
  const db = createNodeDriver();
  await runMigrations(db);
  return db;
}

const DAY = 86400000;
const T0 = Date.UTC(2024, 4, 12, 8);

// Export Brewfather fictif : une IPA (brassée trois fois, dont deux avec une
// version modifiée), une recette d'un autre auteur, un kéfir.
function ipa({ citra = 50, name = "Session IPA" } = {}) {
  return {
    _id: "rIPA",
    name,
    author: "Alex Martin",
    type: "All Grain",
    style: { name: "American IPA", category: "IPA" },
    batchSize: 20,
    boilSize: 25,
    boilTime: 60,
    efficiency: 72,
    og: 1.0523,
    fg: 1.0101,
    abv: 5.53,
    ibu: 41.6,
    color: 3.5,
    carbonation: 2.4,
    preBoilGravity: 1.0441,
    notes: "Viser une eau douce.",
    _created: { seconds: 1700000000, nanoseconds: 0 },
    mash: { steps: [{ name: "Saccharification", stepTemp: 66, stepTime: 60 }, { name: "Mash out", stepTemp: 76, stepTime: 10 }] },
    water: { mashWaterAmount: 15, spargeWaterAmount: 12.5, mashPh: 5.34 },
    fermentation: { steps: [{ type: "Primary", stepTemp: 19, stepTime: 10 }, { type: "Cold Crash", stepTemp: 2, stepTime: 3 }] },
    fermentables: [
      { name: "Pilsner Malt", type: "Grain", amount: 4.2, color: 1.8, supplier: "Weyermann", notes: "Description du catalogue.", userNotes: "Moudre fin" },
      { name: "Carapils", type: "Grain", amount: 0.25, color: 1.5 },
      { name: "Dextrose", type: "Sugar", amount: 0.2, use: "Boil", time: 10 },
    ],
    hops: [
      { name: "Magnum", use: "Boil", time: 60, amount: 15, alpha: 12.5, type: "Pellet", ibu: 30.2, notes: "Variété allemande, amérisant." },
      { name: "Citra", use: "Aroma", time: 20, temp: 80, amount: citra, alpha: 12, type: "Pellet" },
      { name: "Mosaic", use: "Dry Hop", time: 4, amount: 60, alpha: 11.5, type: "Cryo" },
    ],
    miscs: [
      { name: "Gypse", type: "Water Agent", use: "Mash", amount: 4, unit: "g" },
      { name: "Coriandre", type: "Spice", use: "Boil", time: 5, amount: 1, unit: "oz" },
    ],
    yeasts: [{ name: "US-05", laboratory: "Fermentis", productId: "US-05", form: "Dry", attenuation: 81, amount: 1, unit: "pkg" }],
  };
}

const OTHER = {
  _id: "rOTHER",
  name: "Stout du voisin",
  author: "Camille Durand",
  type: "All Grain",
  style: { name: "Dry Stout" },
  batchSize: 10,
  boilTime: 60,
  mash: { steps: [{ name: "Mash", stepTemp: 67, stepTime: 60 }] },
  fermentables: [{ name: "Pale Ale Malt", type: "Grain", amount: 2.5, color: 3 }],
  yeasts: [{ name: "S-04", amount: 11.5, unit: "g" }],
};

const KEFIR = {
  _id: "rKEFIR",
  name: "Kefir citron",
  author: "Alex Martin",
  style: { name: "Water Kefir" },
  batchSize: 2,
  boilTime: 0,
  fermentation: { steps: [{ type: "Primary", stepTemp: 22, stepTime: 2 }] },
  fermentables: [{ name: "Sucre de canne", type: "Sugar", amount: 0.1 }],
  miscs: [{ name: "Citron", type: "Flavor", use: "Primary", amount: 1, unit: "items" }],
};

function batch(id, no, recipe, { brew, status = "Completed", ...extra } = {}) {
  return { _id: id, batchNo: no, name: "Batch", status, brewDate: brew, fermentationStartDate: brew, bottlingDate: brew + 14 * DAY, recipe, ...extra };
}

function exportFile() {
  return {
    _type: "Brewfather_Export_User_1",
    user: { name: "Alex Martin" },
    data: {
      recipes: [ipa(), OTHER, KEFIR],
      batches: [
        batch("b1", 1, ipa({ citra: 40, name: "Première IPA" }), { brew: T0, measuredOg: 1.054, measuredFg: 1.011, measuredAbv: 5.6, measuredAttenuation: 79.6, measuredEfficiency: 70, measuredBatchSize: 19, tasteRating: 84, tasteNotes: "Très fruitée.", batchNotes: "Empâtage un peu chaud.", notes: [{ timestamp: T0 + DAY, note: "Fermentation vive.", status: "Fermenting" }, { timestamp: T0, note: "", type: "statusChanged" }] }),
        batch("b2", 2, ipa(), { brew: T0 + 60 * DAY }),
        batch("b3", 3, ipa({ citra: 40, name: "Première IPA" }), { brew: T0 + 120 * DAY }),
        batch("b4", 4, { _id: "rIPA" }, { brew: T0 + 180 * DAY }),
        batch("b5", 5, ipa(), { brew: T0 + 240 * DAY, status: "Planning" }),
      ],
    },
  };
}

test("lecture : un fichier qui n'est pas un export Brewfather est refusé", () => {
  assert.throws(() => readBrewfatherExport({ format: "fermpal-local-export" }), { code: "not_brewfather" });
  assert.throws(() => readBrewfatherExport(null), { code: "not_brewfather" });
});

test("recette : phases de brassage, ingrédients rattachés et valeurs cibles", () => {
  const m = mapRecipe(ipa(), { userName: "Alex Martin", lang: "fr" });
  assert.equal(m.recipe.type, "biere");
  assert.equal(m.recipe.style, "American IPA");
  assert.deepEqual([m.recipe.expected_og, m.recipe.expected_fg, m.recipe.expected_abv, m.recipe.expected_ibu, m.recipe.expected_ebc], [1.052, 1.01, 5.5, 42, 7]);
  assert.equal(m.recipe.instructions, "Rendement : 72 %\n\nViser une eau douce.", "pas de ligne d'auteur pour ses propres recettes");
  assert.deepEqual(m.phases.map((p) => [p.key, p.name, p.duration_value, p.duration_unit, p.temperature_target]), [
    ["mash", "Empâtage", 70, "minutes", 66],
    ["boil", "Ébullition", 60, "minutes", 100],
    ["ferm0", "Fermentation primaire", 10, "jours", 19],
    ["ferm1", "Cold crash", 3, "jours", 2],
  ]);
  assert.match(m.phases[0].notes, /Saccharification : 66 °C · 60 min/);
  assert.match(m.phases[0].notes, /Eau de rinçage : 12.5 L/);
  assert.match(m.phases[0].notes, /pH d'empâtage estimé : 5.34/);
  assert.match(m.phases[3].notes, /Carbonatation visée : 2.4 vol CO₂/);

  const by = Object.fromEntries(m.ingredients.map((l) => [l.name, l]));
  assert.deepEqual([by["Pilsner Malt"].amount, by["Pilsner Malt"].unit, by["Pilsner Malt"].phaseKey, by["Pilsner Malt"].category], [4.2, "kg", "mash", "grain"]);
  assert.equal(by["Pilsner Malt"].notes, "3.5 EBC · Weyermann · Moudre fin", "notes de l'utilisateur gardées, description du catalogue écartée");
  assert.deepEqual([by.Carapils.amount, by.Carapils.unit], [250, "g"]);
  assert.deepEqual([by.Dextrose.category, by.Dextrose.phaseKey, by.Dextrose.timing, by.Dextrose.notes], ["sucre", "boil", "Ébullition 10 min", null]);
  assert.deepEqual([by.Magnum.phaseKey, by.Magnum.timing, by.Magnum.alpha_acid_pct, by.Magnum.notes], ["boil", "Ébullition 60 min", 12.5, "Pellet · 30.2 IBU"]);
  assert.equal(by.Citra.timing, "Whirlpool 20 min · 80 °C");
  assert.deepEqual([by.Mosaic.phaseKey, by.Mosaic.timing], ["ferm0", "Houblonnage à cru 4 j"]);
  assert.deepEqual([by.Gypse.phaseKey, by.Gypse.category], ["mash", "autre"]);
  assert.deepEqual([by.Coriandre.amount, by.Coriandre.unit, by.Coriandre.category], [28.35, "g", "plante"], "onces converties en grammes");
  assert.deepEqual([by["US-05"].unit, by["US-05"].sub_type, by["US-05"].phaseKey, by["US-05"].category], ["sachet", "Fermentis US-05", "ferm0", "levure"]);
});

test("recette : auteur tiers noté, kéfir reconnu, libellés dans la langue choisie", () => {
  const ramp = mapRecipe({ ...ipa(), fermentation: { steps: [{ type: "Primary", stepTemp: 18, stepTime: 3 }, { type: "Primary", stepTemp: 21, stepTime: 4 }] } }, { lang: "fr" });
  assert.deepEqual(ramp.phases.slice(2).map((p) => p.name), ["Fermentation primaire", "Fermentation primaire 2"], "palier de température : étapes numérotées");
  const other = mapRecipe(OTHER, { userName: "Alex Martin", lang: "fr" });
  assert.match(other.recipe.instructions, /^Auteur : Camille Durand/);
  assert.equal(other.phases.at(-1).name, "Fermentation", "sans étapes de fermentation : une phase générique");
  const kefir = mapRecipe(KEFIR, { userName: "Alex Martin", lang: "en" });
  assert.equal(kefir.recipe.type, "kefir_eau");
  assert.deepEqual(kefir.phases.map((p) => p.name), ["Primary Fermentation"]);
  assert.deepEqual(kefir.ingredients.map((l) => [l.name, l.unit, l.timing]), [["Sucre de canne", "g", null], ["Citron", "pièce", "Primary fermentation"]]);
  assert.ok(kefir.ingredients.every((l) => l.phaseKey === "ferm0"), "sans empâtage ni ébullition : tout va à la fermentation");
});

test("plan : chaque brassin garde la recette brassée, versions identiques partagées", () => {
  const plan = planBrewfatherImport(exportFile(), { lang: "fr" });
  assert.equal(plan.recipes.filter((r) => !r.archived).length, 3);
  const archives = plan.recipes.filter((r) => r.archived);
  assert.equal(archives.length, 1, "b1 et b3 ont brassé la même version : une seule recette d'archive");
  assert.equal(archives[0].recipe.title, "Première IPA (#1)");
  assert.equal(archives[0].archive_of_external_id, "brewfather:recipe:rIPA");
  assert.deepEqual(plan.skipped, { planning: 1, noRecipe: 0 });
  const by = Object.fromEntries(plan.batches.map((b) => [b.title, b]));
  assert.deepEqual(Object.keys(by), ["Première IPA #1", "Session IPA #2", "Première IPA #3", "Session IPA #4"]);
  assert.equal(by["Première IPA #1"].recipe_external_id, archives[0].external_id);
  assert.equal(by["Première IPA #3"].recipe_external_id, archives[0].external_id);
  assert.equal(by["Session IPA #2"].recipe_external_id, "brewfather:recipe:rIPA", "version identique à la recette actuelle");
  assert.equal(by["Session IPA #4"].recipe_external_id, "brewfather:recipe:rIPA", "recette absente du brassin : recette actuelle");
  assert.match(by["Session IPA #4"].journal[0].content, /n'avait pas gardé la recette/);
  const first = by["Première IPA #1"];
  assert.equal(first.rating, 4);
  assert.equal(first.notes, "Très fruitée.");
  assert.equal(first.volume, 19);
  assert.match(first.journal[0].content, /Densité initiale : 1.054 \(visée 1.052\)/);
  assert.match(first.journal[0].content, /Rendement : 70 %/);
  assert.deepEqual(first.journal.slice(1).map((j) => j.content), ["Empâtage un peu chaud.", "Fermentation vive."]);
  assert.equal(first.lines.find((l) => l.name === "Citra").amount, 40, "lignes = quantités réellement brassées");
});

test("import : recettes, archives masquées, brassins archivés et réimport sans doublon", async () => {
  const db = await freshDb();
  const plan = planBrewfatherImport(exportFile(), { lang: "fr" });
  assert.deepEqual(await previewBrewfatherImport(db, plan), { recipes: 3, archives: 1, batches: 4, alreadyPresent: 0, planning: 1 });
  assert.deepEqual(await importBrewfatherPlan(db, plan), { recipes: 3, archives: 1, batches: 4 });

  const visible = await listRecipes(db);
  assert.deepEqual(visible.map((r) => r.title).sort(), ["Kefir citron", "Session IPA", "Stout du voisin"]);
  assert.equal(await countArchivedRecipes(db), 1);
  const [archive] = await listRecipes(db, { archived: true });
  const current = visible.find((r) => r.title === "Session IPA");
  assert.equal(archive.archive_of, current.id);
  assert.deepEqual(current.tags, ["brewfather"]);
  assert.equal(current.expected_og, 1.052);
  assert.equal(current.created_at, new Date(1700000000 * 1000).toISOString());

  const history = await listRecipeBatches(db, current.id);
  assert.equal(history.length, 4, "l'historique de la recette inclut les brassins de ses versions d'archive");
  assert.ok(history.every((b) => b.status === "archive"));

  const first = history.find((b) => b.title === "Première IPA #1");
  const full = await getBatchFull(db, first.id);
  assert.equal(full.recipe.id, archive.id);
  assert.equal(full.batch.created_at, new Date(T0).toISOString());
  assert.equal(full.lines.length, 9);
  assert.ok(full.lines.every((l) => !l.deducted), "aucun prélèvement de stock");
  const entered = Object.fromEntries(full.log.filter((l) => l.stage === "en_cours").map((l) => [l.phase_id, l.entered_at.slice(0, 10)]));
  assert.deepEqual(full.phases.map((p) => [p.name, entered[p.id]]), [
    ["Empâtage", "2024-05-12"], ["Ébullition", "2024-05-12"], ["Fermentation primaire", "2024-05-12"], ["Cold crash", "2024-05-22"],
  ]);
  assert.equal(full.journal.length, 3);
  assert.deepEqual(await db.query("pragma foreign_key_check"), []);

  assert.deepEqual(await previewBrewfatherImport(db, plan), { recipes: 0, archives: 0, batches: 0, alreadyPresent: 8, planning: 1 });
  assert.deepEqual(await importBrewfatherPlan(db, plan), { recipes: 0, archives: 0, batches: 0 });
  assert.equal(Number((await db.query("select count(*) as c from batches"))[0].c), 4);
});

test("rebrasser un brassin passé : nouvelle recette active avec les quantités brassées", async () => {
  const db = await freshDb();
  await importBrewfatherPlan(db, planBrewfatherImport(exportFile(), { lang: "fr" }));
  const [archive] = await listRecipes(db, { archived: true });
  const nb = await createBatchForRecipe(db, { recipe: archive, title: "Première IPA #5", volume: 20, lang: "fr" });
  assert.equal(nb.status, "planifie");
  assert.equal(await countArchivedRecipes(db), 0, "la recette brassée revient dans la liste");
  const full = await getBatchFull(db, nb.id);
  assert.equal(full.lines.find((l) => l.name === "Citra").amount, 40);
  assert.equal(full.phases.length, 4);
});

test("copie du carnet : un carnet importé s'exporte et se vérifie, la duplication garde les cibles", async () => {
  const db = await freshDb();
  await importBrewfatherPlan(db, planBrewfatherImport(exportFile(), { lang: "fr" }));
  const bundle = await buildExportBundle(db, { platform: "node" });
  await verifyBundle(bundle);
  const current = (await listRecipes(db)).find((r) => r.title === "Session IPA");
  const { id } = await duplicateRecipe(db, current.id);
  const copy = await getRecipeFull(db, id);
  assert.equal(copy.recipe.expected_ibu, 42);
  assert.equal(copy.recipe.external_id, null, "une copie n'est pas l'original Brewfather");
});
