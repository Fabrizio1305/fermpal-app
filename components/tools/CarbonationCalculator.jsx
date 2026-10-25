"use client";

// Calculateur de sucre d'amorçage F2. Monté à deux endroits, sans fork :
//   - page publique indexable (app/outils/carbonatation-f2, /en/tools/…)
//   - fiche batch de l'app, prérempli avec le volume et le type du batch
// Les calculs vivent dans lib/fermentationTools.js — ici, uniquement l'UI.
import { useId, useState } from "react";
import {
  BOTTLE_SIZES_ML,
  CARBONATION_LEVELS,
  CARBONATION_TYPES,
  SUGAR_SOURCES,
  carbonationDose,
} from "@/lib/fermentationTools";
import { typeLabel } from "@/lib/recipeTypes";
import { COLORS, inp } from "@/lib/uiStyles";

const S = {
  fr: {
    volume: "Volume à embouteiller (L)",
    level: "Pétillant",
    source: "Sucre d'amorçage",
    bottle: "Taille des bouteilles",
    result: "À ajouter",
    perBottle: "par bouteille",
    total: "au total",
    // Le français ne met le pluriel qu'à partir de 2 ("1,3 volume", pas "1,3 volumes").
    bottles: (n) => `soit ${n} bouteille${n >= 2 ? "s" : ""}`,
    teaspoons: (n) => `≈ ${dec(n)} c. à café rase${n >= 2 ? "s" : ""} par bouteille`,
    volumes: (n) => `+${dec(n)} volume${n >= 2 ? "s" : ""} de CO₂ environ`,
    empty: "Renseigne un volume pour voir la dose.",
    risky:
      "Dose forte : utilise des bouteilles prévues pour la pression (type limonade ou champagne), jamais une bouteille de jus. Purge une bouteille chaque jour pour surveiller.",
    safety:
      "Mets une bouteille témoin en plastique : quand elle est dure, la carbonatation est prête. Passe alors tout au frigo — le froid arrête la fermentation.",
    juiceNote: "La teneur en sucre d'un jus varie du simple au double : base de calcul 10 g de sucre pour 100 mL.",
    unsupported: (label) =>
      `Cet outil part d'une boisson plate sortie d'une F1 en récipient ouvert. Le ${label} ne rentre pas dans ce cas : une bière ou un cidre en fin de fermentation est déjà saturé en CO₂, et cette formule le sur-carbonaterait.`,
  },
  en: {
    volume: "Volume to bottle (L)",
    level: "Fizz",
    source: "Priming sugar",
    bottle: "Bottle size",
    result: "Add",
    perBottle: "per bottle",
    total: "in total",
    bottles: (n) => `that's ${n} bottle${n > 1 ? "s" : ""}`,
    teaspoons: (n) => `≈ ${n} level tsp per bottle`,
    volumes: (n) => `about +${n} volume${n > 1 ? "s" : ""} of CO₂`,
    empty: "Enter a volume to see the dose.",
    risky:
      "Strong dose: use pressure-rated bottles (soda or champagne style), never a juice bottle. Burp one bottle daily to check.",
    safety:
      "Keep one plastic test bottle: when it feels hard, carbonation is ready. Move everything to the fridge — cold stops the fermentation.",
    juiceNote: "Sugar content varies wildly between juices: this assumes 10 g of sugar per 100 mL.",
    unsupported: (label) =>
      `This tool assumes a flat drink coming out of an open-vessel first ferment. ${label} doesn't fit: a beer or cider at the end of fermentation is already saturated with CO₂, and this formula would over-carbonate it.`,
  },
};

// Décimale à la française ("2,5") — le reste de l'app affiche déjà des virgules.
function dec(n) {
  return String(n).replace(".", ",");
}

const fieldLabel = { fontSize: 12, fontWeight: 700, color: COLORS.muted, display: "block", marginBottom: 5 };

export default function CarbonationCalculator({ lang = "fr", initialVolumeL = null, initialType = null, compact = false }) {
  const t = S[lang === "en" ? "en" : "fr"];
  const fr = lang !== "en";
  const uid = useId();
  const [volume, setVolume] = useState(initialVolumeL != null ? String(initialVolumeL) : "");
  const [level, setLevel] = useState("moyenne");
  const [source, setSource] = useState("sucre_blanc");
  const [bottleMl, setBottleMl] = useState(500);

  // Monté sur un batch de bière/cidre/hydromel : on explique pourquoi l'outil
  // ne s'applique pas plutôt que de sortir un chiffre faux.
  if (initialType && !CARBONATION_TYPES.includes(initialType)) {
    const label = typeLabel(initialType, lang);
    return (
      <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>{t.unsupported(label.toLowerCase())}</div>
    );
  }

  const dose = carbonationDose({ volumeL: volume, level, source, bottleMl });
  const src = SUGAR_SOURCES[source];
  const n = (v) => (fr ? dec(v) : String(v));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor={`${uid}-volume`} style={fieldLabel}>
            {t.volume}
          </label>
          <input
            id={`${uid}-volume`}
            type="number"
            min="0"
            step="any"
            style={inp}
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor={`${uid}-bottle`} style={fieldLabel}>
            {t.bottle}
          </label>
          <select id={`${uid}-bottle`} style={inp} value={bottleMl} onChange={(e) => setBottleMl(Number(e.target.value))}>
            {BOTTLE_SIZES_ML.map((ml) => (
              <option key={ml} value={ml}>
                {ml >= 1000 ? "1 L" : `${ml} mL`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor={`${uid}-level`} style={fieldLabel}>
            {t.level}
          </label>
          <select id={`${uid}-level`} style={inp} value={level} onChange={(e) => setLevel(e.target.value)}>
            {Object.entries(CARBONATION_LEVELS).map(([key, l]) => (
              <option key={key} value={key}>
                {fr ? l.labelFr : l.label} · {l.gPerL} g/L
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor={`${uid}-source`} style={fieldLabel}>
            {t.source}
          </label>
          <select id={`${uid}-source`} style={inp} value={source} onChange={(e) => setSource(e.target.value)}>
            {Object.entries(SUGAR_SOURCES).map(([key, s]) => (
              <option key={key} value={key}>
                {fr ? s.labelFr : s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        role="status"
        style={{
          background: dose ? COLORS.successBg : COLORS.row,
          border: `1px solid ${dose ? COLORS.successBorder : COLORS.border}`,
          borderRadius: 12,
          padding: "14px 16px",
        }}
      >
        {!dose ? (
          <div style={{ fontSize: 13, color: COLORS.faint }}>{t.empty}</div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, marginBottom: 4 }}>{t.result}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.greenDark, letterSpacing: -0.5 }}>
              {n(dose.perBottle)} {src.unit === "ml" ? "mL" : "g"} <span style={{ fontSize: 14, fontWeight: 600 }}>{t.perBottle}</span>
            </div>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 4 }}>
              {n(dose.amount)} {src.unit === "ml" ? "mL" : "g"} {t.total} · {t.bottles(dose.bottles)}
            </div>
            {dose.teaspoons != null && (
              <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>{t.teaspoons(dose.teaspoons)}</div>
            )}
            <div style={{ fontSize: 12, color: COLORS.faint, marginTop: 6 }}>{t.volumes(dose.addedVolumesCO2)}</div>
          </>
        )}
      </div>

      {dose?.risky && (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "#7c2d12",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          ⚠️ {t.risky}
        </div>
      )}

      {source === "jus_de_fruit" && <div style={{ fontSize: 12, color: COLORS.faint, lineHeight: 1.5 }}>{t.juiceNote}</div>}

      {!compact && <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55 }}>{t.safety}</div>}
    </div>
  );
}
