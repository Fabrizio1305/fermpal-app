// Gap analysis d'une recette face au stock (et au jardin) : ce qui manque,
// combien, et pour quelle ligne.
//
// UNE seule règle pour les écrans qui posent la question — l'aperçu de recette
// IA, l'éditeur de recette (voyant rouge/vert par ligne) et le bouton
// « manquants → courses ». Avant, deux copies qui se déclaraient identiques
// divergeaient : sur des unités incompatibles, l'une disait « disponible » et
// l'autre poussait la quantité entière aux courses ; et aucune ne sommait deux
// lignes d'un même ingrédient — 600 g de sucre en F1 + 600 g en F2 face à 1 kg
// en stock donnaient « tout est en stock » (audit du 03/09, §1.2 et lot 1).
//
// Logique pure : aucune dépendance React ni Supabase.
//
// Règles, dans l'ordre où elles s'appliquent à chaque ligne :
//  - jardin : `from_garden` (dit par l'IA, qui sait que les prunes viennent du
//    prunier) ou nom apparié à une plante → ça se cueille, jamais aux courses ;
//  - stock apparié, unités convertibles : le stock est CONSOMMÉ ligne après
//    ligne dans l'ordre de la recette ; la ligne qui fait déborder porte le
//    manque, exprimé dans SON unité ; aux courses, le manque total de
//    l'ingrédient, en une seule ligne ;
//  - stock apparié, unités qui ne se parlent pas (2 càs face à des pièces) : on
//    ne sait pas comparer et on n'invente rien (règle de lib/units.js) —
//    l'utilisateur en a, c'est le principal : disponible, `unverifiable: true` ;
//  - absent du stock : tout est à acheter ; les lignes d'un même nom sont
//    sommées quand leurs unités se parlent, sinon une ligne par unité ;
//  - starter (grains, SCOBY, ginger bug) : son statut est calculé comme les
//    autres (l'éditeur le montre en rouge s'il manque), mais il ne part JAMAIS
//    aux courses — il se réutilise, il ne s'achète pas.
import { findStockItem, normalize } from "@/lib/ingredientMatcher";
import { convertAmount, normalizeUnit, round2 } from "@/lib/units";

/**
 * @param {Array} lines  lignes de recette ({ name, amount, unit, category, is_starter, from_garden? … }),
 *                       dans l'ordre de la recette ; tout champ supplémentaire est conservé
 * @returns {{ lines: Array, shopping: Array }}
 *   lines    : une entrée par ligne d'origine, enrichie de
 *              status      "empty" | "starter-less"… non : "garden" | "in_stock" | "short" | "missing" | "empty"
 *              stockItem   ligne de stock appariée (ou null), via ("exact"|"alias"|"fuzzy")
 *              gardenItem  plante appariée (ou { name }) quand ça se cueille
 *              shortfall   manque de CETTE ligne dans son unité (statut "short" uniquement)
 *              unverifiable true quand le stock existe mais que les unités ne se comparent pas
 *   shopping : ce qu'il faut acheter, une ligne par ingrédient ({ name, amount, unit, category }),
 *              starters exclus, quantités sommées
 */
export function analyzeRecipeNeeds(lines, { stock = [], aliases = [], garden = [] } = {}) {
  // Stock encore disponible après les lignes déjà servies (unité du stock).
  const remaining = new Map();
  const shopping = new Map();
  const out = [];

  for (const line of lines || []) {
    const name = String(line.name ?? "").trim();
    const amount = Number(line.amount) || 0;
    const base = { ...line, stockItem: null, via: null, gardenItem: null, shortfall: null, unverifiable: false };

    if (!name) {
      out.push({ ...base, status: "empty" });
      continue;
    }

    const { item, via } = findStockItem(name, stock, aliases);

    if (!item) {
      const plant = garden.length > 0 ? findStockItem(name, garden, aliases).item : null;
      if (line.from_garden || plant) {
        out.push({ ...base, gardenItem: plant || { name }, status: "garden" });
        continue;
      }
      out.push({ ...base, status: "missing" });
      if (!line.is_starter) addToShopping(shopping, `name:${normalize(name)}`, { name, unit: line.unit, category: line.category, amount });
      continue;
    }

    const needed = convertAmount(amount, line.unit, item.unit);
    if (needed == null) {
      out.push({ ...base, stockItem: item, via, unverifiable: true, status: "in_stock" });
      continue;
    }

    const left = remaining.has(item.id) ? remaining.get(item.id) : Number(item.quantity) || 0;
    const lacking = needed - left;
    remaining.set(item.id, Math.max(0, left - needed));
    if (lacking <= 0) {
      out.push({ ...base, stockItem: item, via, status: "in_stock" });
      continue;
    }

    // Le manque est réexprimé dans l'unité de la RECETTE : « il te manque
    // 250 g » parle plus que le reliquat dans l'unité du stock.
    const inLineUnit = convertAmount(lacking, item.unit, line.unit);
    const shortfall = inLineUnit == null ? amount : round2(inLineUnit);
    out.push({ ...base, stockItem: item, via, shortfall, status: "short" });
    if (!line.is_starter) addToShopping(shopping, `stock:${item.id}`, { name, unit: line.unit, category: line.category, amount: shortfall });
  }

  return {
    lines: out,
    shopping: [...shopping.values()].map((r) => ({ ...r, amount: round2(r.amount) })),
  };
}

// Une ligne de courses par ingrédient : les manques successifs d'un même
// ingrédient s'additionnent quand leurs unités se parlent (600 g + 0,2 kg),
// sinon une ligne par famille d'unités (2 càs + 100 g).
function addToShopping(map, baseKey, { name, unit, category, amount }) {
  if (!(amount > 0)) return;
  for (const [key, prev] of map) {
    if (!key.startsWith(`${baseKey}@`)) continue;
    const converted = convertAmount(amount, unit, prev.unit);
    if (converted != null) {
      prev.amount += converted;
      return;
    }
  }
  map.set(`${baseKey}@${normalizeUnit(unit)}`, { name, unit, category: category || "autre", amount });
}
