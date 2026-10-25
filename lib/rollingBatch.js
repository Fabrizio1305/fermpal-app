// Brassins en chaîne (« rolling batch ») : démarrer un brassin avec une partie
// du précédent.
//
// Logique pure — aucune dépendance React ni Supabase. Elle est partagée entre
// plusieurs appelants qui doivent dire exactement la même chose : le formulaire
// de création, qui ANNONCE l'eau à ajouter avant de valider ; createBatchForRecipe,
// qui l'APPLIQUE au snapshot d'ingrédients du batch ; la fiche batch, qui compare
// le brassin à sa recette (withoutStarterAdjustment) et le rééchelonne
// (rescaleAmounts) sans jamais toucher au démarreur.
//
// La règle métier, celle qu'on se trompe une fois sur deux : le démarreur
// remplace de l'EAU, et rien d'autre. Le sucre, le thé, les fruits restent
// calculés sur le volume CIBLE — c'est tout le liquide qui fermente, démarreur
// compris. Retrancher le démarreur du sucre affamerait la culture.
import { normalize } from "@/lib/ingredientMatcher";
import { convertAmount, round2 } from "@/lib/units";

// Ce qui compte comme eau de dilution. `normalize` a déjà retiré accents,
// ponctuation et mots-outils (« eau de source » → « eau source »).
const WATER_HEADS = new Set(["eau", "water"]);

// … et ce qui n'en est pas, malgré le mot « eau ». Une eau-de-vie ou une eau de
// coco sont des ingrédients à part entière : en retrancher parce qu'on réutilise
// du kombucha serait faux, et silencieusement.
const NOT_DILUTION = /\b(vie|coco|coconut|rose|fleur|flower|oranger|blossom|mer|sea|gaz|sparkling)\b/;

export function isDilutionWater(name, unit) {
  const n = normalize(String(name ?? ""));
  if (!n) return false;
  if (!WATER_HEADS.has(n.split(" ")[0])) return false;
  if (NOT_DILUTION.test(n)) return false;
  // Une « eau » comptée en pièces ou en cuillères n'est pas un volume qu'on
  // peut réduire de 0,5 L. Règle de lib/units.js : pas de conversion inventée.
  return convertAmount(1, unit, "l") != null;
}

// La ligne d'eau qui absorbe le démarreur : la plus grosse eau de dilution du
// jeu de lignes. Une recette peut lister plusieurs eaux (celle du thé, celle de
// dilution) ; seule la plus grosse peut encaisser 0,5 L sans passer sous zéro.
// `minLitres` : plancher EXCLUSIF — 0 pour ignorer une eau déjà à zéro quand on
// cherche où retrancher, -1 pour la retrouver quand on cherche où rajouter.
export function dilutionWaterTarget(rows, minLitres = -1) {
  let target = null;
  let targetLitres = minLitres;
  for (const r of rows || []) {
    if (!isDilutionWater(r.name, r.unit)) continue;
    const litres = convertAmount(r.amount, r.unit, "l");
    if (litres == null || litres <= targetLitres) continue;
    target = r;
    targetLitres = litres;
  }
  return target;
}

// La ligne de démarreur d'un brassin en chaîne se reconnaît à `is_starter` ET à
// SON VOLUME (égal à `starter_volume`, à 5 ml près) — jamais à son libellé, qui
// dépend de la langue active au moment de la création. Et une recette peut
// déclarer son propre ferment (grains de kéfir, en grammes) : lui n'est pas le
// démarreur repris du bocal, il reste une ligne de recette ordinaire.
// Règle unique : la comparaison à la recette, le rééchelonnage et la séparation
// en lots passent tous par ici.
export function isRollingStarterRow(row, starterVolume) {
  const volume = Number(starterVolume);
  if (!row?.is_starter || !Number.isFinite(volume) || volume <= 0) return false;
  const litres = convertAmount(row.amount, row.unit, "l");
  // Remove binary floating-point noise at the exact 5 ml boundary.
  return litres != null && Number(Math.abs(litres - volume).toFixed(12)) < 0.005;
}

// Le démarreur ne se verse jamais dans une phase de préparation à chaud : sur un
// kombucha, la phase « Préparation du thé » est à 95 °C et tuerait la culture.
// On vise donc la fermentation primaire, et on retombe sur la phase de l'eau
// (celle où l'on constitue le liquide) si la recette ne la nomme pas ainsi.
const PRIMARY_PHASE = /\bf1\b|primar|primaire/i;

export function starterPhaseId(phases, fallbackPhaseId = null) {
  const primary = (phases || []).find((p) => PRIMARY_PHASE.test(p?.name || ""));
  if (primary) return primary.id;
  if (fallbackPhaseId) return fallbackPhaseId;
  return phases?.[0]?.id ?? null;
}

/**
 * Applique le démarreur au snapshot d'ingrédients d'un batch.
 *
 * @param {Array}  rows          lignes déjà mises à l'échelle du volume cible
 *                               ({ phase_id, category, name, amount, unit, is_starter })
 * @param {number} starterVolume litres repris du brassin précédent
 * @param {string} starterName   libellé de la ligne créée
 * @param {string} phaseId       phase où verser le démarreur
 * @returns {{ rows: Array, water: {name, unit, before, after}|null }}
 *          `water` = null quand la recette ne liste pas d'eau : il n'y a alors
 *          rien à retrancher, mais le démarreur est ajouté quand même.
 */
export function applyStarterToRows(rows, { starterVolume, starterName, phaseId = null }) {
  const volume = Number(starterVolume);
  const out = (rows || []).map((r) => ({ ...r }));
  if (!Number.isFinite(volume) || volume <= 0) return { rows: out, water: null };

  const target = dilutionWaterTarget(out, 0);

  let water = null;
  if (target) {
    const before = Number(target.amount);
    // Non nul par construction : isDilutionWater a déjà validé la famille.
    const cut = convertAmount(volume, "l", target.unit);
    // Plancher à 0 plutôt qu'un négatif : reprendre plus de liquide que la
    // recette n'a d'eau est physiquement possible (un brassin presque entier
    // relancé), ça veut simplement dire qu'il n'y a plus d'eau à ajouter.
    const after = Math.max(0, round2(before - cut));
    target.amount = after;
    water = { name: target.name, unit: target.unit, before, after };
  }

  out.push({
    phase_id: phaseId,
    category: "levure",
    name: starterName,
    amount: round2(volume),
    unit: "L",
    // C'est ce drapeau qui empêche le démarreur d'être déstocké ou mis sur la
    // liste de courses : il ne s'achète pas, il vient du bocal d'à côté.
    is_starter: true,
  });

  return { rows: out, water };
}

/**
 * L'inverse d'applyStarterToRows : le brassin tel qu'il aurait été SANS
 * démarreur. C'est cette version-là qu'on compare à la recette et qu'on lui
 * réécrit.
 *
 * Sans ça, tout brassin en chaîne s'annonce « différent de sa recette » (bien
 * sûr : on vient de lui retirer 0,5 L d'eau), et un clic sur « enregistrer dans
 * la recette » y grave 1,5 L d'eau plus une ligne de démarreur — une recette
 * qui ne tient plus debout hors chaîne, et qu'on ne peut pas mettre sur une
 * liste de courses.
 */
export function withoutStarterAdjustment(rows, starterVolume) {
  const volume = Number(starterVolume);
  if (!Number.isFinite(volume) || volume <= 0) return rows || [];

  const out = [];
  let dropped = false;
  for (const r of rows || []) {
    if (!dropped && isRollingStarterRow(r, volume)) {
      dropped = true;
      continue;
    }
    out.push({ ...r });
  }

  const target = dilutionWaterTarget(out);
  if (target) target.amount = round2(Number(target.amount) + convertAmount(volume, "l", target.unit));

  return out;
}

/**
 * Rééchelonne un brassin sur un nouveau volume cible — le MÊME brassin,
 * redimensionné (« finalement je fais 4 L, pas 2 »). Trois règles :
 *
 *  - le démarreur repris du bocal est un FAIT (0,5 L versés), pas une
 *    proportion : il ne bouge pas, et `starter_volume` non plus ;
 *  - l'eau de dilution est recalculée depuis le volume cible :
 *    (eau + démarreur) × ratio − démarreur. La multiplier telle quelle
 *    rééchelonnerait une eau déjà amputée (1,5 L × 2 = 3 L, au lieu des 3,5 L
 *    qu'il faut réellement verser pour 4 L avec 0,5 L de démarreur) ;
 *  - tout le reste × ratio, comme avant.
 *
 * Sans démarreur, c'est un simple produit en croix. Avant cette fonction, la
 * fiche batch multipliait tout par le ratio, démarreur compris : dès le premier
 * changement de volume, la ligne de démarreur n'était plus reconnue (son volume
 * ne collait plus à `starter_volume`), le bandeau « diffère de sa recette »
 * s'affichait à tort, et « Enregistrer dans la recette » y gravait le démarreur.
 *
 * ≠ séparation en lots : là, le liquide est physiquement DIVISÉ, démarreur
 * compris — chaque lot emporte sa part de démarreur ET son `starter_volume`
 * réduit d'autant (voir splitBatch sur la fiche batch). Deux opérations, deux
 * formules ; ce n'est pas un doublon.
 *
 * Renvoie des copies ; l'appelant compare `amount` pour n'écrire que ce qui
 * change.
 */
export function rescaleAmounts(rows, ratio, starterVolume = null) {
  const k = Number(ratio);
  const out = (rows || []).map((r) => ({ ...r }));
  if (!Number.isFinite(k) || k <= 0 || k === 1) return out;

  const volume = Number(starterVolume);
  const hasStarter = Number.isFinite(volume) && volume > 0;
  const water = hasStarter ? dilutionWaterTarget(out) : null;

  for (const r of out) {
    if (hasStarter && isRollingStarterRow(r, volume)) continue;
    if (water && r === water) {
      const cut = convertAmount(volume, "l", r.unit);
      r.amount = Math.max(0, round2((Number(r.amount) + cut) * k - cut));
      continue;
    }
    r.amount = round2(Number(r.amount) * k);
  }
  return out;
}

// « Kombucha #3 » → « Kombucha #4 ». Sans ça, une chaîne de relances produit
// cinq brassins portant tous le même nom, et la liste devient illisible.
export function nextBatchTitle(title) {
  const base = String(title ?? "").trim();
  if (!base) return base;
  const numbered = base.match(/^(.*?)#\s*(\d+)\s*$/);
  if (numbered) return `${numbered[1]}#${Number(numbered[2]) + 1}`;
  return `${base} #2`;
}
