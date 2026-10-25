// Recette IA en direct : l'app appelle Gemini avec la clé de l'utilisateur,
// gardée sur le téléphone seulement (jamais dans les exports ni les copies
// kDrive). Pas de serveur, de compte ni de quota : schéma, consignes, prompt et
// nettoyage de la réponse vivent dans lib/recipeAi.js.
// Gemini accepte les appels de l'app (CORS ouvert). Même schéma que MyGarden.
import { normalizeLocalContext } from "@/lib/aiContext";
import { buildRecipePrompt, buildSystem, normalizeRecipe, parseRecipeRequest } from "@/lib/recipeAi";

const KEY = "fermpal.gemini.key";
export const GEMINI_HOST = "https://generativelanguage.googleapis.com";
export const KEY_PAGE = "https://aistudio.google.com/apikey";
// Mêmes modèles que le site (lib/llm.js) : le second si le premier est indisponible.
export const MODELS = [
  { name: "gemini-3-flash-preview", timeoutMs: 45_000 },
  { name: "gemini-3.1-flash-lite", timeoutMs: 30_000 },
];

export function geminiKey() {
  try {
    return globalThis.localStorage?.getItem(KEY) || "";
  } catch {
    return "";
  }
}
export const hasGeminiKey = () => !!geminiKey();
export function setGeminiKey(key) {
  try {
    if (key) globalThis.localStorage?.setItem(KEY, key.trim());
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* non mémorisée */
  }
}

const fail = (code, extra) => Object.assign(new Error(code), { code, ...extra });

// Corps de la requête Gemini (pur, testé). Réflexion complète, comme le Pro du site.
export function geminiBody({ system, prompt, schema }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 4096, temperature: 0.7 },
  };
}

async function call({ name, timeoutMs }, key, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${GEMINI_HOST}/v1beta/models/${name}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Délai dépassé : le modèle suivant est essayé ; pas de réseau : on s'arrête.
    throw e?.name === "TimeoutError" ? fail("ai_failed", { status: 504 }) : fail("network");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 400 && /api key/i.test(data?.error?.message || "")) throw fail("bad_key");
  if (res.status === 401 || res.status === 403) throw fail("bad_key");
  if (res.status === 429) throw fail("quota_exceeded");
  if (!res.ok) throw fail("ai_failed", { status: res.status });
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  try {
    return JSON.parse(text);
  } catch {
    throw fail("ai_failed", { status: 502 });
  }
}

// Vérifie une clé sans rien consommer (fiche du modèle) ; lève bad_key, network ou ai_failed.
export async function checkGeminiKey(key, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${GEMINI_HOST}/v1beta/models/${MODELS[0].name}`, { headers: { "x-goog-api-key": String(key || "").trim() } });
  } catch {
    throw fail("network");
  }
  if (res.ok) return true;
  const data = await res.json().catch(() => ({}));
  if ([400, 401, 403].includes(res.status) && (res.status !== 400 || /api key/i.test(data?.error?.message || ""))) throw fail("bad_key");
  throw fail("ai_failed", { status: res.status });
}

// Corps de l'écran IA (type, volume, mode… + contexte local) → { recipe } ;
// erreurs : no_key, invalid_type, empty_stock, bad_key, quota_exceeded, network, ai_failed.
export async function generateRecipe(payload, { key = geminiKey(), fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  if (!key) throw fail("no_key");
  const req = parseRecipeRequest(payload);
  if (req.error) throw fail(req.error);
  const local = normalizeLocalContext(payload.context) || { stock: [], knownTypes: [] };
  const built = buildRecipePrompt(req, {
    stockRows: req.mode === "stock" ? local.stock.filter((s) => s.quantity > 0) : null,
    knownTypes: req.surprise ? local.knownTypes : [],
    now,
  });
  if (built.error) throw fail(built.error);
  const body = geminiBody({ system: buildSystem(req.lang), prompt: built.prompt, schema: built.schema });
  let lastError;
  for (const model of MODELS) {
    try {
      const raw = await call(model, key, body, fetchImpl);
      return { recipe: normalizeRecipe(raw, req), model: model.name };
    } catch (e) {
      // Clé refusée, quota Google ou pas de réseau : inutile d'essayer l'autre modèle.
      if (e.code && e.code !== "ai_failed") throw e;
      lastError = e.code ? e : fail("ai_failed");
    }
  }
  throw lastError;
}
