// Fermentation ingredient categories (kefir, kombucha, simplified beer).
// Libellés dans lib/i18n (clés `categories.<id sans accent>`), via categoryLabel().
import { t } from "./i18n/index.js";

export const CATEGORIES = {
  sucre: { icon: "🍯" },
  fruit: { icon: "🍓" },
  plante: { icon: "🌿" },
  "thé": { icon: "🍵" },
  grain: { icon: "🌾" },
  houblon: { icon: "🌼" },
  levure: { icon: "🧫" },
  autre: { icon: "📦" },
};

// Libellé d'une catégorie dans la langue donnée (repli : l'identifiant).
export function categoryLabel(categoryId, lang) {
  if (!(categoryId in CATEGORIES)) return String(categoryId ?? "");
  const key = String(categoryId).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t(`categories.${key}`, null, lang);
}

// Icône par INGRÉDIENT, en complément de celle de sa catégorie.
//
// Le problème : l'icône n'existait qu'au niveau de la catégorie, donc citron,
// mûre et pomme s'affichaient tous avec 🍓 (retour d'usage du 30/07 — « ça fait
// bizarre d'avoir le citron avec l'icône de la fraise »). Aucune icône unique
// ne peut représenter « fruit » ; on nomme donc les ingrédients courants de la
// fermentation maison, et on retombe sur la catégorie pour tout le reste.
//
// Clés en minuscules SANS accents : la recherche normalise avant de comparer,
// et elle se fait par inclusion — « jus de citron » et « citrons bio » trouvent
// « citron ». Les clés longues sont testées en premier pour que « citron vert »
// gagne sur « citron ».
const INGREDIENT_ICONS = {
  // Fruits
  citron: "🍋", lime: "🍋‍🟩", "citron vert": "🍋‍🟩", orange: "🍊", mandarine: "🍊",
  pamplemousse: "🍊", pomme: "🍎", poire: "🍐", raisin: "🍇", fraise: "🍓",
  framboise: "🍓", mure: "🫐", myrtille: "🫐", cassis: "🫐", cerise: "🍒",
  peche: "🍑", abricot: "🍑", ananas: "🍍", mangue: "🥭", banane: "🍌",
  pasteque: "🍉", melon: "🍈", kiwi: "🥝", noix: "🌰", datte: "🌴",
  figue: "🫒", grenade: "🍎", coing: "🍐", rhubarbe: "🌱", sureau: "🫐",
  // Racines, légumes, épices
  gingembre: "🫚", curcuma: "🫚", betterave: "🥬", carotte: "🥕", concombre: "🥒",
  piment: "🌶️", ail: "🧄", oignon: "🧅", cannelle: "🪵", vanille: "🌿",
  clou: "🌰", cardamome: "🌿", anis: "🌿", poivre: "🌶️",
  // Sucres et liquides
  miel: "🍯", sirop: "🍯", "sucre roux": "🟤", cassonade: "🟤", eau: "💧",
  lait: "🥛", the: "🍵", cafe: "☕", jus: "🧃", sel: "🧂",
  // Cultures
  kefir: "🧫", scoby: "🧫", levain: "🧫", "ginger bug": "🫚",
};

// Icône la plus précise disponible pour un ingrédient : la sienne si on la
// connaît, sinon celle de sa catégorie, sinon rien.
export function ingredientIcon(name, category) {
  const n = String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (n) {
    // Plus longue clé d'abord : « citron vert » avant « citron ».
    const keys = Object.keys(INGREDIENT_ICONS).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (n.includes(k)) return INGREDIENT_ICONS[k];
    }
  }
  return CATEGORIES[category]?.icon ?? "";
}

// Nombre de jours (entier) entre aujourd'hui et une date "YYYY-MM-DD".
// null si pas de date. Négatif/0 = expiré.
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}
