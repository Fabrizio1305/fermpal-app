// Écran affiché quand la base ne peut pas être ouverte normalement (schéma
// plus récent que l'app, intégrité douteuse, migration impossible). Règle du
// cadrage §4 : pas d'écriture, pas de remise à zéro automatique ; on propose
// la récupération (export) et on explique.
import { useState } from "react";
import { btnP, card, COLORS } from "@/lib/uiStyles";
import { buildExportBundle } from "../data/exportImport.js";
import { exportToFile } from "../platform/files.js";
import { platformName } from "../db/openDatabase.js";
import { useT } from "@/lib/i18n/useT";

// Codes d'erreur d'ouverture ayant un message dédié (clés recovery.messages.<code>).
const RECOVERY_CODES = new Set(["schema_too_new", "integrity", "foreign_keys", "missing_tables"]);

export default function RecoveryScreen({ db, error }) {
  const { t } = useT();
  const [status, setStatus] = useState("");
  const msg = RECOVERY_CODES.has(error?.code) ? t(`recovery.messages.${error.code}`) : t("recovery.theDatabaseCannotBeOpened");

  const doExport = async () => {
    try {
      const bundle = await buildExportBundle(db, { platform: platformName() });
      const res = await exportToFile(bundle, { title: t("recovery.fermpalRecovery") });
      setStatus(res.cancelled ? "" : (t("common.exportReady", { fileName: res.fileName })));
    } catch (err) {
      setStatus((t("recovery.exportFailed")) + err.message);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif", padding: 20 }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: COLORS.green, margin: "8px 0 16px" }}>{t("recovery.notebookRecovery")}</div>
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }} role="alert">
          <div style={{ fontSize: 14, color: COLORS.text, lineHeight: 1.6 }}>{msg}</div>
          <div style={{ fontSize: 12, color: COLORS.muted, fontFamily: "monospace" }}>
            {error?.code || error?.name} — {error?.message}
          </div>
          <button style={btnP} onClick={doExport}>
            {t("recovery.exportReadableData")}
          </button>
          {status && <div style={{ fontSize: 13, color: COLORS.muted }}>{status}</div>}
        </div>
      </div>
    </div>
  );
}
