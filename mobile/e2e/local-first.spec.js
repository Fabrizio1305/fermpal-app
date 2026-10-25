// Preuve L1 en mode web (cadrage §8, ligne L1) : zéro appel externe,
// persistance après arrêt/relance, 300 recettes, export/restauration sans
// perte, migration interrompue sans dégât. Un seul contexte de navigateur
// partagé : l'IndexedDB (= « le téléphone ») survit entre les tests.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { SCHEMA_VERSION, DATA_TABLES } from "../src/db/schema.js";

test.describe.configure({ mode: "serial" });

let context;
let page;
let base;
const externalRequests = [];

test.beforeAll(async ({ browser, baseURL }) => {
  base = baseURL;
  context = await browser.newContext({ ...test.info().project.use, locale: "fr-CH", acceptDownloads: true });
  page = await context.newPage();
  page.on("request", (req) => {
    if (!req.url().startsWith(base)) externalRequests.push(req.url());
  });
  page.on("pageerror", (err) => {
    throw err;
  });
});

test.afterAll(async () => {
  await context?.close();
});

async function confirmSheet() {
  await page.getByRole("button", { name: "Confirmer" }).click();
}

test("premier lancement : carnet vide, base ouverte, aucune requête externe", async () => {
  await page.goto(`${base}/#/app/recipes`);
  await expect(page.getByTestId("recipe-count")).toHaveText(/^0 recette/);
  await page.waitForFunction(() => window.__fermpal?.ready === true);
  expect(await page.evaluate(() => window.__fermpal.version())).toBe(SCHEMA_VERSION);
  expect(externalRequests).toEqual([]);
});

test("créer une recette, la retrouver après un arrêt/relance", async () => {
  await page.getByRole("link", { name: "+ Nouvelle" }).click();
  await expect(page.getByText("Nouvelle recette")).toBeVisible();
  await page.getByPlaceholder("Titre de la recette").fill("Kéfir d'eau citron (L1)");
  // Une ligne d'ingrédient rattachée à la première phase du modèle kéfir.
  await page.getByPlaceholder("Ingrédient").first().fill("Sucre blanc");
  await page.getByPlaceholder("Quantité").first().fill("60");
  await page.getByTestId("save-recipe").click();
  await expect(page.getByTestId("recipe-count")).toHaveText(/^1 recette/);
  await expect(page.getByText("Kéfir d'eau citron (L1)")).toBeVisible();

  // « Fermer l'app et la rouvrir » : rechargement complet, même stockage.
  await page.reload();
  await expect(page.getByTestId("recipe-count")).toHaveText(/^1 recette/);
  await expect(page.getByText("Kéfir d'eau citron (L1)")).toBeVisible();

  // La recette rouverte contient bien sa ligne et ses phases.
  await page.getByRole("link", { name: /^Modifier / }).first().click();
  await expect(page.getByPlaceholder("Titre de la recette")).toHaveValue("Kéfir d'eau citron (L1)");
  await expect(page.getByText("Sucre blanc")).toBeVisible();
  await expect(page.getByText("Fermentation primaire (F1)")).toBeVisible();
  // Modification → version 2 archivée.
  await page.getByPlaceholder("Titre de la recette").fill("Kéfir d'eau citron (L1, v2)");
  await page.getByTestId("save-recipe").click();
  await expect(page.getByText("Kéfir d'eau citron (L1, v2)")).toBeVisible();
  await expect(page.getByText("· v2")).toBeVisible();
});

test("300 recettes synthétiques, export puis restauration sans perte", async () => {
  test.setTimeout(240_000);
  await page.goto(`${base}/#/app/settings`);
  await expect(page.getByTestId("stats-recipes")).toHaveText("1");
  await page.getByTestId("seed-button").click();
  await confirmSheet();
  await expect(page.getByTestId("stats-recipes")).toHaveText("301", { timeout: 60_000 });
  const phases = Number(await page.getByTestId("stats-recipe_phases").textContent());
  const lines = Number(await page.getByTestId("stats-recipe_ingredients").textContent());
  expect(phases).toBeGreaterThanOrEqual(300);
  expect(lines).toBeGreaterThanOrEqual(300);
  const fingerprintBefore = await page.evaluate(() => window.__fermpal.fingerprint());

  // Export = téléchargement en mode web.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-button").click()]);
  expect(download.suggestedFilename()).toMatch(/^fermpal-carnet-\d{8}-\d{4}\.json$/);
  const exportPath = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(exportPath);
  const bundle = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  expect(bundle.format).toBe("fermpal-local-export");
  const expectedCounts = Object.fromEntries(DATA_TABLES.map((t) => [t, 0]));
  Object.assign(expectedCounts, { recipes: 301, recipe_phases: phases, recipe_ingredients: lines, recipe_versions: 1 });
  expect(bundle.manifest.counts).toEqual(expectedCounts);
  expect(bundle.manifest.sha256).toBe(fingerprintBefore);

  // On vide le carnet (retrait des 300 démo + suppression de la vraie recette).
  await page.getByTestId("unseed-button").click();
  await confirmSheet();
  await expect(page.getByTestId("stats-recipes")).toHaveText("1");
  await page.goto(`${base}/#/app/recipes`);
  await page.getByRole("button", { name: /^Supprimer / }).first().click();
  await confirmSheet();
  await expect(page.getByTestId("recipe-count")).toHaveText(/^0 recette/);

  // Restauration depuis le fichier exporté : tout revient, au bit près.
  await page.goto(`${base}/#/app/settings`);
  await expect(page.getByTestId("stats-recipes")).toHaveText("0");
  await page.getByTestId("restore-input").setInputFiles(exportPath);
  await confirmSheet();
  await expect(page.getByTestId("stats-recipes")).toHaveText("301", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__fermpal.fingerprint())).toBe(fingerprintBefore);
  // Une copie de secours de l'état d'avant (carnet vide) a été gardée.
  await expect(page.getByTestId("backups-list")).toContainText("avant-restauration");

  // Après relance, les 301 recettes sont toujours là.
  await page.goto(`${base}/#/app/recipes`);
  await page.reload();
  await expect(page.getByTestId("recipe-count")).toHaveText(/^301 recettes/);
});

test("fichier altéré : refusé, carnet intact", async () => {
  await page.goto(`${base}/#/app/settings`);
  const before = await page.evaluate(() => window.__fermpal.fingerprint());
  const bad = { format: "fermpal-local-export", formatVersion: 1, schemaVersion: 1, exportedAt: new Date().toISOString(), data: { recipes: [{ id: "x", title: "corrompu" }], recipe_phases: [], recipe_ingredients: [], recipe_versions: [] }, manifest: { counts: { recipes: 1, recipe_phases: 0, recipe_ingredients: 0, recipe_versions: 0 }, sha256: "0000" } };
  const badPath = test.info().outputPath("altere.json");
  fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.getByTestId("restore-input").setInputFiles(badPath);
  await expect(page.getByTestId("toast")).toContainText(/Empreinte des données différente/);
  expect(await page.evaluate(() => window.__fermpal.fingerprint())).toBe(before);
  await expect(page.getByTestId("stats-recipes")).toHaveText("301");
});

test("migration interrompue : version et données intactes, copie préalable écrite, l'app rouvre", async () => {
  const r = await page.evaluate(() => window.__fermpal.simulateInterruptedMigration());
  expect(r.error).toMatch(/panne simulée/);
  expect(r.versionBefore).toBe(SCHEMA_VERSION);
  expect(r.versionAfter).toBe(SCHEMA_VERSION);
  expect(r.recipesAfter).toBe(r.recipesBefore);
  expect(r.recipesAfter).toBe(301);
  expect(r.tableCreated).toBe(false);
  expect(r.backupsAfter).toBe(r.backupsBefore + 1);

  await page.goto(`${base}/#/app/recipes`);
  await page.reload();
  await expect(page.getByTestId("recipe-count")).toHaveText(/^301 recettes/);
  expect(externalRequests).toEqual([]);
});
