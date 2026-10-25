// Preuve L2 en mode web : le carnet complet — stock, brassin de bout en bout
// (créer, démarrer, cocher un ingrédient = prélèvement de stock, phases,
// dégustation enregistrée à la saisie, archivage), courses avec achat vers le
// stock, séparation en lots, export/restauration avec toutes les tables, mode
// sombre. Zéro requête externe sur tout le parcours.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { DATA_TABLES } from "../src/db/schema.js";

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

const confirmSheet = () => page.getByRole("button", { name: "Confirmer" }).click();

test("tableau de bord vide au premier lancement, puis stock : ajout, correction avec conversion d'unité", async () => {
  await page.goto(`${base}/#/app`);
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
  await page.waitForFunction(() => window.__fermpal?.ready === true);

  await page.goto(`${base}/#/app/stock`);
  await page.getByPlaceholder("Ingrédient", { exact: true }).fill("Sucre blanc");
  await page.getByTestId("stock-qty").fill("1000");
  await page.getByTestId("stock-add").click();
  await expect(page.getByTestId("stock-item")).toHaveCount(1);
  await expect(page.getByTestId("stock-qty-label")).toHaveText("1000 g");

  // Correction : 1000 g → 1 kg (quantité et unité), journalisée.
  await page.getByRole("button", { name: /^Modifier Sucre blanc/ }).click();
  const sheet = page.getByText(/^Modifier — Sucre blanc/).locator("..");
  await sheet.getByTestId("stock-qty").fill("1");
  const unitBox = sheet.locator("[data-testid='stock-qty'] + div input");
  await unitBox.click();
  await unitBox.fill("kg");
  await page.getByTestId("stock-save").click();
  await expect(page.getByTestId("stock-qty-label")).toHaveText("1 kg");
  expect(externalRequests).toEqual([]);
});

test("brassin de bout en bout : création depuis une recette, démarrage, ingrédient coché = stock prélevé, dégustation, archivage", async () => {
  // Une recette kombucha : thé (prépa), sucre (F1).
  await page.goto(`${base}/#/app/recipes/new`);
  await page.getByPlaceholder("Titre de la recette").fill("Kombucha test L2");
  const typeBox = page.getByPlaceholder("Type de boisson");
  await typeBox.click();
  await page.getByText("🍄 Kombucha", { exact: true }).click();
  await page.getByRole("button", { name: /Charger le modèle/ }).click();
  await confirmSheet();
  await page.getByPlaceholder("Volume (L)").fill("1");
  await page.getByPlaceholder("Ingrédient", { exact: true }).first().fill("Sucre blanc");
  await page.getByPlaceholder("Quantité").first().fill("70");
  // Rattacher la ligne à la F1.
  const phaseBox = page.getByPlaceholder("Phase", { exact: true }).first();
  await phaseBox.click();
  await page.getByText("Fermentation primaire (F1)", { exact: true }).last().click();
  await page.getByTestId("save-recipe").click();
  await expect(page.getByText("Kombucha test L2")).toBeVisible();

  // Création du brassin (2 L → sucre ×2 = 140 g).
  await page.goto(`${base}/#/app/batches`);
  await page.getByTestId("batch-new").click();
  await page.getByTestId("batch-recipe").selectOption({ label: "Kombucha test L2" });
  await expect(page.getByTestId("batch-title")).toHaveValue("Kombucha test L2 #1");
  await page.getByTestId("batch-volume").fill("2");
  await page.getByTestId("batch-create").click();
  await expect(page.getByTestId("batch-card")).toHaveCount(1);
  await page.getByTestId("batch-card").getByRole("link").first().click();

  await expect(page.getByTestId("batch-stage")).toContainText("Planifié");
  await expect(page.getByTestId("batch-line")).toHaveCount(1);
  await expect(page.getByTestId("batch-line")).toContainText("140g");
  await page.getByTestId("batch-start").click();
  await expect(page.getByTestId("batch-stage")).toContainText("Étape 1/4 · Préparation du thé");
  await page.getByTestId("batch-next").click();
  await expect(page.getByTestId("batch-stage")).toContainText("Étape 2/4 · Fermentation primaire (F1)");

  // Cocher le sucre : 140 g prélevés sur 1 kg → 0.86 kg.
  const stockBefore = await page.evaluate(() => window.__fermpal.stockQuantity("Sucre blanc"));
  expect(stockBefore).toEqual({ quantity: 1, unit: "kg" });
  await page.getByRole("checkbox", { name: /Prélevé : Sucre blanc/ }).click();
  await expect(page.getByRole("checkbox", { name: /Prélevé : Sucre blanc/ })).toBeChecked();
  expect(await page.evaluate(() => window.__fermpal.stockQuantity("Sucre blanc"))).toEqual({ quantity: 0.86, unit: "kg" });

  // Décocher rend exactement la même quantité.
  await page.getByRole("checkbox", { name: /Prélevé : Sucre blanc/ }).click();
  await expect(page.getByRole("checkbox", { name: /Prélevé : Sucre blanc/ })).not.toBeChecked();
  expect(await page.evaluate(() => window.__fermpal.stockQuantity("Sucre blanc"))).toEqual({ quantity: 1, unit: "kg" });
  await page.getByRole("checkbox", { name: /Prélevé : Sucre blanc/ }).click();
  await expect(page.getByRole("checkbox", { name: /Prélevé : Sucre blanc/ })).toBeChecked();

  // Jusqu'à la dégustation ; la note est enregistrée sans passer par « Archiver ».
  await page.getByTestId("batch-next").click();
  await page.getByTestId("batch-next").click();
  await page.getByTestId("batch-next").click();
  await expect(page.getByTestId("batch-stage")).toContainText("Dégustation");
  await page.getByTestId("tasting-notes").fill("Pétillant, un peu vinaigré.");
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId("tasting-notes")).toHaveValue("Pétillant, un peu vinaigré.");

  await page.getByTestId("batch-archive").click();
  await confirmSheet();
  await expect(page.getByTestId("batch-stage")).toContainText("Archivé");
  await expect(page.getByText("Pétillant, un peu vinaigré.")).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("courses : ajouter un article, le cocher enregistre l'achat dans le stock (kg → g converti)", async () => {
  await page.goto(`${base}/#/app/shopping`);
  await page.getByTestId("shopping-name").fill("Sucre blanc");
  await page.getByRole("spinbutton", { name: "Quantité" }).fill("500");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(1);
  await page.getByRole("checkbox", { name: /Acheté : Sucre blanc/ }).click();
  await expect(page.getByText("Acheté (1)")).toBeVisible();
  // 0.86 kg + 500 g = 1.36 kg
  expect(await page.evaluate(() => window.__fermpal.stockQuantity("Sucre blanc"))).toEqual({ quantity: 1.36, unit: "kg" });
  await page.getByRole("button", { name: "Vider les achetés" }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(0);
});

test("séparer un brassin en lots : volumes répartis, lots visibles, report en recette bloqué", async () => {
  await page.goto(`${base}/#/app/batches`);
  await page.getByTestId("batch-new").click();
  await page.getByTestId("batch-recipe").selectOption({ label: "Kombucha test L2" });
  await page.getByTestId("batch-volume").fill("3");
  await page.getByTestId("batch-create").click();
  await expect(page.getByTestId("batch-card")).toHaveCount(2);
  await page.getByTestId("batch-card").filter({ hasText: "#2" }).getByRole("link").first().click();
  await page.getByTestId("batch-start").click();
  await page.getByTestId("batch-next").click();
  await page.getByRole("button", { name: "Séparer en lots" }).click();
  await page.getByLabel("Volume mis de côté (L)").fill("1");
  await page.getByRole("button", { name: "Séparer", exact: true }).click();
  await expect(page.getByText("Lots séparés (1)")).toBeVisible();
  await expect(page.getByText("Volume du brassin")).toBeVisible();
  await expect(page.locator("#batch-volume")).toHaveValue("2");
  await expect(page.getByText(/Report en recette indisponible après séparation/)).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("export complet : toutes les tables présentes, restauration à l'identique", async () => {
  await page.goto(`${base}/#/app/settings`);
  const before = await page.evaluate(() => window.__fermpal.fingerprint());
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-button").click()]);
  const path = test.info().outputPath("carnet-complet.json");
  await download.saveAs(path);
  const bundle = JSON.parse(fs.readFileSync(path, "utf8"));
  for (const t of DATA_TABLES) expect(Array.isArray(bundle.data[t])).toBe(true);
  expect(bundle.manifest.counts.batches).toBe(3);
  expect(bundle.manifest.counts.stock_movements).toBeGreaterThan(3);

  // On efface tout via une restauration d'un carnet vide… en fait on vérifie
  // simplement qu'une restauration du même paquet ne change rien.
  await page.getByTestId("restore-input").setInputFiles(path);
  await confirmSheet();
  await expect(page.getByTestId("stats-batches")).toHaveText("3");
  expect(await page.evaluate(() => window.__fermpal.fingerprint())).toBe(before);
});

test("mode sombre : le réglage bascule les variables du thème et survit au rechargement", async () => {
  await page.goto(`${base}/#/app`);
  const bgLight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fp-bg").trim());
  expect(bgLight).toBe("#f5f2ea");
  await page.goto(`${base}/#/app/settings`);
  await page.getByTestId("theme-choice").getByRole("button", { name: "Sombre" }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  const bgDark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fp-bg").trim());
  expect(bgDark).toBe("#16140f");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(22, 20, 15)");
  await page.getByTestId("theme-choice").getByRole("button", { name: /^Auto/ }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(null);
  // Langue : le choix est aussi ici, et il s'applique tout de suite.
  await page.getByTestId("lang-choice").getByRole("button", { name: /English/ }).click();
  await expect(page.getByText("Settings", { exact: true })).toBeVisible();
  // Les référentiels suivent la langue : catalogue d'ingrédients et styles en anglais.
  await page.goto(`${base}/#/app/stock`);
  await page.getByPlaceholder("Ingredient", { exact: true }).first().click();
  await expect(page.getByText("White sugar", { exact: true })).toBeVisible();
  await page.goto(`${base}/#/app/settings`);
  await page.getByTestId("lang-choice").getByRole("button", { name: /Français/ }).click();
  await expect(page.getByText("Paramètres", { exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("italien : troisième langue du sélecteur, écrans et modèle de phases traduits", async () => {
  await page.goto(`${base}/#/app/settings`);
  await page.getByTestId("lang-choice").getByRole("button", { name: /Italiano/ }).click();
  await expect(page.getByText("Impostazioni", { exact: true })).toBeVisible();
  await expect(page.getByText("Lingua", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fermpal_lang"))).toBe("it");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("it");
  // Recette neuve : modèle de phases du kéfir d'eau copié en italien.
  await page.goto(`${base}/#/app/recipes/new`);
  await expect(page.getByText("Nuova ricetta", { exact: true })).toBeVisible();
  await expect(page.getByText("Fermentazione primaria (F1)")).toBeVisible();
  await expect(page.getByText("Rimozione dei grani")).toBeVisible();
  await page.goto(`${base}/#/app/stock`);
  await expect(page.getByText("Aggiungi un ingrediente", { exact: true })).toBeVisible();
  // Retour au français par le même sélecteur.
  await page.goto(`${base}/#/app/settings`);
  await page.getByTestId("lang-choice").getByRole("button", { name: /Français/ }).click();
  await expect(page.getByText("Paramètres", { exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
});
