"use client";

// Guide + vérificateur de pH. Même composant en page publique et sur la fiche
// batch (prérempli avec le type de la recette). Les seuils et les plages
// viennent de lib/fermentationTools.js, qui documente ses sources.
import { useId, useState } from "react";
import {
  PH_BOTTLING_MAX,
  PH_BOTULISM_MAX,
  PH_PROFILES,
  PH_REFERENCE_TYPES,
  PH_SAFE_MARGIN_MAX,
  phVerdict,
} from "@/lib/fermentationTools";
import { RECIPE_TYPES, typeLabel } from "@/lib/recipeTypes";
import { COLORS, inp } from "@/lib/uiStyles";

const S = {
  fr: {
    type: "Boisson",
    ph: "pH mesuré",
    placeholder: "ex. 3,2",
    empty: "Entre ton pH pour obtenir un verdict.",
    range: (min, max) => `Plage cible : ${fmt(min)} – ${fmt(max)}`,
    ceiling: (v) => `À ne pas dépasser : ${fmt(v)}`,
    noRange: "Pas de plage cible publiée fiable pour cette boisson — on ne l'invente pas.",
    titles: {
      danger: "Zone à risque",
      risky: "Trop haut pour embouteiller",
      watch: "Pas encore prêt",
      margin: "Sûr, mais sans marge",
      ok: "Dans la plage",
      // Boisson acidifiée sans plage cible publiée : on ne peut affirmer que la
      // sécurité, pas la maturité — annoncer « dans la plage » contredirait le
      // corps du message, qui dit qu'il n'y a pas de plage.
      okSafe: "Sous le seuil de sécurité",
      sharp: "Très acide",
      na: "Le pH n'est pas le bon indicateur ici",
    },
    danger: `Au-dessus de ${fmt(PH_BOTULISM_MAX)}, les pathogènes (dont C. botulinum) peuvent se développer. Ne bois pas ce batch : soit la fermentation n'a pas démarré, soit il fait trop froid, soit le levain est mort.`,
    risky: `Sans danger immédiat, mais au-dessus de ${fmt(PH_BOTTLING_MAX)} : n'embouteille pas. La FDA recommande de jeter une kombucha qui n'est pas descendue sous ${fmt(PH_BOTTLING_MAX)} au 7ᵉ jour de F1.`,
    watch: "Sans danger, mais au-dessus de la plage cible : laisse fermenter plus longtemps, ou réchauffe un peu le bocal.",
    margin: `Encore sous la limite de ${fmt(PH_BOTULISM_MAX)}, donc pas de risque botulique — mais sans marge. Descends à ${fmt(PH_SAFE_MARGIN_MAX)} ou moins : laisse fermenter plus longtemps, ou réchauffe un peu le bocal.`,
    okRange: "Fermentation aboutie, acidité dans la zone attendue.",
    okSafeOnly: `À ${fmt(PH_SAFE_MARGIN_MAX)} ou moins, le risque botulique est écarté avec de la marge (la limite est à ${fmt(PH_BOTULISM_MAX)}).`,
    sharp: "Sans danger, juste très acide — ça vire au vinaigre. Raccourcis la F1 la prochaine fois, ou coupe avec du thé sucré.",
    naAlcohol: "Sur une boisson alcoolisée, c'est l'alcool qui protège, pas l'acidité. Le pH y règle le goût et la stabilité, pas la sécurité : on ne publie donc pas de seuil.",
    naNotAcidified: "Cette préparation n'acidifie pas : le pH n'y est pas un indicateur de sécurité. Conserve au froid et consomme rapidement.",
    naUnknown: "Type libre : aucune plage de référence possible.",
    tableTitle: "Plages de pH par boisson",
    colDrink: "Boisson",
    colTarget: "Plage cible (produit fini)",
    colCeiling: "À ne pas dépasser",
    notDocumented: "non documentée",
    any: `< ${fmt(PH_BOTULISM_MAX)}`,
    thresholds: `Deux seuils, pas des préférences de goût : ${fmt(PH_BOTULISM_MAX)} est la limite au-dessus de laquelle C. botulinum peut se développer (FDA, 21 CFR 114). ${fmt(PH_BOTTLING_MAX)} est la valeur recommandée avant d'embouteiller une boisson fermentée. Quand aucune plage cible n'est publiée pour une boisson, vise ${fmt(PH_SAFE_MARGIN_MAX)} ou moins : une limite n'est pas un objectif, et ${fmt(PH_SAFE_MARGIN_MAX)} laisse la marge que ${fmt(PH_BOTULISM_MAX)} pile ne laisse pas.`,
    strips: "Les bandelettes de pH suffisent pour savoir de quel côté du seuil tu es. Un pH-mètre électronique n'est utile que si tu veux suivre la courbe d'acidification.",
  },
  en: {
    type: "Drink",
    ph: "Measured pH",
    placeholder: "e.g. 3.2",
    empty: "Enter your pH to get a verdict.",
    range: (min, max) => `Target range: ${min.toFixed(1)} – ${max.toFixed(1)}`,
    ceiling: (v) => `Do not exceed: ${v.toFixed(1)}`,
    noRange: "No reliable published target range for this drink — we won't invent one.",
    titles: {
      danger: "Risk zone",
      risky: "Too high to bottle",
      watch: "Not ready yet",
      margin: "Safe, but no margin",
      ok: "In range",
      okSafe: "Below the safety line",
      sharp: "Very acidic",
      na: "pH isn't the right indicator here",
    },
    danger: `Above ${PH_BOTULISM_MAX.toFixed(1)}, pathogens (including C. botulinum) can grow. Don't drink this batch: either fermentation never started, it's too cold, or the culture is dead.`,
    risky: `No immediate danger, but above ${PH_BOTTLING_MAX.toFixed(1)}: don't bottle it. The FDA advises discarding kombucha that hasn't dropped below ${PH_BOTTLING_MAX.toFixed(1)} by day 7 of the first ferment.`,
    watch: "Safe, but above the target range: let it ferment longer, or move the jar somewhere warmer.",
    margin: `Still below the ${PH_BOTULISM_MAX.toFixed(1)} line, so no botulism risk — but with no margin. Bring it down to ${PH_SAFE_MARGIN_MAX.toFixed(1)} or lower: ferment it longer, or move the jar somewhere warmer.`,
    okRange: "Fermentation complete, acidity where it should be.",
    okSafeOnly: `At ${PH_SAFE_MARGIN_MAX.toFixed(1)} or below, the botulism risk is ruled out with margin to spare (the limit sits at ${PH_BOTULISM_MAX.toFixed(1)}).`,
    sharp: "Safe, just very acidic — it's heading for vinegar. Shorten the first ferment next time, or cut it with sweet tea.",
    naAlcohol: "In an alcoholic drink the alcohol does the protecting, not the acidity. pH there drives taste and stability, not safety — so we publish no threshold.",
    naNotAcidified: "This preparation doesn't acidify: pH is not a safety indicator for it. Keep it cold and drink it quickly.",
    naUnknown: "Free-form type: no reference range possible.",
    tableTitle: "pH ranges by drink",
    colDrink: "Drink",
    colTarget: "Target range (finished)",
    colCeiling: "Do not exceed",
    notDocumented: "not documented",
    any: `< ${PH_BOTULISM_MAX.toFixed(1)}`,
    thresholds: `Two thresholds, not taste preferences: ${PH_BOTULISM_MAX.toFixed(1)} is the line above which C. botulinum can grow (FDA, 21 CFR 114). ${PH_BOTTLING_MAX.toFixed(1)} is the recommended value before bottling a fermented drink. Where no target range is published for a drink, aim for ${PH_SAFE_MARGIN_MAX.toFixed(1)} or below: a limit isn't a goal, and ${PH_SAFE_MARGIN_MAX.toFixed(1)} leaves the margin that ${PH_BOTULISM_MAX.toFixed(1)} exactly does not.`,
    strips: "pH strips are enough to tell which side of the threshold you're on. An electronic pH meter only helps if you want to track the acidification curve.",
  },
};

// Affichage FR des décimales (virgule), EN via toFixed direct.
function fmt(n) {
  return n.toFixed(1).replace(".", ",");
}

const TONE = {
  danger: { bg: "#fef2f2", border: "#fecaca", color: "#991b1b" },
  risky: { bg: "#fff7ed", border: "#fed7aa", color: "#7c2d12" },
  watch: { bg: "#fffbeb", border: "#fde68a", color: "#78350f" },
  margin: { bg: "#fffbeb", border: "#fde68a", color: "#78350f" },
  ok: { bg: COLORS.successBg, border: COLORS.successBorder, color: "#065f46" },
  okSafe: { bg: COLORS.successBg, border: COLORS.successBorder, color: "#065f46" },
  sharp: { bg: COLORS.row, border: COLORS.border, color: COLORS.text },
  na: { bg: COLORS.row, border: COLORS.border, color: COLORS.muted },
};

const fieldLabel = { fontSize: 12, fontWeight: 700, color: COLORS.muted, display: "block", marginBottom: 5 };


function ceilingLabel(profile, fr) {
  const value = profile.bottlingMax ?? profile.safeMax;
  if (value == null) return null;
  return `≤ ${fr ? fmt(value) : value.toFixed(1)}`;
}

function verdictBody(verdict, t) {
  const { level, profile } = verdict;
  if (level === "na") {
    if (profile.kind === "alcohol") return t.naAlcohol;
    if (profile.kind === "not-acidified") return t.naNotAcidified;
    return t.naUnknown;
  }
  if (level === "ok") {
    return profile.targetMin != null ? t.okRange : `${t.okSafeOnly} ${t.noRange}`;
  }
  return t[level];
}

// « Dans la plage » n'a de sens que s'il y a une plage. Sans plage publiée, le
// titre ne promet que ce qu'on sait : le seuil de sécurité est respecté.
function verdictTitleKey({ level, profile }) {
  return level === "ok" && profile.targetMin == null ? "okSafe" : level;
}

export default function PhGuide({ lang = "fr", initialType = "kombucha", compact = false }) {
  const t = S[lang === "en" ? "en" : "fr"];
  const fr = lang !== "en";
  const uid = useId();
  const [type, setType] = useState(initialType in PH_PROFILES ? initialType : "kombucha");
  const [ph, setPh] = useState("");

  // Saisie FR à la virgule ("3,2") acceptée comme "3.2".
  const verdict = phVerdict(type, String(ph).replace(",", "."));
  const profile = PH_PROFILES[type];
  const titleKey = verdict ? verdictTitleKey(verdict) : null;
  const tone = titleKey ? TONE[titleKey] : TONE.na;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <label htmlFor={`${uid}-type`} style={fieldLabel}>
            {t.type}
          </label>
          <select id={`${uid}-type`} style={inp} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.keys(PH_PROFILES).map((key) => (
              <option key={key} value={key}>
                {typeLabel(key, lang)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 120px" }}>
          <label htmlFor={`${uid}-ph`} style={fieldLabel}>
            {t.ph}
          </label>
          <input
            id={`${uid}-ph`}
            type="text"
            inputMode="decimal"
            placeholder={t.placeholder}
            style={inp}
            value={ph}
            onChange={(e) => setPh(e.target.value)}
          />
        </div>
      </div>

      <div role="status" style={{ background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 12, padding: "14px 16px" }}>
        {!verdict ? (
          <div style={{ fontSize: 13, color: COLORS.faint }}>
            {t.empty}
            {profile.targetMin != null && (
              <div style={{ marginTop: 6, color: COLORS.muted }}>{t.range(profile.targetMin, profile.targetMax)}</div>
            )}
            {profile.safeMax != null && <div style={{ marginTop: 6, color: COLORS.muted }}>{t.ceiling(profile.safeMax)}</div>}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 800, color: tone.color, marginBottom: 5 }}>{t.titles[titleKey]}</div>
            <div style={{ fontSize: 13, color: tone.color, lineHeight: 1.6 }}>{verdictBody(verdict, t)}</div>
            {profile.targetMin != null && verdict.level !== "na" && (
              <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>{t.range(profile.targetMin, profile.targetMax)}</div>
            )}
          </>
        )}
      </div>

      {!compact && (
        <>
          <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55 }}>{t.thresholds}</div>

          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{t.tableTitle}</div>
            {/* overflowX : le tableau ne doit pas faire déborder la page sur mobile */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 380 }}>
                <thead>
                  <tr>
                    {[t.colDrink, t.colTarget, t.colCeiling].map((h) => (
                      <th
                        key={h}
                        style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1.5px solid ${COLORS.border}`, color: COLORS.muted, fontSize: 12, whiteSpace: "nowrap" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PH_REFERENCE_TYPES.map((key) => {
                    const p = PH_PROFILES[key];
                    return (
                      <tr key={key}>
                        <td style={{ padding: "8px 10px", borderBottom: `1px solid ${COLORS.border}`, fontWeight: 600 }}>
                          {RECIPE_TYPES[key]?.icon} {typeLabel(key, lang)}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: `1px solid ${COLORS.border}`, color: p.targetMin != null ? COLORS.text : COLORS.faint }}>
                          {p.targetMin != null
                            ? fr
                              ? `${fmt(p.targetMin)} – ${fmt(p.targetMax)}`
                              : `${p.targetMin.toFixed(1)} – ${p.targetMax.toFixed(1)}`
                            : t.notDocumented}
                        </td>
                        {/* Plafond : le seuil d'embouteillage quand il est documenté,
                            sinon la marge de sécurité 4,5, sinon la limite 4,6. */}
                        <td style={{ padding: "8px 10px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.muted }}>
                          {ceilingLabel(p, fr) ?? t.any}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55 }}>{t.strips}</div>
        </>
      )}
    </div>
  );
}
