// Services de l'app en usage personnel (23/10) en mode web : clé Gemini (vérifiée,
// gardée, retirée) et recette IA en direct (contexte local, import + courses,
// clé refusée), copie du carnet dans le kDrive (relier avec un jeton, envoi d'un
// export complet vérifiable, restauration, rétention, suppression, copie
// automatique, délier). Gemini et le kDrive sont SIMULÉS ici : aucune requête ne
// sort, et toute requête vers un autre hôte fait échouer le test.
import { test, expect } from "@playwright/test";
import { EXPORT_FORMAT } from "../src/data/exportImport.js";

test.describe.configure({ mode: "serial" });

const KDRIVE = "https://api.infomaniak.com";
const GEMINI = "https://generativelanguage.googleapis.com";
const TOKEN = "tok-test";
const KEY = "fausse-cle-gemini-0123456789";

// Recette renvoyée par « Gemini » : le sucre existe en stock (50 g pour 100 g →
// il en manque 50), les grains sont un starter, le citron est absent.
const RECIPE = {
  title: "Kéfir citron (test)",
  instructions: "Dissoudre le sucre, ajouter les grains, couvrir. Filtrer après la F1, ajouter le citron, embouteiller.",
  phases: [
    { name: "F1", duration_value: 2, duration_unit: "jours", temperature_target: 22, notes: "Couvrir le bocal" },
    { name: "F2", duration_value: 1, duration_unit: "jours", temperature_target: 22, notes: null },
  ],
  ingredients: [
    { phase_index: 0, category: "sucre", name: "Sucre de canne", amount: 100, unit: "g", is_starter: false },
    { phase_index: 0, category: "levure", name: "Grains de kéfir", amount: 60, unit: "g", is_starter: true },
    { phase_index: 1, category: "fruit", name: "Citron", amount: 1, unit: "pcs", is_starter: false },
  ],
};

let context;
let page;
let base;
const calls = { kdrive: 0, gemini: 0, generate: [], outside: [] };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, x-goog-api-key" };
const json = (route, body, status = 200) => route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

// Faux kDrive : racine 1, espace privé « Private » (5) ; fichiers en mémoire.
const nodes = new Map([
  [1, { id: 1, name: "", type: "dir", parent: 0 }],
  [5, { id: 5, name: "Private", type: "dir", parent: 1, visibility: "is_private_space" }],
]);
let nextId = 100;
const childrenOf = (id) => [...nodes.values()].filter((n) => n.parent === id);
const copies = () => [...nodes.values()].filter((n) => n.type === "file" && nodes.get(n.parent)?.name === "sauvegardes-app");

async function kdriveRoute(route) {
  const req = route.request();
  const u = new URL(req.url());
  const m = req.method();
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  calls.kdrive++;
  if (req.headers().authorization !== `Bearer ${TOKEN}`) return json(route, { result: "error", error: { code: "not_authorized" } }, 401);
  const ok = (data, extra = {}) => json(route, { result: "success", data, ...extra });
  let g;
  if (m === "GET" && (g = /^\/3\/drive\/42\/files\/(\d+)\/files$/.exec(u.pathname))) {
    return ok(childrenOf(Number(g[1])).map(({ bytes, parent, ...f }) => ({ ...f, size: bytes?.length, added_at: 1790000000 })), { has_more: false, cursor: null });
  }
  if (m === "POST" && (g = /^\/3\/drive\/42\/files\/(\d+)\/directory$/.exec(u.pathname))) {
    const id = nextId++;
    nodes.set(id, { id, name: JSON.parse(req.postData()).name, type: "dir", parent: Number(g[1]) });
    return ok({ id });
  }
  if (m === "POST" && u.pathname === "/3/drive/42/upload") {
    const dir = Number(u.searchParams.get("directory_id"));
    const name = u.searchParams.get("file_name");
    if (childrenOf(dir).some((n) => n.name === name)) return json(route, { result: "error", error: { code: "destination_already_exists" } }, 400);
    const id = nextId++;
    nodes.set(id, { id, name, type: "file", parent: dir, bytes: req.postDataBuffer() });
    return ok({ id, name });
  }
  if (m === "GET" && (g = /^\/2\/drive\/42\/files\/(\d+)\/download$/.exec(u.pathname))) {
    const n = nodes.get(Number(g[1]));
    return n ? route.fulfill({ status: 200, headers: CORS, contentType: "application/octet-stream", body: n.bytes }) : json(route, { result: "error", error: { code: "not_found" } }, 404);
  }
  if (m === "DELETE" && (g = /^\/2\/drive\/42\/files\/(\d+)$/.exec(u.pathname))) {
    nodes.delete(Number(g[1]));
    return ok(true);
  }
  return json(route, { result: "error", error: { code: `route factice absente : ${m} ${u.pathname}` } }, 500);
}

// Faux Gemini : vérifie la clé ; GET = fiche du modèle (test de clé), POST = recette.
async function geminiRoute(route) {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  calls.gemini++;
  if (req.headers()["x-goog-api-key"] !== KEY) return json(route, { error: { code: 400, message: "API key not valid. Please pass a valid API key." } }, 400);
  if (req.method() === "GET") return json(route, { name: "models/test" });
  const body = JSON.parse(req.postData());
  calls.generate.push({ url: req.url(), prompt: body.contents[0].parts[0].text, body });
  return json(route, { candidates: [{ content: { parts: [{ text: JSON.stringify(RECIPE) }] } }] });
}

test.beforeAll(async ({ browser, baseURL }) => {
  base = baseURL;
  context = await browser.newContext({ ...test.info().project.use, locale: "fr-CH" });
  await context.route(`${KDRIVE}/**`, kdriveRoute);
  await context.route(`${GEMINI}/**`, geminiRoute);
  page = await context.newPage();
  page.on("pageerror", (err) => {
    throw err;
  });
  page.on("request", (req) => {
    const u = req.url();
    if (!u.startsWith(base) && !u.startsWith(KDRIVE) && !u.startsWith(GEMINI) && !u.startsWith("data:") && !u.startsWith("blob:")) calls.outside.push(u);
  });
});

test.afterAll(async () => {
  expect(calls.outside).toEqual([]);
  await context?.close();
});

const confirmSheet = () => page.getByRole("button", { name: "Confirmer" }).click();
const ready = () => page.waitForFunction(() => window.__fermpal?.ready === true);

test("sans clé ni kDrive : formulaires visibles, écran IA fermé, aucune requête", async () => {
  await page.goto(`${base}/#/app/settings`);
  await ready();
  await expect(page.getByTestId("gemini-key")).toBeVisible();
  await expect(page.getByTestId("kdrive-token")).toBeVisible();
  await expect(page.getByTestId("cloud-backup-now")).toHaveCount(0);
  await page.goto(`${base}/#/app/recipes`);
  await page.getByTestId("recipes-ai").click();
  await expect(page.getByTestId("ai-gate")).toContainText("Clé Gemini nécessaire");
  expect(calls.gemini + calls.kdrive).toBe(0);
});

test("clé Gemini : une clé refusée n'est pas gardée ; la bonne est vérifiée puis gardée (fin affichée), et survit au rechargement", async () => {
  await page.goto(`${base}/#/app/settings`);
  await ready();
  await page.getByTestId("gemini-key").fill("fausse-cle-refusee-000000");
  await page.getByTestId("gemini-save").click();
  await expect(page.getByTestId("toast")).toContainText("Clé Gemini refusée");
  await expect(page.getByTestId("gemini-saved")).toHaveCount(0);
  await page.getByTestId("gemini-key").fill(KEY);
  await page.getByTestId("gemini-save").click();
  await expect(page.getByTestId("gemini-saved")).toContainText("…6789");
  expect(calls.generate).toHaveLength(0); // la vérification ne génère rien
  await page.reload();
  await ready();
  await expect(page.getByTestId("gemini-saved")).toBeVisible();
});

test("recette IA : Gemini appelé en direct avec le stock local, manquants calculés, import dans le carnet + courses", async () => {
  await page.goto(`${base}/#/app/stock`);
  await ready();
  await page.getByPlaceholder("Ingrédient", { exact: true }).fill("Sucre de canne");
  await page.getByTestId("stock-qty").fill("50");
  await page.getByTestId("stock-add").click();
  await expect(page.getByTestId("stock-item")).toHaveCount(1);

  await page.goto(`${base}/#/app/recipes/ai`);
  await expect(page.getByTestId("ai-generate")).toBeVisible();
  await page.getByTestId("ai-generate").click();
  await expect(page.getByTestId("ai-result")).toContainText("Kéfir citron (test)");
  expect(calls.generate).toHaveLength(1);
  expect(calls.generate[0].url).toContain("/v1beta/models/gemini-3-flash-preview:generateContent");
  expect(calls.generate[0].prompt).toContain("Génère une recette de");
  expect(calls.generate[0].prompt).toContain("- Sucre de canne : 50 g");
  expect(calls.generate[0].prompt).not.toContain("undefined");
  expect(calls.generate[0].body.generationConfig.responseMimeType).toBe("application/json");
  // 50 g en stock pour 100 g demandés → « il en manque 50 g » ; citron absent → manquant ; grains = starter.
  await expect(page.getByTestId("ai-result")).toContainText("il en manque 50 g");
  await expect(page.getByTestId("ai-result")).toContainText("manquant");
  await expect(page.getByTestId("ai-import-shopping")).toContainText("2 manquants");

  await page.getByTestId("ai-import-shopping").click();
  // Le toast arrive APRÈS l'écriture des courses ; l'URL seule ne suffit pas
  // (« /app/recipes/ai » ressemble à une fiche recette).
  await expect(page.getByTestId("toast")).toContainText("Recette importée dans ton carnet.");
  await expect(page).toHaveURL(/#\/app\/recipes\/(?!ai$)[a-z0-9-]+$/);
  const recipe = await page.evaluate(() => window.__fermpal.query("select source_type, is_ai_generated, type from recipes where title = 'Kéfir citron (test)'"));
  expect(recipe).toEqual([{ source_type: "ai", is_ai_generated: 1, type: "kefir_eau" }]);
  const shopping = await page.evaluate(() => window.__fermpal.query("select name, amount, unit, source from shopping_list order by name"));
  expect(shopping).toEqual([
    { name: "Citron", amount: 1, unit: "pcs", source: "recipe_ai" },
    { name: "Sucre de canne", amount: 50, unit: "g", source: "recipe_ai" },
  ]);
});

test("kDrive : jeton refusé, puis liaison qui crée Private → FermPal → sauvegardes-app", async () => {
  await page.goto(`${base}/#/app/settings`);
  await ready();
  await page.getByTestId("kdrive-token").fill("mauvais-jeton");
  await page.getByTestId("kdrive-drive-id").fill("42");
  await page.getByTestId("kdrive-connect").click();
  await expect(page.getByTestId("toast")).toContainText("Jeton refusé par Infomaniak");
  await page.getByTestId("kdrive-token").fill(TOKEN);
  await page.getByTestId("kdrive-connect").click();
  await expect(page.getByTestId("cloud-backup-now")).toBeVisible();
  await expect(page.getByTestId("cloud-empty")).toBeVisible();
  const app = [...nodes.values()].find((n) => n.name === "FermPal");
  expect(app?.parent).toBe(5);
  expect(childrenOf(app.id).map((n) => n.name)).toEqual(["sauvegardes-app"]);
});

test("copie : export complet vérifiable envoyé, listé, puis restauration qui remplace le carnet", async () => {
  expect(await page.evaluate(() => window.__fermpal.seed(3))).toBe(3);
  await page.reload();
  await ready();
  const recipes = Number(await page.getByTestId("stats-recipes").textContent());

  await page.getByTestId("cloud-backup-now").click();
  await expect(page.getByTestId("toast")).toContainText(`Copie envoyée (${recipes} recettes)`);
  expect(copies()).toHaveLength(1);
  expect(copies()[0].name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_v\d+_web\.json$/);
  const bundle = JSON.parse(copies()[0].bytes.toString("utf8"));
  expect(bundle.format).toBe(EXPORT_FORMAT);
  expect(bundle.manifest.counts.recipes).toBe(recipes);
  expect(bundle.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(bundle)).not.toContain(KEY);
  expect(JSON.stringify(bundle)).not.toContain(TOKEN);
  await expect(page.getByTestId("cloud-list").locator("> div")).toHaveCount(1);
  await expect(page.getByTestId("cloud-state")).toHaveText("à jour");

  // Le carnet change → l'écran le dit ; la restauration ramène l'état copié.
  expect(await page.evaluate(() => window.__fermpal.seed(2))).toBe(2);
  await page.reload();
  await ready();
  await expect(page.getByTestId("stats-recipes")).toHaveText(String(recipes + 2));
  await expect(page.getByTestId("cloud-state")).toHaveText("changements non sauvegardés");
  await page.getByTestId("cloud-restore").click();
  await expect(page.getByText(/Remplacer le carnet actuel par la copie kDrive du/)).toBeVisible();
  await confirmSheet();
  await expect(page.getByTestId("toast")).toContainText(`Carnet restauré : ${recipes} recettes`);
  await expect(page.getByTestId("stats-recipes")).toHaveText(String(recipes));
  // La restauration a d'abord copié le carnet courant en local (copie de secours).
  await expect(page.getByTestId("backups-list")).toContainText("avant-restauration");
});

test("rétention : au-delà de 10 copies, les plus anciennes sont supprimées après l'envoi ; suppression manuelle", async () => {
  const dir = [...nodes.values()].find((n) => n.name === "sauvegardes-app").id;
  for (let i = 1; i <= 12; i++) {
    const id = nextId++;
    nodes.set(id, { id, name: `2025-01-${String(i).padStart(2, "0")}T00-00-00Z_v2_web.json`, type: "file", parent: dir, bytes: Buffer.from("{}") });
  }
  expect(copies()).toHaveLength(13);
  await page.evaluate(() => window.__fermpal.seed(1));
  await page.reload();
  await ready();
  // Attendre l'état calculé (empreinte) avant d'appuyer : la section est alors stable.
  await expect(page.getByTestId("cloud-state")).toHaveText("changements non sauvegardés");
  await page.getByTestId("cloud-backup-now").click();
  // Le fait, pas le toast (qui s'efface en 2,6 s) : l'envoi puis la purge ont eu lieu.
  await expect.poll(() => copies().length, { timeout: 15_000 }).toBe(10);
  const names = copies().map((n) => n.name).sort();
  expect(names[0]).toContain("2025-01-05T");
  await expect(page.getByTestId("cloud-list").locator("> div")).toHaveCount(10);

  await page.getByTestId("cloud-delete").first().click();
  await expect(page.getByText(/Supprimer la copie du/)).toBeVisible();
  await confirmSheet();
  await expect(page.getByTestId("toast")).toContainText("Copie supprimée.");
  expect(copies()).toHaveLength(9);
  await expect(page.getByTestId("cloud-list").locator("> div")).toHaveCount(9);
});

test("copie automatique : à l'ouverture si le carnet a changé, pas deux fois de suite", async () => {
  await page.getByTestId("cloud-auto").click();
  await expect(page.getByTestId("cloud-auto")).toBeChecked();
  const before = copies().length;
  // Simule le temps écoulé depuis la dernière copie (garde « pas plus d'une toutes les 10 min »).
  await page.evaluate(() => localStorage.removeItem("fermpal.cloud.lastAt"));
  await page.evaluate(() => window.__fermpal.seed(1));
  await page.reload();
  await ready();
  await page.waitForFunction(() => window.__fermpal.lastAutoBackup?.reason && window.__fermpal.lastAutoBackup.reason !== "too_soon", null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__fermpal.lastAutoBackup)).toMatchObject({ done: true, reason: "uploaded" });
  expect(copies().length).toBe(Math.min(10, before + 1));
  await expect(page.getByTestId("cloud-auto-state")).toContainText("copie envoyée");
  await expect(page.getByTestId("cloud-state")).toHaveText("à jour");

  await page.reload();
  await ready();
  await page.waitForFunction(() => window.__fermpal.lastAutoBackup?.reason, null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__fermpal.lastAutoBackup)).toMatchObject({ done: false, reason: "unchanged" });
  await expect(page.getByTestId("cloud-auto-state")).toContainText("rien de nouveau depuis la dernière copie");
});

test("délier le kDrive et retirer la clé : retour aux formulaires, écran IA refermé, copies laissées dans le kDrive", async () => {
  await page.goto(`${base}/#/app/settings`);
  await ready();
  const kept = copies().length;
  await page.getByTestId("kdrive-disconnect").click();
  await confirmSheet();
  await expect(page.getByTestId("kdrive-token")).toBeVisible();
  expect(copies().length).toBe(kept);
  await page.getByTestId("gemini-remove").click();
  await confirmSheet();
  await expect(page.getByTestId("gemini-key")).toBeVisible();
  await page.goto(`${base}/#/app/recipes/ai`);
  await expect(page.getByTestId("ai-gate")).toBeVisible();
});
