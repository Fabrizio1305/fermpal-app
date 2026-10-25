// Services de l'app en usage personnel (23/10, remplace le compte FermPal et la
// sauvegarde Supabase du lot L4) : la clé Gemini des recettes IA et la copie du
// carnet dans le kDrive. Sans clé ni kDrive relié, l'app ne fait aucune requête ;
// le carnet reste entièrement utilisable. Copies restaurées par le chemin vérifié
// de « Restaurer depuis un fichier ».
import { useEffect, useState } from "react";
import { useToast, useConfirm } from "@/lib/UiContext";
import { inp, btnP, btnS, card, COLORS } from "@/lib/uiStyles";
import { platformName } from "../db/openDatabase.js";
import { KEY_PAGE, checkGeminiKey, geminiKey, setGeminiKey } from "../platform/gemini.js";
import { forgetKdrive, kdriveConfigured, setupKdrive } from "../platform/kdrive.js";
import { AUTO_EVENT, KEEP, autoBackupEnabled, deleteCloudBackup, downloadCloudBackup, forgetBackupState, isOnline, lastAutoAttempt, lastBackupInfo, listCloudBackups, setAutoBackupEnabled, uploadBackup } from "../data/cloudBackups.js";
import { notebookFingerprint } from "../data/exportImport.js";
import { useT } from "@/lib/i18n/useT";

const label = { fontSize: 14, fontWeight: 700 };
const para = { fontSize: 13, lineHeight: 1.6 };

// Motifs de la copie automatique ayant un libellé (clés cloud.autoReason.<motif>).
const AUTO_REASONS = new Set(["error", "offline", "too_soon", "unchanged", "uploaded"]);
// Erreurs Gemini et kDrive ayant un message clair (undefined sinon).
export const aiErrorText = (t, code) => ({ bad_key: t("ai.badKey"), quota_exceeded: t("ai.googleQuota"), network: t("ai.offline") })[code];
const kdriveErrorText = (t, code) => ({ bad_token: t("kdrive.errToken"), bad_config: t("kdrive.errConfig"), network: t("kdrive.errNetwork") })[code];

// Message d'erreur lisible (toast) : message connu, sinon le code brut.
const errorText = (t, known, e) => known(t, e?.code) || e?.code || e?.message || String(e);

function GeminiCard({ run, busy }) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [saved, setSaved] = useState(geminiKey);
  const [draft, setDraft] = useState("");

  const wrap = (fn) =>
    run("gemini", async () => {
      try {
        await fn();
      } catch (e) {
        throw new Error(errorText(t, aiErrorText, e));
      }
    });

  const save = () =>
    wrap(async () => {
      const key = draft.trim();
      await checkGeminiKey(key);
      setGeminiKey(key);
      setSaved(key);
      setDraft("");
      toast(t("gemini.saved"));
    });

  const test = () =>
    wrap(async () => {
      await checkGeminiKey(saved);
      toast(t("gemini.ok"));
    });

  const remove = async () => {
    if (!(await confirm(t("gemini.removeConfirm")))) return;
    setGeminiKey("");
    setSaved("");
  };

  return (
    <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gemini-section">
      <div style={{ ...label, color: COLORS.text }}>✨ {t("gemini.title")}</div>
      {saved ? (
        <>
          <div style={{ ...para, color: COLORS.muted }} data-testid="gemini-saved">{t("gemini.keySaved", { end: saved.slice(-4) })}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btnS} onClick={test} disabled={!!busy} data-testid="gemini-test">{busy === "gemini" ? "…" : t("gemini.test")}</button>
            <button style={btnS} onClick={remove} disabled={!!busy} data-testid="gemini-remove">{t("gemini.remove")}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...para, color: COLORS.muted }}>
            {t("gemini.intro")}{" "}
            <a href={KEY_PAGE} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.green, fontWeight: 600 }}>aistudio.google.com/apikey</a>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="password" autoComplete="off" placeholder={t("gemini.key")} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }} data-testid="gemini-key" />
            <button style={btnP} onClick={save} disabled={!!busy || draft.trim().length < 20} data-testid="gemini-save">{busy === "gemini" ? "…" : t("gemini.save")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function KdriveConnect({ run, busy, onConnected }) {
  const { t } = useT();
  const toast = useToast();
  const [token, setToken] = useState("");
  const [driveId, setDriveId] = useState("");

  const connect = () =>
    run("kdrive", async () => {
      try {
        await setupKdrive({ token, driveId });
      } catch (e) {
        throw new Error(errorText(t, kdriveErrorText, e));
      }
      // Nouveau dépôt : l'état de copie d'avant (ancien compte) ne vaut plus.
      forgetBackupState();
      setToken("");
      toast(t("kdrive.connected"));
      onConnected();
    });

  return (
    <>
      <div style={{ ...para, color: COLORS.muted }}>{t("kdrive.how")}</div>
      <input type="password" autoComplete="off" placeholder={t("kdrive.token")} value={token} onChange={(e) => setToken(e.target.value)} style={inp} data-testid="kdrive-token" />
      <input inputMode="numeric" placeholder={t("kdrive.driveId")} value={driveId} onChange={(e) => setDriveId(e.target.value.replace(/\D/g, ""))} style={{ ...inp, maxWidth: 220 }} data-testid="kdrive-drive-id" />
      <div style={{ fontSize: 12, color: COLORS.faint, marginTop: -4 }}>{t("kdrive.driveIdHint")}</div>
      <div>
        <button style={btnP} onClick={connect} disabled={!!busy || !token.trim() || !driveId} data-testid="kdrive-connect">{busy === "kdrive" ? "…" : `🔗 ${t("kdrive.connect")}`}</button>
      </div>
    </>
  );
}

export default function CloudSection({ db, run, busy, restoreFrom, fmtDate, fmtSize }) {
  const { t, lang } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [linked, setLinked] = useState(kdriveConfigured);
  const [auto, setAuto] = useState(autoBackupEnabled);
  const [autoState, setAutoState] = useState(lastAutoAttempt);
  const [last, setLast] = useState(lastBackupInfo);
  const [fingerprint, setFingerprint] = useState(null);
  const [copies, setCopies] = useState(null);
  const [listError, setListError] = useState("");
  const online = isOnline();

  // La copie automatique (App.jsx) signale chaque tentative : état, dernière
  // copie et liste se mettent à jour sans quitter l'écran.
  useEffect(() => {
    const onAuto = (e) => {
      setAutoState(e.detail);
      setLast(lastBackupInfo());
      if (e.detail?.done && linked) listCloudBackups().then(setCopies).catch(() => {});
      notebookFingerprint(db).then(setFingerprint).catch(() => {});
    };
    window.addEventListener(AUTO_EVENT, onAuto);
    return () => window.removeEventListener(AUTO_EVENT, onAuto);
  }, [db, linked]);

  // À la liaison et à la FIN de chaque action (pas au début : une action en
  // cours n'a rien à rafraîchir, et ça doublait les appels réseau).
  useEffect(() => {
    if (busy) return;
    (async () => {
      setLast(lastBackupInfo());
      setAutoState(lastAutoAttempt());
      setFingerprint(await notebookFingerprint(db).catch(() => null));
      if (!linked || !isOnline()) return setCopies(null);
      try {
        setCopies(await listCloudBackups());
        setListError("");
      } catch (err) {
        setListError(errorText(t, kdriveErrorText, err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, busy, db]);

  const backupNow = () =>
    run("cloud", async () => {
      const r = await uploadBackup(db, { platform: platformName() });
      toast(t("cloud.uploaded", { n: r.counts.recipes }));
    });

  const restoreCopy = (c) =>
    run("restore", async () => {
      const bundle = await downloadCloudBackup(c.name);
      await restoreFrom(bundle, t("cloud.origin", { d: fmtDate(c.at, lang) }));
    });

  const removeCopy = (c) =>
    run("cloud", async () => {
      if (!(await confirm(t("cloud.confirmDelete", { n: fmtDate(c.at, lang) })))) return;
      await deleteCloudBackup(c.name);
      toast(t("cloud.deleted"));
    });

  const unlink = async () => {
    if (!(await confirm(t("kdrive.disconnectConfirm")))) return;
    forgetKdrive();
    forgetBackupState();
    setLinked(false);
    setCopies(null);
  };

  const toggleAuto = (on) => {
    setAutoBackupEnabled(on);
    setAuto(on);
  };

  return (
    <>
      <GeminiCard run={run} busy={busy} />

      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid="cloud-section">
        <div style={{ ...label, color: COLORS.text }}>☁️ {t("cloud.cloud")}</div>
        {/* navigator.onLine peut se tromper dans une WebView : simple avis, rien n'est bloqué. */}
        {!online && <div style={{ ...para, color: COLORS.amberText }}>{t("cloud.offline")}</div>}
        {!linked ? (
          <KdriveConnect run={run} busy={busy} onConnected={() => setLinked(true)} />
        ) : (
          <>
            <div style={{ ...para, color: COLORS.muted }}>{t("cloud.cloudHow", { keep: KEEP })}</div>
            <div style={{ fontSize: 12, color: COLORS.muted }} data-testid="cloud-last">
              {t("cloud.last")}
              <strong style={{ color: COLORS.text }}>{last.at ? fmtDate(last.at, lang) : t("common.none")}</strong>
            </div>
            {/* Ligne à part, toujours présente dès qu'une copie existe : l'empreinte
                arrive un peu après le rendu, et un texte qui s'ajoute en bout de
                ligne fait sauter la mise en page (et rater un appui sur le bouton
                en dessous — vu en test). */}
            {last.at && (
              <div style={{ fontSize: 12, minHeight: 18, fontWeight: 700, color: !fingerprint ? COLORS.faint : fingerprint === last.fingerprint ? COLORS.green : COLORS.amberText }} data-testid="cloud-state">
                {!fingerprint ? "…" : fingerprint === last.fingerprint ? t("cloud.upToDate") : t("cloud.changed")}
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.text, cursor: "pointer" }}>
              <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} style={{ width: 18, height: 18 }} data-testid="cloud-auto" />
              {t("cloud.auto")}
            </label>
            {auto && (
              <div style={{ fontSize: 12, color: autoState?.reason === "error" ? COLORS.danger : COLORS.muted, marginTop: -4 }} data-testid="cloud-auto-state">
                {t("cloud.autoCheck")}
                {autoState ? (
                  <>
                    {AUTO_REASONS.has(autoState.reason) ? t(`cloud.autoReason.${autoState.reason}`) : autoState.reason}{autoState.reason === "error" ? autoState.error : ""}
                    {autoState.at ? ` (${fmtDate(autoState.at, lang).slice(11)})` : ""}
                  </>
                ) : t("cloud.autoNever")}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btnP} onClick={backupNow} disabled={!!busy} data-testid="cloud-backup-now">{busy === "cloud" ? "…" : t("cloud.backupNow")}</button>
              <button style={btnS} onClick={unlink} disabled={!!busy} data-testid="kdrive-disconnect">{t("kdrive.disconnect")}</button>
            </div>
            {listError && <div style={{ fontSize: 12, color: COLORS.danger }}>{t("cloud.listError")}{listError}</div>}
            {copies && copies.length === 0 && <div style={{ fontSize: 13, color: COLORS.faint }} data-testid="cloud-empty">{t("cloud.listEmpty")}</div>}
            {copies && copies.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="cloud-list">
                {copies.map((c) => (
                  <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.text }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.at ? fmtDate(c.at, lang) : c.name}{c.size ? ` · ${fmtSize(c.size)}` : ""}
                    </span>
                    <span style={{ display: "flex", gap: 6, flex: "none" }}>
                      <button type="button" style={{ ...btnS, padding: "4px 10px", fontSize: 12, minHeight: 36 }} onClick={() => restoreCopy(c)} disabled={!!busy} data-testid="cloud-restore">{t("common.restore")}</button>
                      <button type="button" className="action-btn danger" onClick={() => removeCopy(c)} disabled={!!busy} title={t("common.delete")} aria-label={t("common.delete")} data-testid="cloud-delete">🗑️</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
