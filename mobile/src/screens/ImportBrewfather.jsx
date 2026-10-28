// Import d'un export Brewfather (JSON) dans le carnet local : recettes et
// brassins passés, chacun avec la recette telle que brassée (lib/brewfather.js).
// Aperçu d'abord, copie de secours du carnet juste avant l'écriture.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { planBrewfatherImport } from "@/lib/brewfather";
import { useToast } from "@/lib/UiContext";
import { inp, btnP, btnSLink as btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { importBrewfatherPlan, previewBrewfatherImport } from "../data/brewfatherImport.js";
import { backupBeforeChange } from "../db/openDatabase.js";
import { useT } from "@/lib/i18n/useT";

export default function ImportBrewfather() {
  const router = useRouter();
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();
  const [plan, setPlan] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setPlan(null);
    setPreview(null);
    setBusy("read");
    try {
      let json;
      try {
        json = JSON.parse(await file.text());
      } catch {
        throw new Error(t("import.bfInvalid"));
      }
      let next;
      try {
        next = planBrewfatherImport(json, { lang });
      } catch (err) {
        throw err.code === "not_brewfather" ? new Error(t("import.bfInvalid")) : err;
      }
      setPreview(await previewBrewfatherImport(db, next));
      setPlan(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const doImport = async () => {
    if (busy || !plan) return;
    setBusy("import");
    try {
      await backupBeforeChange(db, "avant-import-brewfather");
      const counts = await importBrewfatherPlan(db, plan);
      toast(t("import.bfDone", counts));
      router.push("/app/recipes");
    } catch (err) {
      toast(t("common.error") + err.message, "error");
    } finally {
      setBusy("");
    }
  };

  const nothingNew = preview && preview.recipes + preview.archives + preview.batches === 0;
  const line = { fontSize: 13, color: COLORS.text };

  return (
    <MobileShell title={t("import.importBrewfather")} back="/app/settings" backLabel={t("common.settings")}>
      <div style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>{t("import.brewfatherIntro")}</div>
        <input type="file" accept=".json,application/json" onChange={onFile} disabled={!!busy} style={inp} data-testid="brewfather-input" />
        {busy === "read" && <div style={{ fontSize: 13, color: COLORS.muted }}>{t("import.bfReading")}</div>}
        {error && <div style={{ color: COLORS.danger, fontSize: 13 }}>{error}</div>}
      </div>
      {preview && (
        <div style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }} data-testid="brewfather-preview">
          <div style={line}>{t("import.bfRecipes", { count: preview.recipes })}</div>
          <div style={line}>{t("import.bfArchives", { count: preview.archives })}</div>
          <div style={line}>{t("import.bfBatches", { count: preview.batches })}</div>
          {preview.alreadyPresent > 0 && <div style={{ ...line, color: COLORS.muted }}>{t("import.bfAlreadyPresent", { count: preview.alreadyPresent })}</div>}
          {preview.planning > 0 && <div style={{ ...line, color: COLORS.muted }}>{t("import.bfPlanning", { count: preview.planning })}</div>}
          {nothingNew ? (
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 6 }}>{t("import.bfNothing")}</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: COLORS.faint, lineHeight: 1.5, marginTop: 6 }}>{t("import.bfBackupNote")}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button style={btnP} onClick={doImport} disabled={!!busy} data-testid="brewfather-import">
                  {busy === "import" ? t("import.importing") : t("import.bfImport")}
                </button>
                <Link href="/app/settings" style={btnS}>{t("common.cancel")}</Link>
              </div>
            </>
          )}
        </div>
      )}
    </MobileShell>
  );
}
