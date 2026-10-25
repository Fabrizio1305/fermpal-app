// Outils de fermentation : données de référence + calculs purs.
//
// Aucune dépendance React : le même module alimente les pages publiques
// indexables (app/outils, app/en/tools) ET le montage in-app sur un batch
// (app/app/batches/[id]). Un seul endroit où corriger un chiffre.
//
// Convention i18n identique à recipeTypes.js : `label` (EN) / `labelFr` (FR)
// portés par la donnée ; les composants choisissent selon la langue.

// ---------------------------------------------------------------------------
// pH
// ---------------------------------------------------------------------------
//
// Deux seuils réglementaires, pas des préférences de goût :
//
//   4,6 — pH d'équilibre au-dessus duquel Clostridium botulinum peut se
//         développer (FDA, 21 CFR 114 « acidified foods »). C'est la ligne de
//         sécurité, tous produits confondus.
//   4,2 — recommandation pour une boisson fermentée EMBOUTEILLÉE. La guidance
//         FDA sur la kombucha va plus loin : un batch qui n'est pas descendu
//         à ≤ 4,2 au 7e jour de F1 est à jeter (SCOBY contaminé ou
//         fermentation trop froide).
//
// On ne publie une plage cible que pour les boissons où elle est documentée.
// Pour les autres (ginger beer, soda de plante, kvas) on affiche les seuils de
// sécurité et on dit explicitement qu'on n'a pas de plage fiable — mentir sur
// un chiffre de sécurité alimentaire serait pire que de ne rien afficher.
export const PH_BOTULISM_MAX = 4.6;
export const PH_BOTTLING_MAX = 4.2;

// 4,5 : marge pratique sous la limite des 4,6. Une limite réglementaire n'est pas
// une cible — on ne vise pas la valeur exacte à partir de laquelle le danger
// commence. Pour les boissons acidifiées dont aucune plage cible n'est publiée
// (ginger beer, soda de plante, kvas), c'est le plafond que l'outil recommande :
// à 4,5 ou moins, le risque botulique est écarté avec de la marge.
export const PH_SAFE_MARGIN_MAX = 4.5;

// kind :
//   "acidified"     → la fermentation acidifie ; les seuils ci-dessus s'appliquent.
//   "not-acidified" → pas d'acidification (koji) : la sécurité passe par le froid.
//   "alcohol"       → l'alcool protège ; le pH y est un paramètre de goût et de
//                     stabilité, pas un seuil pathogène. On n'invente pas de plage.
//   "unknown"       → type libre, aucune donnée possible.
//
// targetMin/targetMax : plage du produit FINI (goût + fermentation aboutie).
// bottlingMax : ne pas embouteiller au-dessus (quand documenté).
// safeMax : plafond recommandé quand aucune plage cible n'est publiée — on ne
//           sait rien dire du goût, mais on peut toujours dire la sécurité.
export const PH_PROFILES = {
  kombucha: { kind: "acidified", targetMin: 2.5, targetMax: 3.5, bottlingMax: PH_BOTTLING_MAX },
  jun: { kind: "acidified", targetMin: 2.5, targetMax: 3.5, bottlingMax: PH_BOTTLING_MAX },
  kefir_eau: { kind: "acidified", targetMin: 3.5, targetMax: 4.5 },
  kefir_lait: { kind: "acidified", targetMin: 4.0, targetMax: 4.5 },
  ginger_beer: { kind: "acidified", safeMax: PH_SAFE_MARGIN_MAX },
  soda_plante: { kind: "acidified", safeMax: PH_SAFE_MARGIN_MAX },
  kvas: { kind: "acidified", safeMax: PH_SAFE_MARGIN_MAX },
  amazake: { kind: "not-acidified" },
  biere: { kind: "alcohol" },
  braggot: { kind: "alcohol" },
  cidre: { kind: "alcohol" },
  hydromel: { kind: "alcohol" },
  hybride: { kind: "unknown" },
};

// Niveaux de verdict, du plus grave au plus anodin. `level` est la clé de
// rendu (couleur + message) côté composant.
//   danger  → au-dessus de 4,6 : risque pathogène, ne pas consommer en l'état.
//   risky   → sous 4,6 mais au-dessus du seuil d'embouteillage documenté.
//   watch   → sûr, mais au-dessus de la plage cible : fermentation pas finie.
//   margin  → sous 4,6 mais au-dessus de 4,5 : sûr, sans marge (types sans plage).
//   ok      → dans la plage cible, ou sous le plafond de sécurité.
//   sharp   → sous la plage cible : sûr, juste très acide.
//   na      → aucun seuil pH pertinent pour ce type.
export function phVerdict(typeKey, ph) {
  const profile = PH_PROFILES[typeKey] || PH_PROFILES.hybride;
  const value = Number(ph);
  if (!Number.isFinite(value) || value <= 0 || value > 14) return null;

  if (profile.kind !== "acidified") return { level: "na", profile, value };
  if (value > PH_BOTULISM_MAX) return { level: "danger", profile, value };
  if (profile.bottlingMax && value > profile.bottlingMax) return { level: "risky", profile, value };
  if (profile.targetMax && value > profile.targetMax) return { level: "watch", profile, value };
  if (profile.safeMax && value > profile.safeMax) return { level: "margin", profile, value };
  if (profile.targetMin && value < profile.targetMin) return { level: "sharp", profile, value };
  return { level: "ok", profile, value };
}

// Types affichés dans le tableau de référence de la page publique : ceux dont
// le pH est un vrai levier (on masque bière/cidre/hydromel/hybride).
export const PH_REFERENCE_TYPES = ["kombucha", "jun", "kefir_eau", "kefir_lait", "ginger_beer", "soda_plante", "kvas"];

// ---------------------------------------------------------------------------
// Carbonatation (sucre d'amorçage F2)
// ---------------------------------------------------------------------------
//
// Chimie : un « volume » de CO2 = 1 L de CO2 dissous par litre de liquide, soit
// 1,977 g de CO2/L. Le saccharose (342,3 g/mol) fermente en 4 CO2 (176,0 g),
// soit 0,514 g de CO2 par gramme de sucre. Il faut donc 1,977 / 0,514 ≈ 3,84 g
// de saccharose par litre pour ajouter un volume de CO2.
//
// HYPOTHÈSE STRUCTURANTE : on part d'une boisson PLATE, sortie d'une F1 en
// récipient ouvert (kombucha, kéfir, ginger beer…). Le CO2 résiduel y est
// négligeable. C'est faux pour une bière en fin de fermentation, déjà saturée
// à ~0,85 volume : appliquer cette formule à une bière sur-carbonaterait la
// bouteille. D'où CARBONATION_TYPES ci-dessous, volontairement restreint aux
// boissons à F1 ouverte — la bière reste hors périmètre.
export const SUCROSE_G_PER_L_PER_VOLUME = 3.84;

export const CARBONATION_TYPES = ["kefir_eau", "kombucha", "jun", "ginger_beer", "soda_plante", "kvas"];

// gPerL exprimé en équivalent saccharose. Au-delà de 8 g/L on approche des
// pressions qui font éclater une bouteille non prévue pour (`risky`).
export const CARBONATION_LEVELS = {
  douce: { gPerL: 3, label: "Light", labelFr: "Douce" },
  moyenne: { gPerL: 5, label: "Medium", labelFr: "Moyenne" },
  forte: { gPerL: 8, label: "Strong", labelFr: "Forte" },
};

export const CARBONATION_RISKY_G_PER_L = 8;

// `factor` = quantité de la source nécessaire pour un gramme d'équivalent
// saccharose. Miel : ~82 % de sucres fermentescibles, monosaccharides (2 CO2).
// Dextrose : monohydrate (198,2 g/mol → 2 CO2). Jus de fruit : base 10 g de
// sucre pour 100 mL — très variable selon le jus, d'où l'avertissement en UI.
export const SUGAR_SOURCES = {
  sucre_blanc: { factor: 1, unit: "g", label: "White sugar", labelFr: "Sucre blanc" },
  miel: { factor: 1.28, unit: "g", label: "Honey", labelFr: "Miel" },
  dextrose: { factor: 1.16, unit: "g", label: "Dextrose", labelFr: "Dextrose" },
  jus_de_fruit: { factor: 10.5, unit: "ml", label: "Fruit juice", labelFr: "Jus de fruit" },
};

export const TEASPOON_G = 4.2; // cuillère à café rase de sucre blanc

export const BOTTLE_SIZES_ML = [250, 330, 500, 750, 1000];

const round1 = (n) => Math.round(n * 10) / 10;

// Renvoie null sur une entrée inexploitable (champ vide, volume absurde) :
// l'UI n'affiche alors simplement pas de résultat.
export function carbonationDose({ volumeL, level = "moyenne", source = "sucre_blanc", bottleMl = 500 }) {
  const lvl = CARBONATION_LEVELS[level];
  const src = SUGAR_SOURCES[source];
  const volume = Number(volumeL);
  const bottle = Number(bottleMl);
  if (!lvl || !src) return null;
  if (!Number.isFinite(volume) || volume <= 0 || volume > 200) return null;
  if (!Number.isFinite(bottle) || bottle <= 0) return null;

  const sucroseGrams = lvl.gPerL * volume;
  const amount = sucroseGrams * src.factor;
  // Dose par bouteille calculée depuis le volume de la bouteille, pas en
  // divisant le total : la dernière bouteille est souvent incomplète.
  const perBottle = lvl.gPerL * (bottle / 1000) * src.factor;

  return {
    sucroseGrams: round1(sucroseGrams),
    amount: round1(amount),
    unit: src.unit,
    perBottle: round1(perBottle),
    bottles: Math.ceil((volume * 1000) / bottle),
    teaspoons: source === "sucre_blanc" ? round1(perBottle / TEASPOON_G) : null,
    addedVolumesCO2: round1(lvl.gPerL / SUCROSE_G_PER_L_PER_VOLUME),
    risky: lvl.gPerL >= CARBONATION_RISKY_G_PER_L,
  };
}
