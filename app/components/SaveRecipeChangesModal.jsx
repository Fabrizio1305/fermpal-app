"use client";

// Le batch a divergé de sa recette : proposer de reporter les changements.
// Deux issues, jamais implicites — l'utilisateur choisit s'il corrige sa recette
// ou s'il en crée une autre.
//
// Nouvelle version : les quantités sont ramenées au volume de référence de la
// recette (sinon une recette de 1 L brassée en 2 L deviendrait une recette de
// 2 L sans que personne ne l'ait demandé). Les phases ne sont pas touchées, donc
// les batchs en cours gardent leur suivi.
//
// Nouvelle recette : c'est ce qui a été brassé, tel quel, avec le volume du
// batch comme référence. La recette d'origine et ce batch restent intacts.
import { useState } from "react";
import { inp, btnP, btnS, COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";
import { localeFor } from "@/lib/i18n";

// Séparateur décimal de la locale (« 1,5 » en fr-CH, « 1.5 » en en-GB), sans
// groupement de milliers.
const num = (n, lang) => new Intl.NumberFormat(localeFor(lang), { useGrouping: false, maximumFractionDigits: 20 }).format(Number(n));

function Line({ children, color }) {
  return <li style={{ fontSize: 13, color: color || COLORS.muted, lineHeight: 1.6, marginBottom: 3 }}>{children}</li>;
}

// N'annoncer que ce qui a réellement changé : afficher « 10 → 10 g » quand seule
// l'unité bouge n'apprend rien à personne.
function describeChange(m, lang, t) {
  if (m.amountChanged) {
    return (
      <>
        {num(m.expected, lang)} → <strong>{num(m.batch.amount, lang)}</strong> {m.batch.unit}
      </>
    );
  }
  if (m.unitChanged) {
    return `${num(m.batch.amount, lang)} ${m.recipe.unit} → ${num(m.batch.amount, lang)} ${m.batch.unit}`;
  }
  return m.batch.is_starter
    ? t("saveRecipeChanges.becomesAReusableStarter")
    : t("saveRecipeChanges.noLongerAStarter");
}

export default function SaveRecipeChangesModal({ diff, recipe, batchVolume, ratio, onSaveVersion, onSaveNewRecipe, onClose, busy }) {
  const { t, lang } = useT();
  const [newTitle, setNewTitle] = useState(`${recipe?.title || ""}${t("saveRecipeChanges.variant")}`);
  const [mode, setMode] = useState(null); // null | "new"

  const nextVersion = (recipe?.current_version || 1) + 1;
  const rescales = Math.abs(ratio - 1) > 0.001;

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: COLORS.text, marginBottom: 4 }}>
          {t("saveRecipeChanges.saveTheChangesToThe")}
        </div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6, marginBottom: 14 }}>
          {t("saveRecipeChanges.thisBatchNoLongerMatches")}
        </div>

        <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
          {diff.added.map((b) => (
            <Line key={`a-${b.id}`} color="#065f46">
              + {b.name} — {num(b.amount, lang)} {b.unit}
            </Line>
          ))}
          {diff.modified.map((m) => (
            <Line key={`m-${m.batch.id}`} color={COLORS.amberText}>
              ~ {m.batch.name} : {describeChange(m, lang, t)}
            </Line>
          ))}
          {diff.removed.map((r) => (
            <Line key={`r-${r.id}`} color="#991b1b">
              − {r.name} {t("saveRecipeChanges.removed")}
            </Line>
          ))}
        </ul>

        {rescales && (
          <div style={{ fontSize: 12, color: COLORS.muted, background: COLORS.row, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 16, lineHeight: 1.55 }}>
            {t("saveRecipeChanges.thisBatchIs", { volume: num(batchVolume, lang), ref: num(recipe.batch_size_ref, lang) })}
          </div>
        )}

        {mode !== "new" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button style={{ ...btnP, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onSaveVersion}>
              {busy
                ? t("saveRecipeChanges.saving")
                : t("saveRecipeChanges.newVersionOfV", { title: recipe?.title, nextVersion })}
            </button>
            <button style={btnS} disabled={busy} onClick={() => setMode("new")}>
              {t("saveRecipeChanges.saveAsANewRecipe")}
            </button>
            <button style={{ ...btnS, background: "transparent", border: "none" }} disabled={busy} onClick={onClose}>
              {t("common.later")}
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="new-recipe-title" style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, display: "block", marginBottom: 5 }}>
              {t("saveRecipeChanges.newRecipeTitle")}
            </label>
            <input id="new-recipe-title" style={{ ...inp, marginBottom: 12 }} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...btnP, opacity: busy || !newTitle.trim() ? 0.6 : 1 }}
                disabled={busy || !newTitle.trim()}
                onClick={() => onSaveNewRecipe(newTitle.trim())}
              >
                {busy ? (t("common.creating")) : t("saveRecipeChanges.createRecipe")}
              </button>
              <button style={btnS} disabled={busy} onClick={() => setMode(null)}>
                {t("common.back")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
