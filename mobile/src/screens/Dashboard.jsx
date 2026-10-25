// Écran d'arrivée : « qu'est-ce qui demande mon attention maintenant ».
// Porté de app/app/page.jsx ; les rappels Web Push deviennent des rappels
// locaux (RemindersCard).
import { useEffect, useState } from "react";
import Link from "next/link";
import Loading from "@/app/components/Loading";
import { computePhaseTiming, phaseTimingLabel, PHASE_TIMING_TONES } from "@/lib/phaseTiming";
import { badge, btnPLink as btnP, btnSLink as btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import RemindersCard from "../components/RemindersCard.jsx";
import { useDb } from "../App.jsx";
import { listBatches } from "../data/batches.js";
import { useT } from "@/lib/i18n/useT";


const URGENCY_RANK = { overdue: 0, due_soon: 1, ontime: 2, unknown: 3 };

function BatchRow({ href, title, subtitle, timing, timingLabel }) {
  return (
    <Link href={href} style={{ ...card, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", textDecoration: "none", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: COLORS.muted }}>{subtitle}</div>}
      </div>
      {timingLabel && (
        <span style={{ ...badge(PHASE_TIMING_TONES[timing.status].color, PHASE_TIMING_TONES[timing.status].bg), whiteSpace: "nowrap" }}>{timingLabel}</span>
      )}
    </Link>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.green, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

export default function Dashboard() {
  const { db } = useDb();
  const [batches, setBatches] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const { t, lang } = useT();

  useEffect(() => {
    let active = true;
    listBatches(db, { includeArchived: false }).then((rows) => {
      if (!active) return;
      setBatches(rows);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [db]);

  if (!loaded) return <Loading />;

  const now = new Date();
  const running = batches
    .filter((b) => b.status === "en_cours")
    .map((b) => {
      const timing = computePhaseTiming(b.phase_started_at, b.recipe_phases?.duration_value, b.recipe_phases?.duration_unit, now);
      return { ...b, timing, timingLabel: phaseTimingLabel(timing, lang) };
    })
    .sort((a, b) => {
      const rank = URGENCY_RANK[a.timing.status] - URGENCY_RANK[b.timing.status];
      if (rank !== 0) return rank;
      if (a.timing.hoursRemaining === null || b.timing.hoursRemaining === null) return 0;
      return a.timing.hoursRemaining - b.timing.hoursRemaining;
    });
  const planned = batches.filter((b) => b.status === "planifie");
  const tasting = batches.filter((b) => b.status === "degustation");
  const isEmpty = batches.length === 0;

  return (
    <MobileShell title={t("common.dashboard")}>
      {!isEmpty && <RemindersCard />}

      {isEmpty && (
        <div style={{ ...card, textAlign: "center", padding: 28 }} data-testid="dashboard-empty">
          <div style={{ fontSize: 28, marginBottom: 8 }}>🫙</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>{t("dashboard.emptyTitle")}</div>
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6, marginBottom: 16 }}>{t("dashboard.emptyDesc2")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
            <Link href="/app/batches" style={{ ...btnP, textAlign: "center" }}>{t("dashboard.newBatch")}</Link>
            <Link href="/app/recipes/new" style={{ ...btnS, textAlign: "center" }}>{t("dashboard.newRecipe")}</Link>
          </div>
        </div>
      )}

      {running.length > 0 && (
        <Section label={t("dashboard.running")}>
          {running.map((b) => (
            <BatchRow key={b.id} href={`/app/batches/${b.id}`} title={b.title} subtitle={b.recipe_phases?.name || t("dashboard.noPhase")} timing={b.timing} timingLabel={b.timingLabel} />
          ))}
        </Section>
      )}
      {planned.length > 0 && (
        <Section label={t("dashboard.planned")}>
          {planned.map((b) => <BatchRow key={b.id} href={`/app/batches/${b.id}`} title={b.title} subtitle={b.recipes?.title} />)}
        </Section>
      )}
      {tasting.length > 0 && (
        <Section label={t("dashboard.tasting")}>
          {tasting.map((b) => <BatchRow key={b.id} href={`/app/batches/${b.id}`} title={b.title} subtitle={b.recipes?.title} />)}
        </Section>
      )}
      {!isEmpty && (
        <Link href="/app/batches" style={{ fontSize: 13, color: COLORS.muted, textDecoration: "none" }}>{t("dashboard.allBatches2")}</Link>
      )}
    </MobileShell>
  );
}
