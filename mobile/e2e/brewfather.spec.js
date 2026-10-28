// Import d'un export Brewfather (fichier fictif) : aperçu, recettes et
// recettes d'archive, historique des brassins, rebrassage, réimport sans doublon.
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let context;
let page;
let base;
const externalRequests = [];

const DAY = 86400000;
const T0 = Date.UTC(2024, 4, 12, 8);

function ipa({ citra = 50, name = "Session IPA" } = {}) {
  return {
    _id: "rIPA", name, author: "Alex Martin", type: "All Grain", style: { name: "American IPA" },
    batchSize: 20, boilTime: 60, og: 1.0523, fg: 1.0101, abv: 5.53, ibu: 41.6, color: 3.5,
    mash: { steps: [{ name: "Saccharification", stepTemp: 66, stepTime: 60 }] },
    fermentation: { steps: [{ type: "Primary", stepTemp: 19, stepTime: 10 }] },
    fermentables: [{ name: "Pilsner Malt", type: "Grain", amount: 4.2, color: 1.8 }],
    hops: [
      { name: "Magnum", use: "Boil", time: 60, amount: 15, alpha: 12.5 },
      { name: "Citra", use: "Aroma", time: 20, amount: citra, alpha: 12 },
    ],
    yeasts: [{ name: "US-05", amount: 1, unit: "pkg" }],
  };
}

const EXPORT = {
  _type: "Brewfather_Export_User_1",
  user: { name: "Alex Martin" },
  data: {
    recipes: [ipa(), { _id: "rKEFIR", name: "Kefir citron", style: { name: "Water Kefir" }, batchSize: 2, fermentables: [{ name: "Sucre", type: "Sugar", amount: 0.1 }] }],
    batches: [
      { _id: "b1", batchNo: 1, status: "Completed", brewDate: T0, bottlingDate: T0 + 14 * DAY, recipe: ipa({ citra: 40, name: "Première IPA" }), measuredOg: 1.054, tasteRating: 84 },
      { _id: "b2", batchNo: 2, status: "Completed", brewDate: T0 + 60 * DAY, bottlingDate: T0 + 74 * DAY, recipe: ipa() },
      { _id: "b3", batchNo: 3, status: "Planning", brewDate: T0 + 90 * DAY, recipe: ipa() },
    ],
  },
};

const file = { name: "brewfather.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(EXPORT)) };

test.beforeAll(async ({ browser, baseURL }) => {
  base = baseURL;
  context = await browser.newContext({ ...test.info().project.use, locale: "fr-CH" });
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

test("import Brewfather : aperçu, recettes visibles, version brassée en archive", async () => {
  await page.goto(`${base}/#/app/settings`);
  await page.getByTestId("settings-brewfather").click();
  await page.getByTestId("brewfather-input").setInputFiles(file);
  const preview = page.getByTestId("brewfather-preview");
  await expect(preview).toContainText("Recettes : 2");
  await expect(preview).toContainText("Recettes d'archive (versions brassées) : 1");
  await expect(preview).toContainText("Brassins passés : 2");
  await expect(preview).toContainText("Brassins en préparation, non repris : 1");
  await page.getByTestId("brewfather-import").click();

  await expect(page.getByTestId("recipe-count")).toHaveText("2 recettes");
  await expect(page.getByTestId("recipes-archives")).toHaveText(/Recettes d'archive \(1\)/);

  await page.getByRole("link", { name: /Session IPA/ }).click();
  await expect(page.getByTestId("recipe-targets")).toContainText("DI 1.052 · DF 1.010 · 5.5 % · 42 IBU · 7 EBC");
  await expect(page.getByTestId("recipe-batches-toggle")).toHaveText("2 brassins");
  await expect(page.getByTestId("line-details").first()).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("brassin passé : recette brassée, moment d'ajout des houblons, rebrassage", async () => {
  await page.getByTestId("recipe-batches-toggle").click();
  await page.getByRole("link", { name: /Première IPA #1/ }).click();
  await expect(page.getByText("Archivé").first()).toBeVisible();
  await page.locator("summary", { hasText: "Ébullition" }).click();
  await expect(page.getByText("Citra — 40g · Whirlpool 20 min")).toBeVisible();
  await page.getByRole("button", { name: /Refaire ce brassin/ }).click();
  await expect(page.getByTestId("batch-start")).toBeVisible();

  await page.goto(`${base}/#/app/recipes`);
  await expect(page.getByTestId("recipe-count")).toHaveText("3 recettes");
  await expect(page.getByTestId("recipes-archives")).toHaveCount(0);
});

test("réimport du même fichier : rien de nouveau", async () => {
  await page.goto(`${base}/#/app/recipes/import-brewfather`);
  await page.getByTestId("brewfather-input").setInputFiles(file);
  await expect(page.getByTestId("brewfather-preview")).toContainText("Rien de nouveau");
  await expect(page.getByTestId("brewfather-import")).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});
