// Liste des brassins et formulaire de création (recette existante ou créée à
// la volée, brassin en chaîne). Porté de app/app/batches/page.jsx.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Loading from "@/app/components/Loading";
import StarRating from "@/app/components/StarRating";
import { RECIPE_TYPES, typeLabel } from "@/lib/recipeTypes";
import { useToast, useConfirm } from "@/lib/UiContext";
import { computePhaseTiming, phaseTimingLabel, PHASE_TIMING_TONES } from "@/lib/phaseTiming";
import { inp, btnP, btnSLink as btnS, badge, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { listBatches, createBatchForRecipe, createRecipeOnTheFly, listBatchLines, getBatch } from "../data/batches.js";
import { listRecipes } from "../data/recipes.js";
import { stockSnapshot } from "../data/stockOperations.js";
import { useStockOps } from "../hooks/useStockOps.js";
import { reconcileReminders } from "../platform/reminders.js";
import { useT } from "@/lib/i18n/useT";

const STATUS_COLORS = { planifie: COLORS.muted, en_cours: COLORS.green, degustation: COLORS.amber, archive: COLORS.faint };
const NEW_RECIPE = "__new__";

export default function BatchesList() {
  const router = useRouter();
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const ops = useStockOps(db);
  const STATUS_LABELS = {
    planifie: t("common.planned"),
    en_cours: t("common.inProgress"),
    degustation: t("common.tasting"),
    archive: t("common.archived"),
  };
  const [batches, setBatches] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [title, setTitle] = useState("");
  const [volume, setVolume] = useState("");
  const [starterFrom, setStarterFrom] = useState("");
  const [starterVolume, setStarterVolume] = useState("");
  const [newRecipeTitle, setNewRecipeTitle] = useState("");
  const [newRecipeType, setNewRecipeType] = useState("kefir_eau");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const blocked = ops.busy;

  const targetVolume = Number(volume) || 0;
  const reusedVolume = Number(starterVolume) || 0;
  const waterToAdd = targetVolume > 0 && reusedVolume > 0 ? Math.round((targetVolume - reusedVolume) * 100) / 100 : null;
  const starterExcessive = Boolean(starterFrom) && reusedVolume > 0 && targetVolume > 0 && reusedVolume >= targetVolume;

  const load = async () => {
    setBatches(await listBatches(db));
    setRecipes(await listRecipes(db));
    setLoaded(true);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const pickRecipe = (id) => {
    setRecipeId(id);
    if (id === NEW_RECIPE) {
      setTitle("");
      setVolume("");
      return;
    }
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe) return;
    const count = batches.filter((b) => b.recipe_id === id).length;
    setTitle(`${recipe.title} #${count + 1}`);
    setVolume(recipe.batch_size_ref ? String(recipe.batch_size_ref) : "");
  };

  const createBatch = async (e) => {
    e.preventDefault();
    if (blocked) return;
    const creatingRecipe = recipeId === NEW_RECIPE;
    if (!recipeId) return;
    if (creatingRecipe && !newRecipeTitle.trim()) return;
    if (!creatingRecipe && !title.trim()) return;
    if (starterExcessive) return;
    const batch = await ops.act(async () => {
      const recipe = creatingRecipe
        ? await createRecipeOnTheFly(db, { title: newRecipeTitle, type: newRecipeType, volume, lang })
        : recipes.find((r) => r.id === recipeId);
      if (!recipe) throw new Error(t("common.recipeNotFound"));
      return createBatchForRecipe(db, {
        recipe,
        title: title.trim() || recipe.title,
        volume,
        starter: starterFrom && reusedVolume > 0 ? { batchId: starterFrom, volume: reusedVolume } : null,
        lang,
      });
    });
    if (!batch) return;
    setShowForm(false);
    setRecipeId("");
    setTitle("");
    setVolume("");
    setStarterFrom("");
    setStarterVolume("");
    setNewRecipeTitle("");
    if (creatingRecipe) return router.push(`/app/batches/${batch.id}`);
    toast(t("batches.batchCreated"));
    load();
  };

  const removeBatch = async (e, id) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (blocked) return;
    const current = await getBatch(db, id);
    if (!current) return load();
    const lines = await listBatchLines(db, id);
    const lots = batches.filter((x) => x.parent_batch_id === id).length;
    const rolled = batches.filter((x) => x.starter_batch_id === id).length;
    const kin = [
      lots ? t("batches.splitLots", { count: lots }) : null,
      rolled ? t("batches.rolledBatches", { count: rolled }) : null,
    ].filter(Boolean);
    const kinNote = kin.length ? t("batches.kinNote2", { kin: kin.join(t("common.and")) }) : "";
    const legacyNoRestock = lines.some((line) => line.deducted && !line.stock_movement_id);
    const legacyNote = legacyNoRestock
      ? (t("batches.thisActionWillNotReturn"))
      : "";
    if (!(await confirm((t("batches.deleteBatchRecordedDeductionsWill", { title: current.title })) + kinNote + legacyNote))) return;
    const names = new Map(lines.map((l) => [l.id, l.name]));
    const result = await ops.run("batch_remove", { batchId: id, expectedRevision: current.stock_revision, expectedLines: stockSnapshot(lines), ...(legacyNoRestock ? { legacyNoRestock: true } : {}) });
    await load();
    reconcileReminders(db);
    if (!result) return;
    const restorations = result.movements.filter((m) => m.action === "batch_restore");
    const restored = restorations.filter((m) => Number(m.delta) > 0).length;
    const incompatible = restorations.filter((m) => Number(m.delta) === 0 && m.reason === "incompatible_unit").map((m) => names.get(m.line_id) || "?");
    if (incompatible.length) {
      toast(t("batches.batchDeletedIncompatible2", { restored, names: incompatible.join(", ") }));
    } else {
      toast(restored > 0 ? (t("batches.batchDeletedIngredientSReturned2", { restored })) : (t("batches.batchDeleted2")));
    }
  };

  if (!loaded) return <Loading />;

  let filtered = batches;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((b) => b.title.toLowerCase().includes(q) || b.recipes?.title?.toLowerCase().includes(q));
  }
  if (filterStatus) filtered = filtered.filter((b) => b.status === filterStatus);
  const hasFilters = search.trim() || filterStatus;
  const starterSources = batches.filter((b) => b.status !== "planifie");
  const now = new Date();
  const byId = new Map(batches.map((x) => [x.id, x]));

  return (
    <MobileShell
      title={t("common.batches")}
      actions={
        <button style={btnP} disabled={blocked} onClick={() => setShowForm((v) => !v)} data-testid="batch-new">
          {t("batches.new")}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={createBatch} style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <select id="batch-recipe" style={inp} value={recipeId} onChange={(e) => pickRecipe(e.target.value)} required data-testid="batch-recipe">
            <option value="">{t("batches.selectARecipe")}</option>
            <option value={NEW_RECIPE}>{t("batches.newRecipe")}</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          {recipeId === NEW_RECIPE && (
            <>
              <input style={inp} placeholder={t("common.recipeTitle")} value={newRecipeTitle} onChange={(e) => setNewRecipeTitle(e.target.value)} required />
              <select style={inp} value={newRecipeType} onChange={(e) => setNewRecipeType(e.target.value)}>
                {Object.entries(RECIPE_TYPES).map(([key, rt]) => <option key={key} value={key}>{rt.icon} {typeLabel(key, lang)}</option>)}
              </select>
              <div style={{ fontSize: 11, color: COLORS.faint }}>
                {t("batches.defaultPhasesForThisType2")}
              </div>
            </>
          )}
          <input style={inp} placeholder={t("common.batchName")} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="batch-title" />
          <input style={inp} type="number" step="any" placeholder="Volume (L)" value={volume} onChange={(e) => setVolume(e.target.value)} data-testid="batch-volume" />
          {starterSources.length > 0 && (
            <div style={{ background: COLORS.row, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="batch-starter-source" style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted }}>
                <span aria-hidden="true">♻️ </span>
                {t("batches.startedWithLiquidFromA")}
              </label>
              <select id="batch-starter-source" style={inp} value={starterFrom} onChange={(e) => setStarterFrom(e.target.value)}>
                <option value="">{t("batches.noStartingFromScratch")}</option>
                {starterSources.map((b) => <option key={b.id} value={b.id}>{b.title}{b.volume ? ` · ${b.volume} L` : ""}</option>)}
              </select>
              {starterFrom && (
                <>
                  <input id="batch-starter-volume" style={inp} type="number" step="any" min="0" placeholder={t("batches.reusedVolumeL")} value={starterVolume} onChange={(e) => setStarterVolume(e.target.value)} />
                  {starterExcessive ? (
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.danger, lineHeight: 1.5 }}>
                      {t("batches.reusedLiquidHasToStay2", { targetVolume })}
                    </div>
                  ) : (
                    waterToAdd != null && (
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text, lineHeight: 1.5 }}>
                        {t("batches.waterToAddL", { waterToAdd })}
                        <div style={{ fontSize: 11.5, fontWeight: 500, color: COLORS.faint, marginTop: 2 }}>
                          {t("batches.sugarAndTheRestStay", { targetVolume })}
                        </div>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}
          <button type="submit" style={btnP} disabled={blocked} data-testid="batch-create">{t("batches.createBatch2")}</button>
        </form>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...inp, flex: 1, minWidth: 0 }} placeholder={t("batches.searchBatch2")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inp, width: "auto", flex: "none" }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label={t("batches.status")}>
          <option value="">{t("batches.allStatuses")}</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {hasFilters && (
        <button style={{ ...btnS, fontSize: 12, padding: "5px 12px", marginBottom: 10 }} onClick={() => { setSearch(""); setFilterStatus(""); }}>
          {t("common.clearFilters")}
        </button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ ...card, textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🧪</div>
            <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
              {batches.length === 0 ? (t("batches.noBatchesYetPickA2")) : (t("common.noResultsWithTheseFilters"))}
            </div>
          </div>
        )}
        {filtered.map((b) => {
          const parent = b.parent_batch_id ? byId.get(b.parent_batch_id) : null;
          const starter = b.starter_batch_id ? byId.get(b.starter_batch_id) : null;
          const lineage = parent ? (t("batches.lotOf", { title: parent.title })) : starter ? (t("batches.rolledFrom", { title: starter.title })) : "";
          const timing = b.status === "en_cours" ? computePhaseTiming(b.phase_started_at, b.recipe_phases?.duration_value, b.recipe_phases?.duration_unit, now) : { status: "unknown" };
          const timingLabel = phaseTimingLabel(timing, lang);
          return (
            <div key={b.id} data-testid="batch-card" style={{ ...card, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Link href={`/app/batches/${b.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{b.title}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted }}>
                    {b.recipes?.title}
                    {b.volume ? ` · ${b.volume}L` : ""}
                    {lineage ? ` · ${lineage}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: "50%" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.35, textAlign: "right", color: STATUS_COLORS[b.status] || COLORS.green }}>
                    {STATUS_LABELS[b.status]}
                    {b.status === "en_cours" && b.recipe_phases?.name ? ` · ${b.recipe_phases.name}` : ""}
                  </div>
                  {timingLabel && <span style={{ ...badge(PHASE_TIMING_TONES[timing.status].color, PHASE_TIMING_TONES[timing.status].bg), whiteSpace: "nowrap" }}>{timingLabel}</span>}
                  {b.rating && <StarRating value={b.rating} size={13} />}
                </div>
              </Link>
              <button className="action-btn danger" disabled={blocked} onClick={(e) => removeBatch(e, b.id)} title={t("batches.deleteThisBatch2")} aria-label={t("common.delete2", { title: b.title })}>
                🗑️ <span className="btn-label">{t("common.delete")}</span>
              </button>
            </div>
          );
        })}
      </div>
    </MobileShell>
  );
}
