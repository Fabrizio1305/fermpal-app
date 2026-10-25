// Services de l'app en usage personnel (23/10), sans réseau : prompt et
// nettoyage de la recette IA (lib/recipeAi.js, partagé avec le site), appel
// direct à Gemini (faux fetch) et kDrive (fausse API Infomaniak).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecipePrompt, normalizeRecipe, parseRecipeRequest } from "../lib/recipeAi.js";
import { MODELS, checkGeminiKey, generateRecipe } from "../mobile/src/platform/gemini.js";
import { kdriveRemote, setupKdrive } from "../mobile/src/platform/kdrive.js";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const RAW = {
  title: "Kéfir citron",
  instructions: "Dissoudre le sucre.",
  phases: [{ name: "F1", duration_value: 2, duration_unit: "jours" }, { name: "F2", duration_unit: "semaines" }],
  ingredients: [
    { phase_index: 0, category: "sucre", name: "Sucre de canne", amount: 100, unit: "g", is_starter: false },
    { phase_index: 9, category: "inconnue", name: "Citron", amount: 1, unit: "pièce", is_starter: false, from_garden: true },
    { phase_index: 0, category: "sucre", name: "", amount: 5, unit: "g" },
  ],
};

test("parseRecipeRequest : type obligatoire hors surprise, bornes du volume, volume libre en surprise", () => {
  assert.deepEqual(parseRecipeRequest({ type: "constructor" }), { error: "invalid_type" });
  assert.equal(parseRecipeRequest({ type: "kefir_eau", volume: 500 }).volume, 50);
  const s = parseRecipeRequest({ surprise: true, volume: null, mode: "free" });
  assert.equal(s.autoVolume, true);
  assert.equal(s.mode, "stock", "la surprise part toujours du stock");
});

test("buildRecipePrompt : stock dans le prompt, surprise sans stock refusée avant tout appel", () => {
  const req = parseRecipeRequest({ type: "kefir_eau", volume: 2, mode: "stock", lang: "fr" });
  const { prompt, schema } = buildRecipePrompt(req, { stockRows: [{ name: "Sucre de canne", quantity: 50, unit: "g", category: "sucre" }] });
  assert.match(prompt, /STOCK DISPONIBLE/);
  assert.match(prompt, /- Sucre de canne : 50 g \[sucre\]/);
  // Modèle de phases avec les noms traduits (régression du 21/09 : « undefined »).
  assert.match(prompt, /1\. Fermentation primaire/);
  assert.doesNotMatch(prompt, /undefined/);
  assert.ok(schema.properties.ingredients);
  const surprise = parseRecipeRequest({ surprise: true });
  assert.deepEqual(buildRecipePrompt(surprise, { stockRows: [{ name: "Sucre", quantity: 1, unit: "kg", category: "sucre" }] }), { error: "empty_stock" });
});

test("normalizeRecipe : bornes, catégorie et unité par défaut, lignes vides retirées, pas de jardin inventé", () => {
  const r = normalizeRecipe(RAW, parseRecipeRequest({ type: "kefir_eau", volume: 2 }));
  assert.equal(r.phases[1].duration_unit, "jours");
  assert.equal(r.ingredients.length, 2);
  assert.deepEqual(r.ingredients[1], { phase_index: 1, category: "autre", name: "Citron", amount: 1, unit: "g", is_starter: false, from_garden: false });
  assert.throws(() => normalizeRecipe({ phases: [], ingredients: [] }, parseRecipeRequest({ type: "kefir_eau" })), /sans phases/);
});

// Faux fetch : enregistre les appels, répond selon `plan` (un statut par appel).
function fakeFetch(plan) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const step = plan[calls.length - 1] ?? plan.at(-1);
    const body = step.status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(RAW) }] } }] } : { error: { message: step.message || "erreur" } };
    return { ok: step.status === 200, status: step.status, json: async () => body };
  };
  return { impl, calls };
}

const PAYLOAD = { type: "kefir_eau", volume: 2, mode: "stock", lang: "fr", context: { stock: [{ name: "Sucre de canne", quantity: 50, unit: "g", category: "sucre" }], knownTypes: [] } };

test("generateRecipe : sans clé → no_key, aucune requête", async () => {
  const f = fakeFetch([{ status: 200 }]);
  await assert.rejects(generateRecipe(PAYLOAD, { key: "", fetchImpl: f.impl }), { code: "no_key" });
  assert.equal(f.calls.length, 0);
});

test("generateRecipe : appelle Gemini avec la clé en en-tête, le stock local dans le prompt, et nettoie la réponse", async () => {
  const f = fakeFetch([{ status: 200 }]);
  const { recipe, model } = await generateRecipe(PAYLOAD, { key: "fausse-cle-test", fetchImpl: f.impl });
  assert.equal(f.calls.length, 1);
  assert.equal(model, MODELS[0].name);
  assert.match(f.calls[0].url, new RegExp(`/v1beta/models/${MODELS[0].name}:generateContent$`));
  assert.equal(f.calls[0].init.headers["x-goog-api-key"], "fausse-cle-test");
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.match(body.contents[0].parts[0].text, /Sucre de canne : 50 g/);
  assert.equal(recipe.title, "Kéfir citron");
  assert.equal(recipe.ingredients.length, 2);
});

test("generateRecipe : modèle principal indisponible → repli ; clé refusée ou quota → arrêt immédiat", async () => {
  const fallback = fakeFetch([{ status: 503 }, { status: 200 }]);
  assert.equal((await generateRecipe(PAYLOAD, { key: "k", fetchImpl: fallback.impl })).model, MODELS[1].name);
  const badKey = fakeFetch([{ status: 400, message: "API key not valid. Please pass a valid API key." }]);
  await assert.rejects(generateRecipe(PAYLOAD, { key: "k", fetchImpl: badKey.impl }), { code: "bad_key" });
  assert.equal(badKey.calls.length, 1);
  const quota = fakeFetch([{ status: 429 }]);
  await assert.rejects(generateRecipe(PAYLOAD, { key: "k", fetchImpl: quota.impl }), { code: "quota_exceeded" });
  assert.equal(quota.calls.length, 1);
  const surprise = fakeFetch([{ status: 200 }]);
  await assert.rejects(generateRecipe({ surprise: true, context: { stock: [] } }, { key: "k", fetchImpl: surprise.impl }), { code: "empty_stock" });
  assert.equal(surprise.calls.length, 0);
});

test("checkGeminiKey : fiche du modèle lue sans rien générer", async () => {
  const ok = fakeFetch([{ status: 200 }]);
  assert.equal(await checkGeminiKey(" fausse-cle ", { fetchImpl: ok.impl }), true);
  assert.equal(ok.calls[0].init.headers["x-goog-api-key"], "fausse-cle");
  assert.doesNotMatch(ok.calls[0].url, /generateContent/);
  await assert.rejects(checkGeminiKey("x", { fetchImpl: fakeFetch([{ status: 403 }]).impl }), { code: "bad_key" });
});

// Fausse API kDrive : racine 1, espace privé 5, fichiers en mémoire.
function fakeKdrive(token = "tok") {
  const nodes = new Map([
    [1, { id: 1, name: "", type: "dir", parent: 0 }],
    [5, { id: 5, name: "Private", type: "dir", parent: 1, visibility: "is_private_space" }],
  ]);
  let nextId = 100;
  const log = [];
  const request = async ({ method, url, headers, body, responseType }) => {
    const u = new URL(url);
    log.push(`${method} ${u.pathname}`);
    if (headers.Authorization !== `Bearer ${token}`) return { status: 401, data: { result: "error", error: { code: "not_authorized" } } };
    const ok = (data, extra = {}) => ({ status: 200, data: { result: "success", data, ...extra } });
    let g;
    if (method === "GET" && (g = /^\/3\/drive\/42\/files\/(\d+)\/files$/.exec(u.pathname))) {
      return ok([...nodes.values()].filter((n) => n.parent === Number(g[1])).map(({ bytes, ...n }) => ({ ...n, size: bytes?.length })), { has_more: false });
    }
    if (method === "POST" && (g = /^\/3\/drive\/42\/files\/(\d+)\/directory$/.exec(u.pathname))) {
      const id = nextId++;
      nodes.set(id, { id, name: body.name, type: "dir", parent: Number(g[1]) });
      return ok({ id });
    }
    if (method === "POST" && u.pathname === "/3/drive/42/upload") {
      const id = nextId++;
      nodes.set(id, { id, name: u.searchParams.get("file_name"), type: "file", parent: Number(u.searchParams.get("directory_id")), bytes: body });
      return ok({ id });
    }
    if (method === "GET" && (g = /^\/2\/drive\/42\/files\/(\d+)\/download$/.exec(u.pathname))) {
      assert.equal(responseType, "bytes");
      return { status: 200, data: nodes.get(Number(g[1])).bytes };
    }
    if (method === "DELETE" && (g = /^\/2\/drive\/42\/files\/(\d+)$/.exec(u.pathname))) {
      nodes.delete(Number(g[1]));
      return ok(true);
    }
    return { status: 500, data: { result: "error", error: { code: "route_absente" } } };
  };
  return { request, nodes, log };
}

test("setupKdrive : jeton vérifié, « FermPal/sauvegardes-app » créé dans l'espace privé, puis retrouvé", async () => {
  store.clear();
  const k = fakeKdrive();
  await assert.rejects(setupKdrive({ token: "", driveId: "42" }, { request: k.request }), { code: "bad_config" });
  await assert.rejects(setupKdrive({ token: "faux", driveId: "42" }, { request: k.request }), { code: "bad_token" });
  const folder = await setupKdrive({ token: "tok", driveId: "42" }, { request: k.request });
  const dir = k.nodes.get(folder);
  assert.equal(dir.name, "sauvegardes-app");
  assert.equal(k.nodes.get(dir.parent).name, "FermPal");
  assert.equal(k.nodes.get(dir.parent).parent, 5);
  // Seconde liaison : mêmes dossiers, rien de recréé.
  assert.equal(await setupKdrive({ token: "tok", driveId: "42" }, { request: k.request }), folder);
  assert.equal([...k.nodes.values()].filter((n) => n.type === "dir").length, 4);
});

test("kdriveRemote : envoi en octets, liste, téléchargement, suppression", async () => {
  const k = fakeKdrive();
  const folder = await setupKdrive({ token: "tok", driveId: "42" }, { request: k.request });
  const remote = kdriveRemote({ request: k.request, config: { token: "tok", driveId: "42", folder } });
  const bytes = new TextEncoder().encode('{"a":1}');
  await remote.upload("copie.json", bytes);
  assert.deepEqual(await remote.list(), [{ name: "copie.json", size: bytes.length }]);
  assert.deepEqual(await remote.download("copie.json"), bytes);
  await remote.remove(["copie.json"]);
  assert.deepEqual(await remote.list(), []);
  assert.throws(() => kdriveRemote({ config: null }), { code: "not_configured" });
});
