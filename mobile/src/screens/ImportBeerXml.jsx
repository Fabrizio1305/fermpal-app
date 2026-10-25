// Import d'une recette BeerXML dans le carnet local. Porté de
// app/app/recipes/import/page.jsx ; l'écriture passe par saveRecipe (une
// transaction). Lot B (la collection personnelle) reste séparé.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseBeerXML } from "@/lib/beerxml";
import { RECIPE_TYPES, durationUnits, typeLabel } from "@/lib/recipeTypes";
import { useToast } from "@/lib/UiContext";
import { inp, btnP, btnSLink as btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { saveRecipe } from "../data/recipes.js";
import { useT } from "@/lib/i18n/useT";

export default function ImportBeerXml() {
  const router = useRouter();
  const { db } = useDb();
  const { t, lang } = useT();
  const DURATION_UNITS = durationUnits(lang);
  const toast = useToast();
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setParsed(null);
    try {
      setParsed(parseBeerXML(await file.text()));
    } catch (err) {
      setError(err.message);
    }
  };

  const doImport = async () => {
    if (busy || !parsed) return;
    setBusy(true);
    try {
      const { id } = await saveRecipe(db, {
        recipe: {
          title: parsed.title, type: parsed.type, source_type: "beerxml", batch_size_ref: parsed.batchSizeRef, instructions: parsed.instructions,
          boil_time: parsed.boilTime, style: parsed.style,
        },
        phases: parsed.phases.map((p) => ({ key: p.key, name: p.name, duration_value: p.durationValue, duration_unit: p.durationUnit, temperature_target: p.temperatureTarget, notes: p.notes || null })),
        ingredients: parsed.ingredients.map((ing) => ({ phaseKey: ing.phaseKey || null, category: ing.category, name: ing.name, amount: ing.amount, unit: ing.unit, alpha_acid_pct: ing.alphaAcidPct ?? null, timing: ing.timing ?? null })),
      });
      toast(t("import.recipeImported"));
      router.push(`/app/recipes/${id}`);
    } catch (err) {
      toast((t("common.error")) + err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MobileShell title={t("import.importBeerxml")} back="/app/settings" backLabel={t("common.settings")}>
      <div style={{ ...card, marginBottom: 16 }}>
        <input type="file" accept=".xml,text/xml,application/xml" onChange={onFile} style={inp} data-testid="beerxml-input" />
        {error && <div style={{ color: COLORS.danger, fontSize: 13, marginTop: 10 }}>{error}</div>}
      </div>
      {parsed && (
        <div style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{RECIPE_TYPES[parsed.type]?.icon} {parsed.title}</div>
            <div style={{ fontSize: 12, color: COLORS.muted }}>
              {typeLabel(parsed.type, lang)}
              {parsed.batchSizeRef ? ` · ${parsed.batchSizeRef}L` : ""}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: COLORS.text }}>{t("import.detectedPhases")}</div>
            {parsed.phases.map((p) => (
              <div key={p.key} style={{ fontSize: 12, color: COLORS.muted, marginBottom: 4 }}>
                <div>{p.name}{p.durationValue ? ` · ${p.durationValue}${DURATION_UNITS[p.durationUnit] || ""}` : ""}{p.temperatureTarget ? ` · ${p.temperatureTarget}°C` : ""}</div>
                {p.notes && <div style={{ whiteSpace: "pre-line", color: COLORS.faint, fontSize: 11 }}>{p.notes}</div>}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: COLORS.text }}>{t("import.ingredients", { ingredientsLength: parsed.ingredients.length })}</div>
            {parsed.ingredients.map((ing, i) => (
              <div key={i} style={{ fontSize: 12, color: COLORS.muted }}>{ing.name} — {ing.amount}{ing.unit}</div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: COLORS.faint }}>
            {t("import.indicativeImportQuantitiesUnitsAnd")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnP} onClick={doImport} disabled={busy} data-testid="beerxml-import">
              {busy ? (t("import.importing")) : (t("import.importThisRecipe"))}
            </button>
            <Link href="/app/settings" style={btnS}>{t("common.cancel")}</Link>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
