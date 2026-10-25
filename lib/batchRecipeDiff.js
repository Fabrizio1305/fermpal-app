// Comparaison d'un batch avec la recette dont il est issu, et conversion des
// ingrédients du batch en lignes de recette.
//
// Aucune dépendance React ni Supabase : logique pure, testable, appelée par
// app/app/batches/[id]/page.jsx.
//
// LE PIÈGE : les quantités d'un batch sont mises à l'échelle de son volume.
// Une recette de référence 1 L brassée en 2 L a toutes ses quantités doublées
// (voir `updateVolume` sur la fiche batch). Comparer les nombres bruts ferait
// donc croire à une divergence sur chaque batch de volume différent, et
// « sauver dans la recette » doublerait silencieusement la recette. Tout passe
// par `ratio` : batch = recette × ratio.

import { convertAmount, normalizeUnit, round2 } from "@/lib/units";

// Le rééchelonnage arrondit à 2 décimales et peut se composer (volume changé
// plusieurs fois) : on ne compare donc jamais à l'égalité stricte.
function sameAmount(a, b) {
  const tolerance = Math.max(0.02, Math.abs(b) * 0.01);
  return Math.abs(a - b) <= tolerance;
}

// Un ingrédient est identifié par son nom (insensible à la casse) ET sa phase :
// le même sucre peut apparaître en F1 et en F2 avec des quantités distinctes.
function keyOf(row) {
  return `${(row.name || "").trim().toLowerCase()}@@${row.phase_id || ""}`;
}

// ratio = volume réellement brassé / volume de référence de la recette.
// 1 si l'un des deux manque : on ne devine pas.
export function scaleRatio(batchVolume, recipeBatchSizeRef) {
  const v = Number(batchVolume);
  const ref = Number(recipeBatchSizeRef);
  if (!Number.isFinite(v) || !Number.isFinite(ref) || v <= 0 || ref <= 0) return 1;
  return v / ref;
}

// Compare les ingrédients du batch à ceux de la recette, à l'échelle.
// Renvoie added / modified / removed, et `hasChanges`.
export function diffBatchFromRecipe(batchIngredients = [], recipeIngredients = [], ratio = 1) {
  const recipeByKey = new Map(recipeIngredients.map((r) => [keyOf(r), r]));
  const batchByKey = new Map(batchIngredients.map((b) => [keyOf(b), b]));

  const added = [];
  const modified = [];

  for (const bi of batchIngredients) {
    const ri = recipeByKey.get(keyOf(bi));
    if (!ri) {
      added.push(bi);
      continue;
    }
    const expected = round2(Number(ri.amount) * ratio);
    // Les deux quantités sont ramenées à l'unité de la RECETTE avant d'être
    // comparées. Sans ça, la comparaison se faisait sur les chaînes d'unités et
    // sur des nombres bruts : passer un ingrédient de « 1000 g » à « 1 kg »
    // déclenchait le bandeau de divergence alors que rien n'a changé dans le
    // bocal, et « g » vs « gr » aussi.
    const converted = convertAmount(bi.amount, bi.unit, ri.unit);
    // Un vrai changement d'unité, c'est une unité qu'on ne sait PAS convertir
    // (càs vs g) : là, les quantités ne sont plus comparables et il faut le
    // signaler. Une unité convertible n'est qu'une autre façon d'écrire la
    // même chose.
    const unitChanged = converted == null && normalizeUnit(bi.unit) !== normalizeUnit(ri.unit);
    const amountChanged = converted != null
      ? !sameAmount(converted, expected)
      : !sameAmount(Number(bi.amount), expected);
    const starterChanged = Boolean(bi.is_starter) !== Boolean(ri.is_starter);
    if (amountChanged || unitChanged || starterChanged) {
      // Les drapeaux servent au résumé : sans eux, un simple changement d'unité
      // s'afficherait « 10 → 10 g », ce qui ne veut rien dire.
      modified.push({ batch: bi, recipe: ri, expected, amountChanged, unitChanged, starterChanged });
    }
  }

  const removed = recipeIngredients.filter((ri) => !batchByKey.has(keyOf(ri)));

  return { added, modified, removed, hasChanges: added.length > 0 || modified.length > 0 || removed.length > 0 };
}

// Convertit les ingrédients du batch en lignes `recipe_ingredients`.
//
// `ratio` : diviseur appliqué aux quantités. Pour une nouvelle VERSION de la
//   recette existante on repasse au volume de référence (ratio réel), sinon la
//   recette de 1 L deviendrait une recette de 2 L à l'insu de l'utilisateur.
//   Pour une NOUVELLE recette on garde 1 : elle décrit ce qui a été brassé,
//   avec `batch_size_ref` = volume du batch.
//
// `phaseIdMap` : les phases d'une nouvelle recette ont de nouveaux ids. Absent
//   ou identité pour une nouvelle version (les phases ne sont pas touchées).
//
// Les champs que le batch ne porte pas (sub_type, alpha_acid_pct, timing) sont
// repris de la ligne de recette correspondante quand elle existe : les éditer
// depuis un batch n'est pas possible, les perdre serait une régression.
export function toRecipeRows(batchIngredients = [], recipeIngredients = [], { recipeId, ratio = 1, phaseIdMap = null } = {}) {
  const recipeByKey = new Map(recipeIngredients.map((r) => [keyOf(r), r]));
  const divisor = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

  return batchIngredients.map((bi, i) => {
    const ri = recipeByKey.get(keyOf(bi));
    const phaseId = phaseIdMap ? phaseIdMap[bi.phase_id] ?? null : bi.phase_id ?? null;
    return {
      recipe_id: recipeId,
      phase_id: phaseId,
      category: bi.category || "autre",
      name: (bi.name || "").trim(),
      amount: round2(Number(bi.amount) / divisor),
      unit: bi.unit || "g",
      sub_type: ri?.sub_type ?? null,
      alpha_acid_pct: ri?.alpha_acid_pct ?? null,
      timing: ri?.timing ?? null,
      sort_order: i,
      is_starter: Boolean(bi.is_starter),
    };
  });
}
