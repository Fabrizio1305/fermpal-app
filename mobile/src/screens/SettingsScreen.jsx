// Paramètres : apparence, langue, compte FermPal et sauvegarde en ligne (lot
// L4), rappels de phase, sauvegarde (export portable, restauration vérifiée,
// copies de secours automatiques), données de démonstration (300 recettes
// synthétiques) et version de l'app.
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import Link from "next/link";
import { parseIngredientsCSV } from "@/lib/csvImport";
import { useLang } from "@/lib/LangContext";
import { LANG_FLAGS, LANG_NAMES, SUPPORTED_LANGS, localeFor } from "@/lib/i18n";
import { getStoredTheme, setTheme, THEMES } from "../platform/theme.js";
import { useToast, useConfirm } from "@/lib/UiContext";
import { btnP, btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import CloudSection from "../components/CloudSection.jsx";
import { useDb } from "../App.jsx";
import { DATA_TABLES } from "../db/schema.js";
import { currentSchemaVersion } from "../db/migrations.js";
import { openTempDatabase, platformName } from "../db/openDatabase.js";
import { buildExportBundle, verifyBundle, restoreBundle } from "../data/exportImport.js";
import { seedSyntheticRecipes, deleteSyntheticRecipes } from "../data/seed.js";
import { exportToFile, readJsonFile } from "../platform/files.js";
import { listBackups, readBackup, saveBackup } from "../platform/backups.js";
import { remindersStatus, enableReminders, disableReminders, reconcileReminders } from "../platform/reminders.js";
import { useStockOps } from "../hooks/useStockOps.js";
import { nativeInfo, recentErrors, recordError, withTimeout } from "../platform/diagnostics.js";
import { useT } from "@/lib/i18n/useT";

function fmtSize(n) {
  if (n == null) return "";
  return n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} kB`;
}

function fmtDate(ms, lang) {
  if (!ms) return "";
  return new Date(ms).toLocaleString(localeFor(lang), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Groupe de boutons exclusifs (apparence, langue) : le choix courant en vert.
function Choice({ options, value, onChange, testId }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          style={o.value === value ? { ...btnP, padding: "8px 14px" } : { ...btnS, padding: "8px 14px" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsScreen() {
  const { db } = useDb();
  const { lang, setLang } = useLang();
  const [theme, setThemeState] = useState(getStoredTheme);
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = useState(null);
  const [backups, setBackups] = useState([]);
  const [reminders, setReminders] = useState(null);
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);
  const csvRef = useRef(null);
  const ops = useStockOps(db);

  const onCsvFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let rows;
    try {
      rows = parseIngredientsCSV(await file.text());
    } catch {
      return toast(t("common.cannotReadThisCsvFile"), "error");
    }
    if (rows.length === 0) return toast(t("common.noValidRowsFoundIn"), "error");
    if (rows.length > 500) return toast(t("settings.importsAreLimitedTo500"), "error");
    if (!(await confirm(t("common.importIngredientSIntoStock", { rowsLength: rows.length })))) return;
    const result = await ops.run("stock_create", { rows });
    await refresh();
    if (result) toast(t("settings.ingredientSImportedIntoStock", { stocksLength: result.stocks.length }));
  };

  const refresh = async () => {
    const counts = {};
    for (const table of DATA_TABLES) counts[table] = Number((await db.query(`select count(*) as c from ${table}`))[0].c);
    const synthetic = Number((await db.query("select count(*) as c from recipes where source_type = 'synthetic'"))[0].c);
    setStats({ counts, synthetic, schemaVersion: await currentSchemaVersion(db), platform: platformName() });
    setBackups(await listBackups().catch(() => []));
    if (Capacitor.isNativePlatform()) {
      setReminders({ available: true, checking: true, pending: [], planned: [] });
      const res = await withTimeout(remindersStatus(db, lang), 4000);
      if (res.ok) setReminders(res.value);
      else setReminders({ available: true, enabled: false, permission: "?", pending: [], planned: [], error: res.timeout ? (t("settings.theNotificationsPluginDoesNot")) : (res.error?.message || String(res.error)) });
    } else {
      setReminders({ available: false });
    }
  };

  const toggleReminders = () =>
    run("reminders", async () => {
      if (reminders?.enabled) {
        await disableReminders();
        toast(t("settings.remindersOff"));
      } else {
        const res = await enableReminders(db, lang);
        if (res === "granted") toast(t("settings.remindersOn"));
        else toast(t("settings.notificationsNotAllowedAllowThem", { res }), "error");
      }
    });

  const replanReminders = () =>
    run("reminders", async () => {
      const r = await reconcileReminders(db, lang);
      toast(r.error ? (t("settings.recalculationFailed")) + r.error : (t("settings.remindersRecalculatedScheduledCancelled", { scheduled: r.scheduled, cancelled: r.cancelled })), r.error ? "error" : "info");
    });

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const run = async (label, fn) => {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      // Le message va au toast ; le détail (statut HTTP, code) au bloc Diagnostic.
      recordError(`action:${label}`, err);
      toast((t("common.error")) + (err?.message || String(err)), "error");
    } finally {
      setBusy("");
      await refresh();
    }
  };

  const doExport = () =>
    run("export", async () => {
      const bundle = await buildExportBundle(db, { platform: platformName() });
      const res = await exportToFile(bundle, { title: t("settings.fermpalNotebookExport") });
      if (!res.cancelled) toast(t("common.exportReady", { fileName: res.fileName }));
    });

  const restoreFrom = async (bundle, origin) => {
    const check = await verifyBundle(bundle);
    const c = check.counts;
    const ok = await confirm(
      t("settings.replaceNotebookConfirm", { origin, recipes: c.recipes, phases: c.recipe_phases, lines: c.recipe_ingredients, versions: c.recipe_versions, date: fmtDate(Date.parse(bundle.exportedAt), lang) }),
    );
    if (!ok) return;
    const counts = await restoreBundle(db, bundle, {
      openTempDb: openTempDatabase,
      backup: (current) => saveBackup("avant-restauration", current),
      platform: platformName(),
    });
    toast(t("settings.notebookRestoredRecipes", { recipes: counts.recipes }));
  };

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    run("restore", async () => {
      const bundle = await readJsonFile(file);
      await restoreFrom(bundle, t("settings.file", { name: file.name }));
    });
  };

  const restoreBackup = (b) => run("restore", async () => restoreFrom(await readBackup(b.name), t("settings.backup", { name: b.name })));

  const seed = () =>
    run("seed", async () => {
      if (!(await confirm(t("settings.load300DemoRecipesInto")))) return;
      const started = performance.now();
      const n = await seedSyntheticRecipes(db, { count: 300 });
      toast(t("settings.recipesLoadedIn", { n, seconds: ((performance.now() - started) / 1000).toFixed(1) }));
    });

  const unseed = () =>
    run("unseed", async () => {
      if (!(await confirm(t("settings.removeAllDemoRecipesYour")))) return;
      const n = await deleteSyntheticRecipes(db);
      toast(t("settings.demoRecipesRemoved", { n }));
    });

  const native = Capacitor.isNativePlatform();

  return (
    <MobileShell title={t("common.settings")}>
      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("settings.appearance")}</div>
        <Choice
          testId="theme-choice"
          value={theme}
          onChange={(v) => setThemeState(setTheme(v))}
          options={THEMES.map((th) => ({ value: th, label: t(`settings.theme.${th}`) }))}
        />
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginTop: 4 }}>{t("settings.language")}</div>
        <Choice
          testId="lang-choice"
          value={lang}
          onChange={setLang}
          options={SUPPORTED_LANGS.map((l) => ({ value: l, label: `${LANG_FLAGS[l]} ${LANG_NAMES[l]}` }))}
        />
      </div>

      <CloudSection db={db} run={run} busy={busy} restoreFrom={restoreFrom} fmtDate={fmtDate} fmtSize={fmtSize} />

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>{t("settings.thisNotebook")}</div>
        {stats ? (
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.8 }}>
            {DATA_TABLES.map((table) => (
              <div key={table}>
                <strong style={{ color: COLORS.text }} data-testid={`stats-${table}`}>{stats.counts[table]}</strong> {t(`settings.tables.${table}`)}
                {table === "recipes" && stats.synthetic > 0 ? (t("settings.inclDemo", { synthetic: stats.synthetic })) : ""}
              </div>
            ))}
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {t("settings.localSqliteDatabaseSchemaV")}{stats.schemaVersion} · {stats.platform}
              {" · "}
              {t("settings.theNotebookStaysOnThis")}
            </div>
            <div style={{ fontSize: 12, color: COLORS.faint }} data-testid="app-build">
              {t("settings.appBuild")}
              <code>{import.meta.env.VITE_APP_COMMIT}</code> · {import.meta.env.VITE_APP_BUILT_AT}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: COLORS.faint }}>…</div>
        )}
      </div>

      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("settings.exportRestore")}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
          {t("settings.anExportIsAComplete")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnP} onClick={doExport} disabled={!!busy} data-testid="export-button">
            {busy === "export" ? "…" : native ? t("settings.exportShare") : t("settings.exportNotebook")}
          </button>
          <button style={btnS} onClick={() => fileRef.current?.click()} disabled={!!busy}>
            {busy === "restore" ? "…" : (t("settings.restoreFromAFile"))}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFilePicked} style={{ display: "none" }} data-testid="restore-input" />
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("settings.automaticBackups")}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
          {t("settings.createdBeforeADatabaseUpdate")}
        </div>
        {backups.length === 0 ? (
          <div style={{ fontSize: 13, color: COLORS.faint }} data-testid="backups-empty">{t("settings.noBackupYet")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="backups-list">
            {backups.map((b) => (
              <div key={b.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.text }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.name.replace(/\.json$/, "")} {b.size ? `· ${fmtSize(b.size)}` : ""}
                </span>
                <button type="button" style={{ ...btnS, padding: "4px 10px", fontSize: 12, minHeight: 36 }} onClick={() => restoreBackup(b)} disabled={!!busy}>
                  {t("common.restore")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("settings.import")}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
          {t("settings.aRecipeInBeerxmlFormat")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/app/recipes/import" style={{ ...btnS, textDecoration: "none" }} data-testid="settings-beerxml">📥 {t("settings.beerxmlRecipe")}</Link>
          <button style={btnS} onClick={() => csvRef.current?.click()} disabled={!!busy || ops.busy}>📄 {t("settings.stockFromACsv")}</button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onCsvFile} style={{ display: "none" }} data-testid="csv-input" />
        </div>
      </div>

      {reminders?.available && (
        <div style={{ ...card, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid="reminders-settings">
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>🔔 {t("common.phaseReminders")}</div>
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
            {t("settings.aNotificationAtTheEnd")}
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {reminders.checking ? (t("settings.checking")) : (
                <>
                  {t("settings.status")}<strong style={{ color: COLORS.text }}>{reminders.enabled ? (t("settings.on")) : (t("settings.off"))}</strong>
                  {" · "}{t("settings.permission")}{reminders.permission}
                  {" · "}{reminders.pending.length} {t("settings.scheduled")} / {reminders.planned.length} {t("settings.expected")}
                </>
              )}
            </div>
            {reminders.error && <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 4, fontFamily: "monospace" }}>{reminders.error}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={reminders.enabled ? btnS : btnP} onClick={toggleReminders} disabled={!!busy} data-testid="reminders-toggle">
              {reminders.enabled ? (t("settings.disableReminders")) : (t("common.enableReminders"))}
            </button>
            {reminders.enabled && (
              <button style={btnS} onClick={replanReminders} disabled={!!busy}>{t("settings.recalculate")}</button>
            )}
          </div>
        </div>
      )}

      <details style={{ ...card, marginBottom: 12 }} data-testid="diagnostics">
        <summary style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, cursor: "pointer" }}>🩺 {t("settings.diagnostics")}</summary>
        {(() => {
          const info = nativeInfo();
          const errs = recentErrors();
          return (
            <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.7, marginTop: 8, fontFamily: "monospace", wordBreak: "break-word" }}>
              <div>platform: {info.platform} · native: {String(info.native)}</div>
              <div>{t("settings.nativePlugins")}{Object.entries(info.plugins).map(([k, v]) => `${k}=${v ? "oui" : "NON"}`).join(" · ")}</div>
              <div>{t("settings.registered")}{info.registered.length ? info.registered.join(", ") : "—"}</div>
              <div>lang: {lang} · theme: {theme} · data-theme: {document.documentElement.getAttribute("data-theme") || "—"} · --fp-bg: {getComputedStyle(document.documentElement).getPropertyValue("--fp-bg").trim() || "—"}</div>
              <div>navigator.onLine: {String(info.online)} · {t("settings.build")}{import.meta.env.VITE_APP_COMMIT}</div>
              <div>{t("settings.recentErrors")}{errs.length === 0 ? (t("common.none")) : ""}</div>
              {errs.map((e, i) => <div key={i} style={{ color: COLORS.danger }}>{e.at} [{e.kind}] {e.message}</div>)}
              <div style={{ color: COLORS.faint }}>{info.userAgent}</div>
            </div>
          );
        })()}
      </details>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("settings.demoData")}</div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
          {t("settings.300SyntheticRecipes13Drink")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnS} onClick={seed} disabled={!!busy} data-testid="seed-button">
            {busy === "seed" ? "…" : (t("settings.load300DemoRecipes"))}
          </button>
          {stats?.synthetic > 0 && (
            <button className="action-btn danger" onClick={unseed} disabled={!!busy} data-testid="unseed-button">
              🗑️ <span className="btn-label">{t("settings.removeDemoRecipes")}</span>
            </button>
          )}
        </div>
      </div>
    </MobileShell>
  );
}
