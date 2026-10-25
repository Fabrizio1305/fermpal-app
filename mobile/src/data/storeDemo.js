// Carnet de démonstration pour les CAPTURES de la fiche Google Play (mobile/
// scripts/store-screenshots.mjs) : un stock plausible, trois recettes réelles
// et trois brassins à des stades différents, écrits par la couche données (pas
// de SQL brut) pour que les écrans montrent exactement ce que produit l'app.
// Réservé au build de test (exposé par testHooks quand VITE_TEST_HOOKS=1) ;
// aucune trace dans l'APK. Textes dans lib/i18n (clés demo.*) : une langue de
// captures = un dictionnaire.
import { saveRecipe } from "./recipes.js";
import { runStockOperation } from "./stockOperations.js";
import { createBatchForRecipe, startBatch, nextPhase, archiveBatch, addJournalEntry } from "./batches.js";
import { addShoppingRows } from "./shopping.js";
import { t } from "@/lib/i18n";

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
const daysAhead = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

export async function seedStoreDemo(db, lang = "fr") {

  await runStockOperation(db, {
    kind: "stock_create",
    payload: {
      rows: [
        { name: t("demo.rawCaneSugar", null, lang), quantity: 1250, unit: "g", category: "sucre" },
        { name: t("demo.waterKefirGrains", null, lang), quantity: 85, unit: "g", category: "levure" },
        { name: t("demo.driedFigs", null, lang), quantity: 240, unit: "g", category: "fruit" },
        { name: t("demo.organicLemons", null, lang), quantity: 5, unit: "pcs", category: "fruit", expiry_date: daysAhead(6) },
        { name: t("demo.frozenBlackberries", null, lang), quantity: 400, unit: "g", category: "fruit" },
        { name: t("demo.freshGinger", null, lang), quantity: 180, unit: "g", category: "plante" },
        { name: t("demo.blackTea", null, lang), quantity: 95, unit: "g", category: "thé" },
        { name: t("demo.citraHopsPellets", null, lang), quantity: 45, unit: "g", category: "houblon" },
      ],
    },
  });

  const kefir = await saveRecipe(db, {
    recipe: { title: t("demo.blackberryLemonWaterKefir", null, lang), type: "kefir_eau", style: t("demo.blackberry", null, lang), batch_size_ref: 2, instructions: t("demo.tasteAt24HOf", null, lang), tags: [t("demo.summer", null, lang), t("demo.easy", null, lang)] },
    phases: [
      { key: "f1", name: t("demo.primaryFermentationF1", null, lang), duration_value: 2, duration_unit: "jours", temperature_target: 22 },
      { key: "grains", name: t("demo.removeTheGrains", null, lang) },
      { key: "f2", name: t("demo.secondaryFermentationF2", null, lang), duration_value: 2, duration_unit: "jours", temperature_target: 20 },
    ],
    ingredients: [
      { phaseKey: "f1", category: "sucre", name: t("demo.rawCaneSugar", null, lang), amount: 100, unit: "g" },
      { phaseKey: "f1", category: "levure", name: t("demo.waterKefirGrains", null, lang), amount: 80, unit: "g", is_starter: true },
      { phaseKey: "f1", category: "fruit", name: t("demo.driedFig", null, lang), amount: 1, unit: "pcs" },
      { phaseKey: "f2", category: "fruit", name: t("demo.blackberries", null, lang), amount: 150, unit: "g" },
      { phaseKey: "f2", category: "fruit", name: t("demo.lemon", null, lang), amount: 0.5, unit: "pcs" },
    ],
  });

  const kombucha = await saveRecipe(db, {
    recipe: { title: t("demo.gingerLemonKombucha", null, lang), type: "kombucha", style: t("demo.gingerLemon", null, lang), batch_size_ref: 3 },
    phases: [
      { key: "the", name: t("demo.brewTheTea", null, lang), duration_value: 20, duration_unit: "minutes", temperature_target: 95 },
      { key: "f1", name: t("demo.primaryFermentationF1", null, lang), duration_value: 7, duration_unit: "jours", temperature_target: 22 },
      { key: "scoby", name: t("demo.removeTheScoby", null, lang) },
      { key: "f2", name: t("demo.secondaryFermentationF2", null, lang), duration_value: 3, duration_unit: "jours", temperature_target: 20 },
    ],
    ingredients: [
      { phaseKey: "the", category: "thé", name: t("demo.blackTea", null, lang), amount: 24, unit: "g" },
      { phaseKey: "the", category: "sucre", name: t("demo.rawCaneSugar", null, lang), amount: 210, unit: "g" },
      { phaseKey: "f1", category: "levure", name: "SCOBY", amount: 1, unit: "pcs", is_starter: true },
      { phaseKey: "f2", category: "plante", name: t("demo.freshGinger", null, lang), amount: 40, unit: "g" },
      { phaseKey: "f2", category: "fruit", name: t("demo.lemon", null, lang), amount: 1, unit: "pcs" },
    ],
  });

  const ginger = await saveRecipe(db, {
    recipe: { title: t("demo.homemadeGingerBeer", null, lang), type: "ginger_beer", style: t("demo.extraGinger", null, lang), batch_size_ref: 2 },
    phases: [
      { key: "bug", name: t("demo.gingerBug", null, lang), duration_value: 5, duration_unit: "jours", temperature_target: 24 },
      { key: "f2", name: t("demo.bottleFermentation", null, lang), duration_value: 3, duration_unit: "jours", temperature_target: 22 },
    ],
    ingredients: [
      { phaseKey: "bug", category: "plante", name: t("demo.freshGinger", null, lang), amount: 120, unit: "g" },
      { phaseKey: "bug", category: "sucre", name: t("demo.rawCaneSugar", null, lang), amount: 150, unit: "g" },
      { phaseKey: "f2", category: "fruit", name: t("demo.lemon", null, lang), amount: 2, unit: "pcs" },
    ],
  });

  // Brassin 1 : kéfir en F2 depuis 30 h (échéance proche → carte « bientôt »).
  const kefirRecipe = { id: kefir.id };
  const b1 = await createBatchForRecipe(db, { recipe: kefirRecipe, title: t("demo.blackberryLemonKefir7", null, lang), volume: 2, lang, now: hoursAgo(80) });
  await startBatch(db, b1.id, { now: hoursAgo(78) });
  await nextPhase(db, b1.id, { now: hoursAgo(31) });
  await nextPhase(db, b1.id, { now: hoursAgo(30) });
  await addJournalEntry(db, b1.id, { content: t("demo.f1VeryActiveGrainsFloating", null, lang), now: hoursAgo(30) });

  // Brassin 2 : kombucha en F1 depuis 4 jours (en cours, échéance dans 3 jours).
  const b2 = await createBatchForRecipe(db, { recipe: { id: kombucha.id }, title: t("demo.gingerLemonKombucha3", null, lang), volume: 3, lang, now: hoursAgo(100) });
  await startBatch(db, b2.id, { now: hoursAgo(97) });
  await nextPhase(db, b2.id, { now: hoursAgo(96) });

  // Brassin 3 : ginger beer terminé et dégusté (archive avec note).
  const b3 = await createBatchForRecipe(db, { recipe: { id: ginger.id }, title: t("demo.gingerBeer2", null, lang), volume: 2, lang, now: hoursAgo(300) });
  await startBatch(db, b3.id, { now: hoursAgo(298) });
  await nextPhase(db, b3.id, { now: hoursAgo(180) }); // → fermentation en bouteille
  await nextPhase(db, b3.id, { now: hoursAgo(110) }); // → dégustation (fin de la dernière phase)
  await archiveBatch(db, b3.id, { rating: 4, notes: t("demo.spicyNicelyFizzyABit", null, lang), now: hoursAgo(100) });

  await addShoppingRows(db, [
    { name: t("demo.organicLemons", null, lang), amount: 6, unit: "pcs", category: "fruit", source: "recipe_ai", recipe_title: t("demo.blackberryLemonWaterKefir", null, lang) },
    { name: t("demo.rawCaneSugar", null, lang), amount: 1, unit: "kg", category: "sucre" },
  ]);

  return { recipes: [kefir.id, kombucha.id, ginger.id], batches: [b1.id, b2.id, b3.id] };
}
