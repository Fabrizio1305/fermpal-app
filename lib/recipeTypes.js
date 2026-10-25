// Types de boissons fermentées et modèles de phases par défaut.
//
// Liste plate (pas de catégorie séparée en base) : pour ajouter un nouveau
// type de boisson, ajouter une entrée ici (label, icône, modèle de phases).
// Aucune migration de schéma n'est nécessaire — `recipes.type` est un simple
// texte, et les phases vivent dans `recipe_phases`, propres à chaque recette.
// Voir plan.md section 3 ("Principe d'extensibilité").
//
// Un batch suit directement les phases de sa recette, dans l'ordre : le
// déstockage se déclenche pour les ingrédients rattachés à une phase quand
// le batch y entre — pas besoin de tag F1/F2 explicite.
//
// i18n : les libellés vivent dans lib/i18n (clés `types.<id>` et
// `phases.<nom>`), résolus par typeLabel() / phaseName(). Le nom de phase est
// copié dans la recette au chargement du modèle, dans la langue active à ce
// moment-là (les phases sont ensuite du texte libre, modifiable).
import { t } from "./i18n/index.js";

export const RECIPE_TYPES = {
  kefir_eau: {
    icon: "🫧",
    phaseTemplate: [
      { nameKey: "phases.primaryFermentationF1", durationValue: 1, durationUnit: "jours", temperatureTarget: 22 },
      { nameKey: "phases.grainRemoval", durationValue: null, durationUnit: "jours", temperatureTarget: null },
      { nameKey: "phases.secondaryFermentationF2", durationValue: 2, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  kefir_lait: {
    icon: "🥛",
    phaseTemplate: [
      { nameKey: "phases.primaryFermentationF1", durationValue: 1, durationUnit: "jours", temperatureTarget: 20 },
      { nameKey: "phases.grainRemoval", durationValue: null, durationUnit: "jours", temperatureTarget: null },
    ],
  },
  kombucha: {
    icon: "🍄",
    phaseTemplate: [
      { nameKey: "phases.teaPreparation", durationValue: 20, durationUnit: "minutes", temperatureTarget: 95 },
      { nameKey: "phases.primaryFermentationF1", durationValue: 7, durationUnit: "jours", temperatureTarget: 22 },
      { nameKey: "phases.scobyRemoval", durationValue: null, durationUnit: "jours", temperatureTarget: null },
      { nameKey: "phases.secondaryFermentationF2", durationValue: 3, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  jun: {
    icon: "🍵",
    phaseTemplate: [
      { nameKey: "phases.teaPreparation", durationValue: 20, durationUnit: "minutes", temperatureTarget: 85 },
      { nameKey: "phases.primaryFermentationF1", durationValue: 5, durationUnit: "jours", temperatureTarget: 22 },
      { nameKey: "phases.scobyRemoval", durationValue: null, durationUnit: "jours", temperatureTarget: null },
      { nameKey: "phases.secondaryFermentationF2", durationValue: 2, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  ginger_beer: {
    icon: "🫚",
    phaseTemplate: [
      { nameKey: "phases.bugPreparation", durationValue: 5, durationUnit: "jours", temperatureTarget: 20 },
      { nameKey: "phases.primaryFermentationF1", durationValue: 2, durationUnit: "jours", temperatureTarget: 20 },
      { nameKey: "phases.secondaryFermentationF2", durationValue: 3, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  soda_plante: {
    icon: "🌿",
    phaseTemplate: [
      { nameKey: "phases.bugPreparation", durationValue: 5, durationUnit: "jours", temperatureTarget: 20 },
      { nameKey: "phases.primaryFermentationF1", durationValue: 2, durationUnit: "jours", temperatureTarget: 20 },
      { nameKey: "phases.secondaryFermentationF2", durationValue: 3, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  kvas: {
    icon: "🍞",
    phaseTemplate: [
      { nameKey: "phases.mash", durationValue: 60, durationUnit: "minutes", temperatureTarget: 65 },
      { nameKey: "phases.boil", durationValue: 15, durationUnit: "minutes", temperatureTarget: 100 },
      { nameKey: "phases.fermentation", durationValue: 2, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  amazake: {
    icon: "🍚",
    phaseTemplate: [
      { nameKey: "phases.riceCooking", durationValue: 60, durationUnit: "minutes", temperatureTarget: 90 },
      { nameKey: "phases.saccharificationKoji", durationValue: 8, durationUnit: "heures", temperatureTarget: 60 },
    ],
  },
  biere: {
    icon: "🍺",
    phaseTemplate: [
      { nameKey: "phases.mash", durationValue: 60, durationUnit: "minutes", temperatureTarget: 66 },
      { nameKey: "phases.boil", durationValue: 60, durationUnit: "minutes", temperatureTarget: 100 },
      { nameKey: "phases.fermentation", durationValue: 14, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  braggot: {
    icon: "🍯",
    phaseTemplate: [
      { nameKey: "phases.mash", durationValue: 60, durationUnit: "minutes", temperatureTarget: 66 },
      { nameKey: "phases.boil", durationValue: 60, durationUnit: "minutes", temperatureTarget: 100 },
      { nameKey: "phases.fermentation", durationValue: 21, durationUnit: "jours", temperatureTarget: 20 },
    ],
  },
  cidre: {
    icon: "🍏",
    phaseTemplate: [
      { nameKey: "phases.fermentation", durationValue: 14, durationUnit: "jours", temperatureTarget: 18 },
      { nameKey: "phases.conditioning", durationValue: 30, durationUnit: "jours", temperatureTarget: 12 },
    ],
  },
  hydromel: {
    icon: "🍯",
    phaseTemplate: [
      { nameKey: "phases.primaryFermentation", durationValue: 14, durationUnit: "jours", temperatureTarget: 20 },
      { nameKey: "phases.conditioning", durationValue: 30, durationUnit: "jours", temperatureTarget: 15 },
    ],
  },
  hybride: {
    icon: "🧪",
    phaseTemplate: [{ nameKey: "phases.step1", durationValue: null, durationUnit: "jours", temperatureTarget: null }],
  },
};

// Libellé du type de boisson dans la langue donnée (repli : l'identifiant).
export function typeLabel(typeId, lang) {
  return typeId in RECIPE_TYPES ? t(`types.${typeId}`, null, lang) : String(typeId ?? "");
}

// Nom d'une phase de modèle dans la langue donnée.
export function phaseName(template, lang) {
  return t(template.nameKey, null, lang);
}

// Unités de durée abrégées, localisées ("3 j" en FR, "3d" en EN), par
// identifiant d'unité (`durationUnit` des phases : minutes / heures / jours).
export function durationUnits(lang) {
  return { minutes: t("units.minutes", null, lang), heures: t("units.hours", null, lang), jours: t("units.days", null, lang) };
}
