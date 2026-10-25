// Échéance de la phase courante d'un batch : la promesse « FermPal te dit quand
// passer à la phase suivante » (landing, money page) tient ici.
//
// Aucune dépendance React ni Supabase — logique pure, appelée par la liste des
// batches et par la fiche batch. `now` est TOUJOURS injecté : une fonction qui
// appelle `new Date()` elle-même n'est pas testable.
//
// Deux données seulement : `batches.phase_started_at` (écrit à chaque
// transition de phase) et la durée prévue de la phase (`recipe_phases`).
// Beaucoup de recettes n'ont pas de durée renseignée, et un batch encore
// « planifié » n'a pas de date de départ : dans ces cas on renvoie un état
// neutre `unknown` plutôt que d'inventer une échéance.

import { COLORS } from "@/lib/uiStyles";
import { t } from "@/lib/i18n";

// Les unités sont celles de recipe_phases.duration_unit (cf. migration 0004).
const UNIT_HOURS = { minutes: 1 / 60, heures: 1, jours: 24 };

// Sous ce reste, on passe en alerte douce : l'utilisateur doit préparer la
// suite (bouteilles, sucre de F2) avant que l'échéance tombe, pas le jour même.
export const DUE_SOON_HOURS = 24;

const HOUR_MS = 3600 * 1000;

// Renvoie { status, hoursRemaining, dueAt }.
//   status : 'unknown' | 'ontime' | 'due_soon' | 'overdue'
//   hoursRemaining : négatif si l'échéance est dépassée ; null si 'unknown'
//   dueAt : Date d'échéance ; null si 'unknown'
export function computePhaseTiming(phaseStartedAt, durationValue, durationUnit, now) {
  const start = phaseStartedAt ? new Date(phaseStartedAt).getTime() : NaN;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const value = Number(durationValue);
  const perUnit = UNIT_HOURS[durationUnit];
  if (!Number.isFinite(start) || !Number.isFinite(nowMs) || !Number.isFinite(value) || value <= 0 || !perUnit) {
    return { status: "unknown", hoursRemaining: null, dueAt: null };
  }
  const dueAt = new Date(start + value * perUnit * HOUR_MS);
  const hoursRemaining = (dueAt.getTime() - nowMs) / HOUR_MS;
  const status = hoursRemaining < 0 ? "overdue" : hoursRemaining <= DUE_SOON_HOURS ? "due_soon" : "ontime";
  return { status, hoursRemaining, dueAt };
}

// « 5 h » sous 48 h, « 3 j » au-delà : au bout de trois jours, l'heure exacte
// n'apporte rien. Plancher à 1 : « en retard de 0 h » ne veut rien dire.
function formatSpan(hours, lang) {
  if (hours < 48) return `${Math.max(1, Math.round(hours))}${t("timing.h", null, lang)}`;
  return `${Math.round(hours / 24)}${t("timing.d", null, lang)}`;
}

// Libellé prêt à afficher, ou null si l'état est neutre (rien à dire).
export function phaseTimingLabel(timing, lang) {
  if (!timing || timing.status === "unknown") return null;
  const h = timing.hoursRemaining;
  if (timing.status === "overdue") {
    return t("timing.overdue", { span: formatSpan(-h, lang) }, lang);
  }
  if (h < 1) return t("timing.dueNow", null, lang);
  return t("timing.left", { span: formatSpan(h, lang) }, lang);
}

// Tons du badge, par statut : on réutilise les tokens de uiStyles, pas de
// nouvelle couleur. { color, bg } se branche directement sur `badge()`.
export const PHASE_TIMING_TONES = {
  ontime: { color: COLORS.green, bg: COLORS.successBg },
  due_soon: { color: COLORS.amberText, bg: COLORS.amberSoft },
  overdue: { color: COLORS.danger, bg: COLORS.dangerSoft },
};
