// Contexte local pour la génération IA (app Android, lot L4) : le carnet vit
// sur le téléphone, le serveur ne connaît pas ce stock. L'app l'envoie dans le
// corps de la requête ; tout est borné et revalidé ici avant d'entrer dans le
// prompt (cadrage §7 : « contexte local borné transmis et revalidé serveur »).
import { RECIPE_TYPES } from "@/lib/recipeTypes";
import { CATEGORIES } from "@/lib/ingredientCategories";

// Mêmes bornes que la lecture en base côté site (route generate : 300 lignes).
export const MAX_CONTEXT_STOCK = 300;
const MAX_NAME = 80;
const MAX_UNIT = 12;

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function stockRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = cleanText(raw.name, MAX_NAME);
  const quantity = Number(raw.quantity);
  if (!name || !Number.isFinite(quantity) || quantity < 0) return null;
  const unit = cleanText(raw.unit, MAX_UNIT) || "g";
  const category = typeof raw.category === "string" && Object.hasOwn(CATEGORIES, raw.category) ? raw.category : "autre";
  const expiry_date = typeof raw.expiry_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.expiry_date) ? raw.expiry_date : null;
  return { name, quantity, unit, category, expiry_date };
}

// null si aucun contexte exploitable n'est fourni (le serveur lit alors la
// base, comme pour le site) ; sinon { stock, knownTypes } assainis.
export function normalizeLocalContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stock = Array.isArray(raw.stock) ? raw.stock.slice(0, MAX_CONTEXT_STOCK).map(stockRow).filter(Boolean) : [];
  const knownTypes = Array.isArray(raw.knownTypes)
    ? [...new Set(raw.knownTypes.filter((t) => typeof t === "string" && Object.hasOwn(RECIPE_TYPES, t)))]
    : [];
  return { stock, knownTypes };
}
