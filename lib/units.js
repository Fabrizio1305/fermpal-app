// Unités de mesure : normalisation et conversion.
//
// Aucune dépendance React ni Supabase — logique pure, appelée par la liste de
// courses et la fiche batch. Elle existe parce que trois vocabulaires
// coexistaient sans se parler : le stock accepte du texte libre (`pièce`,
// `gousse`, `càs`…), la liste de courses propose `pcs`, et les recettes (IA ou
// saisie manuelle) écrivent ce qu'elles veulent. Résultat : `pcs` et `pièce`
// désignaient la même chose sans jamais s'apparier, et une recette en `kg` sur
// un stock en `g` retirait 1 au lieu de 1000.
//
// Règle qui gouverne tout le module : quand on ne sait pas convertir, on
// renvoie `null`. L'appelant doit alors ne PAS toucher au stock et le dire à
// l'utilisateur. Un stock silencieusement faux est pire qu'un stock non mis à
// jour : l'utilisateur croit savoir ce qu'il lui reste.

// Synonymes → forme canonique. Les clés sont déjà normalisées (minuscules, sans
// accents) : la normalisation passe avant la table. Les formes qui se terminent
// par « s » sans être des pluriels (`cas`, `pcs`) sont listées explicitement,
// sinon la règle de dépluralisation les mutilerait.
const SYNONYMS = {
  gr: "g",
  gramme: "g",
  gram: "g",
  kilo: "kg",
  kilogramme: "kg",
  milligramme: "mg",
  litre: "l",
  liter: "l",
  millilitre: "ml",
  milliliter: "ml",
  centilitre: "cl",
  decilitre: "dl",
  pc: "piece",
  pcs: "piece",
  unite: "piece",
  cas: "cas",
  cac: "cac",
  "cuillere a soupe": "cas",
  "cuillere a cafe": "cac",
};

// Facteurs vers l'unité de base de chaque famille. Deux familles seulement, et
// elles ne communiquent PAS entre elles.
//
// ⚠️ NE PAS COMPLÉTER CETTE TABLE avec les cuillères (`càs`, `càc`) ni avec des
// densités masse↔volume. C'est délibéré, pas un oubli : 2 càs de sucre ne font
// pas 30 g (ça dépend du sucre, du tassement, de la cuillère), et FermPal donne
// des doses de sucre de F2 — une conversion approximative sur ce sucre-là
// contribue directement à une sur-carbonatation, donc à des bouteilles qui
// explosent. Une unité qu'on ne sait pas convertir doit rester non convertible.
const MASS = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME = { ml: 1, cl: 10, dl: 100, l: 1000 };

// Forme canonique d'une unité : minuscules, sans espaces superflus, sans
// accents, pluriel ramené au singulier, synonymes fusionnés. Une unité inconnue
// est renvoyée normalisée telle quelle — le texte libre du stock doit continuer
// de fonctionner, il n'y a rien à rejeter ici.
export function normalizeUnit(unit) {
  const base = String(unit ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
  if (!base) return "";
  if (SYNONYMS[base]) return SYNONYMS[base];
  const singular = base.length > 1 && base.endsWith("s") ? base.slice(0, -1) : base;
  return SYNONYMS[singular] || singular;
}

// Convertit `amount` de `fromUnit` vers `toUnit`.
// Renvoie null si la conversion est impossible (familles différentes, unité non
// convertible, montant non numérique) — jamais une valeur approchée.
export function convertAmount(amount, fromUnit, toUnit) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  // Identité : couvre aussi les unités dénombrables (pcs → pièce) et les
  // cuillères, qui n'ont aucun facteur mais se comparent à elles-mêmes.
  if (from === to) return value;
  for (const table of [MASS, VOLUME]) {
    if (table[from] && table[to]) return (value * table[from]) / table[to];
  }
  return null;
}

// Pratique pour formuler un message avant d'écrire quoi que ce soit.
export function unitsCompatible(a, b) {
  return convertAmount(1, a, b) !== null;
}

// Arrondi à 2 décimales, celui de toutes les quantités écrites en base. Une
// seule définition : l'audit du 03/09 en comptait trois copies et sept inline.
export const round2 = (n) => Math.round(n * 100) / 100;
