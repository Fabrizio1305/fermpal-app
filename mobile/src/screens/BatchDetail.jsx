// Fiche d'un brassin. Porté de app/app/batches/[id]/page.jsx : phases et
// échéance, ingrédients à cocher (prélèvement de stock), volume, séparation
// en lots, relance en chaîne, comparaison des lots, report en recette, outils
// F2/pH, journal, avancement, dégustation (enregistrée à la saisie — W09).
// Toutes les écritures passent par la couche données locale.
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { localeFor } from "@/lib/i18n";
import BatchIngredientModal from "@/app/components/BatchIngredientModal";
import LinkToStockModal from "@/app/components/LinkToStockModal";
import Loading from "@/app/components/Loading";
import SaveRecipeChangesModal from "@/app/components/SaveRecipeChangesModal";
import SimpleCombobox from "@/app/components/SimpleCombobox";
import SplitBatchModal from "@/app/components/SplitBatchModal";
import StarRating from "@/app/components/StarRating";
import StockAdjustModal from "@/app/components/StockAdjustModal";
import CarbonationCalculator from "@/components/tools/CarbonationCalculator";
import PhGuide from "@/components/tools/PhGuide";
import { diffBatchFromRecipe, scaleRatio } from "@/lib/batchRecipeDiff";
import { findStockItem } from "@/lib/ingredientMatcher";
import { computePhaseTiming, phaseTimingLabel } from "@/lib/phaseTiming";
import { durationUnits } from "@/lib/recipeTypes";
import { dilutionWaterTarget, nextBatchTitle, withoutStarterAdjustment } from "@/lib/rollingBatch";
import { convertAmount } from "@/lib/units";
import { useToast, useConfirm } from "@/lib/UiContext";
import { COLORS, badge, card, inp, btnP, btnSLink as btnS } from "@/lib/uiStyles";
import { MobileMenu } from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import {
  getBatchFull, createBatchForRecipe, startBatch, nextPhase as nextPhaseOp, archiveBatch, saveTasting, renameBatch,
  addJournalEntry, updateLogDate, deleteLog as deleteLogOp, addBatchIngredient, upsertAlias, saveBatchAsNewVersion, saveBatchAsNewRecipe,
} from "../data/batches.js";
import { addShoppingRows } from "../data/shopping.js";
import { stockSnapshot } from "../data/stockOperations.js";
import { useStockOps } from "../hooks/useStockOps.js";
import { reconcileReminders } from "../platform/reminders.js";
import { useT } from "@/lib/i18n/useT";

const toolSummary = { fontSize: 13, fontWeight: 600, color: COLORS.text, cursor: "pointer", listStyle: "none" };
const editableAmount = { fontSize: 13, fontWeight: 700, color: COLORS.text, background: "none", border: "none", padding: 0, cursor: "pointer", borderBottom: "1px dashed currentColor", fontFamily: "inherit" };
const removeBtn = { fontSize: 13, color: COLORS.faint, background: "none", border: "none", padding: "4px 6px", cursor: "pointer", lineHeight: 1 };
const shoppingBtn = { fontSize: 12, fontWeight: 600, color: COLORS.text, background: COLORS.bg, border: `1px solid ${COLORS.amber}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" };
const linkBtn = { fontSize: 11, color: COLORS.green, background: COLORS.greenSoft, border: `1px solid ${COLORS.greenSoftBorder}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontWeight: 600 };
const addIngredientBtn = { marginTop: 10, fontSize: 12, fontWeight: 600, color: COLORS.green, background: COLORS.greenSoft, border: `1px solid ${COLORS.greenSoftBorder}`, borderRadius: 8, padding: "9px 12px", cursor: "pointer" };
const ghostBtn = { background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 12, padding: "4px 0" };
const section = { ...card, marginBottom: 16 };

function fmt(ts, lang) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(localeFor(lang), { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString(localeFor(lang), { hour: "2-digit", minute: "2-digit" });
}

function toDatetimeLocal(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BatchDetail() {
  const params = useParams();
  const router = useRouter();
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const ops = useStockOps(db);
  const STATUS_LABELS = { planifie: t("common.planned"), en_cours: t("common.inProgress"), degustation: t("common.tasting"), archive: t("common.archived") };
  const JOURNAL_CATEGORIES = { observation: "Observation", gout: t("batch.taste"), probleme: t("batch.issue") };
  const DURATION_UNITS = durationUnits(lang);
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [rating, setRating] = useState(null);
  const [notes, setNotes] = useState("");
  const notesTimer = useRef(null);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [volumeInput, setVolumeInput] = useState("");
  const [rescaleOnVolumeChange, setRescaleOnVolumeChange] = useState(true);
  const [journalText, setJournalText] = useState("");
  const [journalCategory, setJournalCategory] = useState("observation");
  const [editingLog, setEditingLog] = useState(null);
  const [editingTitle, setEditingTitle] = useState(null);
  const [openPhases, setOpenPhases] = useState(null);
  const [ingredientModal, setIngredientModal] = useState(null);
  const [saveRecipeOpen, setSaveRecipeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [rollVolume, setRollVolume] = useState("");
  const blocked = ops.busy;

  const load = async () => {
    const full = await getBatchFull(db, params.id);
    setData(full);
    if (full) {
      setRating(full.batch.rating ?? null);
      setNotes(full.batch.notes || "");
      setVolumeInput(full.batch.volume == null ? "" : String(full.batch.volume));
    }
    setLoaded(true);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, params.id]);

  // Chaque geste : exécuter, recharger, puis recalculer les rappels locaux
  // (une phase a pu changer).
  const after = async () => {
    await load();
    reconcileReminders(db);
  };
  const runStock = async (kind, payload) => {
    const result = await ops.run(kind, payload);
    setIngredientModal(null);
    setAdjustTarget(null);
    setSplitOpen(false);
    await after();
    return result;
  };
  const act = async (fn) => {
    const r = await ops.act(fn);
    await after();
    return r;
  };

  if (!loaded) return <Loading />;
  if (!data) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: 20 }}>
        <p style={{ color: COLORS.text }}>{t("batch.thisBatchNoLongerExists")}</p>
        <Link href="/app/batches" style={btnS}>{t("batch.backToBatches2")}</Link>
      </div>
    );
  }

  const { batch, recipe, phases, recipeIngredients, lines: batchIngredients, stock, aliases, log, journal, lots, lotIngredients, parentBatch, starterSource, rolledInto } = data;
  const now = new Date();
  const stockFor = (name) => findStockItem(name, stock, aliases);
  const stockDelta = (bi, stockRow) => (stockRow ? convertAmount(bi.amount, bi.unit, stockRow.unit) : null);
  const shoppingShortfall = (bi) => {
    const { item: stockRow } = stockFor(bi.name);
    const amount = Number(bi.amount);
    if (!stockRow) return amount;
    const neededInStock = stockDelta(bi, stockRow);
    if (neededInStock == null) return amount;
    const lacking = neededInStock - Number(stockRow.quantity);
    if (lacking <= 0) return null;
    const inBatchUnit = convertAmount(lacking, stockRow.unit, bi.unit);
    return inBatchUnit == null ? amount : Math.round(inBatchUnit * 100) / 100;
  };

  const ratio = scaleRatio(batch.volume, recipe?.batch_size_ref);
  const recipeFacingIngredients = withoutStarterAdjustment(batchIngredients, batch.starter_volume);
  const diff = recipe ? diffBatchFromRecipe(recipeFacingIngredients, recipeIngredients, ratio) : { added: [], modified: [], removed: [], hasChanges: false };
  const splitRecipeMessage = t("batch.savingToARecipeIs3");
  const splitRecipeBlocked = batch.has_been_split || Boolean(batch.parent_batch_id) || lots.length > 0;

  // --- gestes ---------------------------------------------------------------

  const toggleIngredient = (bi) => {
    if (blocked) return;
    const { item: stockRow } = stockFor(bi.name);
    return runStock("batch_ingredient_set", {
      batchId: batch.id, lineId: bi.id, expectedRevision: bi.stock_revision, expectedBatchRevision: batch.stock_revision,
      deducted: !bi.deducted,
      ...(!bi.deducted ? { stockId: stockRow?.id ?? null, expectedStock: stockSnapshot(stock) } : legacyFlag([bi])),
    });
  };

  // Lignes historiques (importées) cochées sans trace : le renoncement doit
  // être explicite. Renvoie { legacyNoRestock: true } après confirmation, {}
  // sinon ; `null` si l'utilisateur refuse.
  function legacyFlag(affected) {
    return affected.some((l) => l.deducted && !l.stock_movement_id) ? { legacyNoRestock: true } : {};
  }
  const confirmLegacy = async (affected, question) => {
    const legacy = affected.some((l) => l.deducted && !l.stock_movement_id);
    if (!legacy && !question) return true;
    const note = legacy
      ? (t("batch.thisActionWillNotReturn"))
      : "";
    return confirm((question || (t("batch.continue"))) + note);
  };

  const saveIngredient = async (values) => {
    if (blocked) return;
    const editing = ingredientModal?.item;
    if (!editing) {
      await act(() => addBatchIngredient(db, batch.id, values));
      setIngredientModal(null);
      return;
    }
    if (!(await confirmLegacy([editing], null))) return;
    return runStock("batch_ingredient_edit", { batchId: batch.id, lineId: editing.id, expectedRevision: editing.stock_revision, expectedBatchRevision: batch.stock_revision, values, ...legacyFlag([editing]) });
  };

  const removeIngredient = async (bi) => {
    if (blocked) return;
    if (!(await confirmLegacy([bi], t("batch.removeFromThisBatch2", { name: bi.name })))) return;
    return runStock("batch_ingredient_remove", { batchId: batch.id, lineId: bi.id, expectedRevision: bi.stock_revision, expectedBatchRevision: batch.stock_revision, ...legacyFlag([bi]) });
  };

  const addToShoppingList = async (bi) => {
    if (blocked) return;
    const shortfall = shoppingShortfall(bi);
    if (shortfall == null) return toast(t("batch.isAlreadyInStockIn", { name: bi.name }));
    await ops.act(() => addShoppingRows(db, [{ name: bi.name, amount: shortfall, unit: bi.unit, category: bi.category || "autre", recipe_title: recipe?.title || batch.title }]));
    toast(t("batch.addedToTheShoppingList", { name: bi.name, shortfall, unit: bi.unit }));
  };

  const saveAlias = (alias, stockName) => act(async () => {
    await upsertAlias(db, alias, stockName);
    setLinkTarget(null);
  });

  const saveStockAdjust = (newQuantity) => {
    if (blocked || !adjustTarget) return;
    return adjustTarget.isNew
      ? runStock("stock_create", { rows: [{ name: adjustTarget.name, unit: adjustTarget.unit, category: adjustTarget.category || "autre", quantity: newQuantity }] })
      : runStock("stock_update", { stockId: adjustTarget.id, expectedRevision: adjustTarget.stock_revision, values: { quantity: newQuantity } });
  };

  const updateVolume = () => runStock("batch_resize", {
    batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(batchIngredients),
    expectedPhases: phases.map(({ id, sort_order }) => ({ id, sort_order })),
    volume: volumeInput ? Number(volumeInput) : null, rescale: rescaleOnVolumeChange, expectedBaseVolume: batch.volume || recipe?.batch_size_ref || null,
  });

  const splitBatch = async ({ lots: requested, splitAt }) => {
    const parentVolume = Number(batch.volume);
    const remaining = Math.round((parentVolume - requested.reduce((s, l) => s + Number(l.volume), 0)) * 100) / 100;
    if (!(parentVolume > 0) || !(remaining > 0)) return toast(t("batch.invalidVolumesNothingWasSplit"), "error");
    const date = new Date(splitAt);
    if (!Number.isFinite(date.getTime())) return toast(t("batch.invalidDate"), "error");
    const result = await runStock("batch_split", {
      batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(batchIngredients),
      expectedPhases: phases.map(({ id, sort_order }) => ({ id, sort_order })), lots: requested, splitAt: date.toISOString(),
    });
    if (result) toast(t("batch.lotSSplitOffRemaining", { lotsLength: result.lots.length, volume: result.batch.volume }));
  };

  const previousPhase = async () => {
    if (blocked || !["en_cours", "degustation"].includes(batch.status)) return;
    const affected = batch.status === "en_cours" ? batchIngredients.filter((l) => l.phase_id === batch.current_phase_id) : [];
    if (!(await confirmLegacy(affected, null))) return;
    const idx = phases.findIndex((p) => p.id === batch.current_phase_id);
    const target = batch.status === "degustation" ? phases.at(-1) : idx > 0 ? phases[idx - 1] : null;
    return runStock("batch_previous_phase", {
      batchId: batch.id, expectedRevision: batch.stock_revision, expectedLines: stockSnapshot(batchIngredients),
      expectedStage: { status: batch.status, current_phase_id: batch.current_phase_id },
      expectedPhases: phases.map(({ id, sort_order }) => ({ id, sort_order })),
      targetPhase: { status: target ? "en_cours" : "planifie", current_phase_id: target?.id ?? null },
      ...legacyFlag(affected),
    });
  };

  const start = () => act(() => startBatch(db, batch.id));
  const next = () => act(() => nextPhaseOp(db, batch.id));
  const archive = async () => {
    const activeLots = lots.filter((l) => l.status !== "archive").length;
    const lotsNote = activeLots ? (t("batch.itsActiveLotSWill", { activeLots })) : "";
    if (!(await confirm((t("batch.archiveTheBatchWillLeave2", { title: batch.title })) + lotsNote))) return;
    await act(() => archiveBatch(db, batch.id, { rating, notes }));
  };

  // Dégustation enregistrée dès la saisie (W09) : étoiles tout de suite,
  // notes après une courte pause de frappe.
  const changeRating = (v) => {
    setRating(v);
    saveTasting(db, batch.id, { rating: v, notes }).catch((err) => toast((t("common.error")) + err.message, "error"));
  };
  const changeNotes = (v) => {
    setNotes(v);
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      saveTasting(db, batch.id, { rating, notes: v }).catch((err) => toast((t("common.error")) + err.message, "error"));
    }, 400);
  };

  const addJournal = () => act(async () => {
    await addJournalEntry(db, batch.id, { content: journalText, category: journalCategory });
    setJournalText("");
  });
  const saveLogEdit = () => act(async () => {
    await updateLogDate(db, batch.id, editingLog.id, editingLog.value);
    setEditingLog(null);
  });
  const deleteLog = async (l) => {
    if (!(await confirm(t("batch.deleteThisLogEntry", { label: `${fmt(l.entered_at, lang)} — ${STATUS_LABELS[l.stage]}` })))) return;
    await act(() => deleteLogOp(db, batch.id, l.id));
    if (editingLog?.id === l.id) setEditingLog(null);
  };
  const saveTitle = async () => {
    const nextTitle = (editingTitle || "").trim();
    if (!nextTitle) return toast(t("batch.theNameCannotBeEmpty"), "error");
    if (nextTitle !== batch.title) await act(() => renameBatch(db, batch.id, nextTitle));
    setEditingTitle(null);
  };

  const canSaveRecipe = () => {
    if (splitRecipeBlocked) {
      toast(splitRecipeMessage, "error");
      return false;
    }
    return true;
  };
  const saveAsNewVersion = async () => {
    if (!canSaveRecipe()) return;
    const r = await act(() => saveBatchAsNewVersion(db, batch.id));
    setSaveRecipeOpen(false);
    if (r) toast(t("batch.recipeUpdated", { version: r.version }));
  };
  const saveAsNewRecipe = async (title) => {
    if (!canSaveRecipe()) return;
    const r = await ops.act(() => saveBatchAsNewRecipe(db, batch.id, title));
    setSaveRecipeOpen(false);
    if (!r) return;
    toast(t("batch.newRecipeCreated"));
    router.push(`/app/recipes/${r.recipeId}`);
  };

  const rebrew = async () => {
    if (!recipe || blocked) return;
    const nb = await ops.act(() => createBatchForRecipe(db, { recipe, title: batch.title, volume: batch.volume, lang }));
    if (nb) router.push(`/app/batches/${nb.id}`);
  };
  const rollOver = async () => {
    if (!recipe || blocked) return;
    const kept = Number(rollVolume);
    if (!(kept > 0)) return toast(t("batch.enterTheVolumeKeptFor"), "error");
    const target = Number(batch.volume) || Number(recipe.batch_size_ref) || null;
    if (target && kept >= target) return toast(t("batch.keepLessThanTheBatch", { target }), "error");
    const nb = await ops.act(() => createBatchForRecipe(db, { recipe, title: nextBatchTitle(batch.title), volume: target, starter: { batchId: batch.id, volume: kept }, lang }));
    if (nb) router.push(`/app/batches/${nb.id}`);
  };

  // --- dérivés d'affichage --------------------------------------------------

  const currentPhase = phases.find((p) => p.id === batch.current_phase_id);
  const currentPhaseIdx = phases.findIndex((p) => p.id === batch.current_phase_id);
  const currentIngredients = currentPhase ? batchIngredients.filter((bi) => bi.phase_id === currentPhase.id) : [];
  // Moment d'ajout (houblons, sucre…) repris de la ligne de recette de même phase et même nom.
  const timingOf = new Map(recipeIngredients.filter((ri) => ri.timing).map((ri) => [`${ri.phase_id}|${ri.name.trim().toLowerCase()}`, ri.timing]));
  const lineTiming = (bi) => timingOf.get(`${bi.phase_id}|${bi.name.trim().toLowerCase()}`);
  const timingPill = {
    ontime: { background: "rgba(255,255,255,0.18)", color: COLORS.onGreen },
    due_soon: { background: COLORS.amber, color: "#1c1917" }, // ambre : texte sombre dans les deux thèmes
    overdue: { background: COLORS.danger, color: "#fff" }, // rouge : texte blanc dans les deux thèmes
  };
  const currentTiming = currentPhase ? computePhaseTiming(batch.phase_started_at, currentPhase.duration_value, currentPhase.duration_unit, now) : { status: "unknown" };
  const currentTimingLabel = phaseTimingLabel(currentTiming, lang);
  const togglePhase = (id, open) => setOpenPhases((prev) => {
    const nextSet = new Set(prev ?? (batch.current_phase_id ? [batch.current_phase_id] : []));
    if (open) nextSet.add(id);
    else nextSet.delete(id);
    return nextSet;
  });
  const phaseEnteredAt = {};
  for (const l of log) if (l.stage === "en_cours" && l.phase_id) phaseEnteredAt[l.phase_id] = l.entered_at;
  const noPhaseIngredients = batchIngredients.filter((bi) => !bi.phase_id);
  const groupedByPhase = [
    ...phases.map((p) => ({ phase: p, items: batchIngredients.filter((bi) => bi.phase_id === p.id) })),
    ...(noPhaseIngredients.length > 0 ? [{ phase: null, items: noPhaseIngredients }] : []),
  ].filter((g) => g.items.length > 0);
  const hasAction = batch.status !== "archive";
  const hasPrevious = batch.status === "en_cours" || batch.status === "degustation";
  const canSplit = batch.status === "en_cours" || batch.status === "degustation";
  const canRoll = Boolean(recipe) && batch.status !== "planifie";
  const rollTarget = Number(batch.volume) || Number(recipe?.batch_size_ref) || 0;
  const rollKept = Number(rollVolume) || 0;
  const rollWater = rollTarget > 0 && rollKept > 0 && rollKept < rollTarget ? Math.round((rollTarget - rollKept) * 100) / 100 : null;
  const nameKey = (n) => (n || "").trim().toLowerCase();
  const rankOfPhase = (phaseId) => (phaseId ? phases.findIndex((p) => p.id === phaseId) : -1);
  const carriedRanks = lotIngredients.map((i) => rankOfPhase(i.phase_id)).filter((r) => r >= 0);
  const splitRank = carriedRanks.length > 0 ? Math.min(...carriedRanks) : phases.length;
  const sinceSplit = (i) => {
    const r = rankOfPhase(i.phase_id);
    return r >= 0 && r >= splitRank;
  };
  const comparison = lots.length > 0
    ? [{ b: batch, ing: batchIngredients.filter(sinceSplit), isSelf: true }, ...lots.map((l) => ({ b: l, ing: lotIngredients.filter((i) => i.batch_id === l.id && sinceSplit(i)), isSelf: false }))]
    : [];
  const commonNames = new Set(comparison.length > 0 ? [...new Set(comparison[0].ing.map((i) => nameKey(i.name)))].filter((n) => comparison.every((m) => m.ing.some((i) => nameKey(i.name) === n))) : []);
  const inSecondFerment = batch.status === "en_cours" && !!currentPhase && /f2|second/i.test(currentPhase.name);

  // Une ligne d'ingrédient (planifié ou phase en cours) : nom, correspondance
  // stock, courses, quantité éditable, retrait, stock cliquable.
  const ingredientRow = (bi, { checkable }) => {
    const { item: stockRow, via } = stockFor(bi.name);
    const inStock = stockRow ? Number(stockRow.quantity) : null;
    const neededInStock = stockDelta(bi, stockRow);
    const isInsufficient = !bi.is_starter && !bi.deducted && (inStock == null || (neededInStock != null && inStock < neededInStock));
    const Wrapper = checkable && !bi.is_starter ? "label" : "div";
    return (
      <Wrapper key={bi.id} data-testid="batch-line" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: COLORS.row, borderRadius: 9, padding: "8px 12px", cursor: checkable && !bi.is_starter ? "pointer" : "default" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {checkable && (bi.is_starter
            ? <span title={t("batch.reusableStarterTip")}>♻️</span>
            : <input type="checkbox" checked={bi.deducted} disabled={blocked} onChange={() => toggleIngredient(bi)} aria-label={t("batch.used", { name: bi.name })} style={{ width: 20, height: 20 }} />)}
          <span style={{ fontSize: 13, fontWeight: 600, color: bi.deducted ? COLORS.faint : COLORS.text, textDecoration: bi.deducted ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bi.name}
          </span>
          {via === "fuzzy" && !bi.deducted && <span style={{ fontSize: 10, color: COLORS.warn, fontWeight: 600, flexShrink: 0 }}>~{stockRow.name}</span>}
          {!checkable && bi.is_starter && <span style={{ fontSize: 10, flexShrink: 0 }} title={t("batch.reusableStarterTip")}>♻️</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {!stockRow && (
            <button type="button" style={linkBtn} onClick={(e) => { e.preventDefault(); setLinkTarget({ name: bi.name, unit: bi.unit, category: bi.category }); }} title={t("common.linkToAStockIngredient")}>
              🔗
            </button>
          )}
          {!bi.is_starter && !bi.deducted && shoppingShortfall(bi) != null && (
            <button type="button" style={shoppingBtn} disabled={blocked} onClick={(e) => { e.preventDefault(); addToShoppingList(bi); }} aria-label={t("batch.addToTheShoppingList", { name: bi.name })}>🛒</button>
          )}
          <button type="button" style={editableAmount} aria-label={t("common.edit2", { name: bi.name })} disabled={blocked} onClick={(e) => { e.preventDefault(); setIngredientModal({ item: bi }); }}>
            {Number(bi.amount)}{bi.unit}
          </button>
          <button type="button" style={removeBtn} aria-label={t("batch.remove", { name: bi.name })} disabled={blocked} onClick={(e) => { e.preventDefault(); removeIngredient(bi); }}>✕</button>
          <span style={{ fontSize: 12, color: COLORS.faint }}>/</span>
          <span
            style={{ fontSize: 13, fontWeight: 700, color: bi.deducted ? COLORS.faint : isInsufficient ? COLORS.danger : COLORS.green, cursor: "pointer", borderBottom: "1px dashed currentColor" }}
            title={stockRow ? (t("batch.clickToAdjustStock")) : (t("batch.notInStockClickTo"))}
            onClick={(e) => { e.preventDefault(); if (!blocked) setAdjustTarget(stockRow || { isNew: true, name: bi.name, unit: bi.unit, category: bi.category, quantity: 0 }); }}
          >
            {inStock != null ? `${inStock}${stockRow.unit}` : "—"}
          </span>
        </div>
      </Wrapper>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px", paddingBottom: hasAction ? 100 : 40 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/app/batches" style={{ fontSize: 13, color: COLORS.muted, textDecoration: "none" }}>{t("batch.batches")}</Link>
          <MobileMenu />
        </div>

        {/* Repère permanent : étape en cours + échéance, collé en haut. */}
        <div style={{ position: "sticky", top: 0, zIndex: 50, background: COLORS.bg, margin: "8px -20px 0", padding: "8px 20px" }}>
          <div style={{ background: COLORS.green, color: COLORS.onGreen, borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }} data-testid="batch-stage">
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 0 }}>
              {currentPhase ? `${t("batch.step")} ${currentPhaseIdx + 1}/${phases.length} · ${currentPhase.name}` : STATUS_LABELS[batch.status]}
            </span>
            {currentTimingLabel && (
              <span style={{ ...(timingPill[currentTiming.status] || timingPill.ontime), borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{currentTimingLabel}</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "12px 0 20px" }}>
          {editingTitle === null ? (
            <button type="button" onClick={() => setEditingTitle(batch.title)} title={t("batch.renameThisBatch")} style={{ fontSize: 20, fontWeight: 800, color: COLORS.green, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", borderBottom: "1px dashed currentColor", minWidth: 0 }} data-testid="batch-title">
              {batch.title}
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" }}>
              <input style={{ ...inp, flex: 1, minWidth: 140, fontWeight: 700 }} value={editingTitle} autoFocus aria-label={t("common.batchName")} onChange={(e) => setEditingTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(null); }} />
              <button type="button" style={{ ...btnS, padding: "6px 10px", fontSize: 12 }} onClick={saveTitle} disabled={blocked}>OK</button>
              <button type="button" onClick={() => setEditingTitle(null)} style={ghostBtn}>{t("common.cancel")}</button>
            </div>
          )}
          {editingTitle === null && <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.green, flexShrink: 0 }}>{STATUS_LABELS[batch.status]}</span>}
        </div>

        {recipe && (
          <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 16 }}>
            {t("batch.recipe")} <Link href={`/app/recipes/${recipe.id}`} style={{ color: COLORS.green, textDecoration: "none", fontWeight: 600 }}>{recipe.title}</Link>
            {batch.volume ? ` · ${batch.volume}L` : ""}
          </div>
        )}
        {parentBatch && (
          <div style={{ ...card, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: COLORS.muted }}>
            {t("batch.splitFrom")}
            <Link href={`/app/batches/${parentBatch.id}`} style={{ color: COLORS.green, fontWeight: 700, textDecoration: "none" }}>{parentBatch.title}</Link>
          </div>
        )}
        {starterSource && (
          <div style={{ ...card, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: COLORS.muted }}>
            <span aria-hidden="true">♻️ </span>
            {t("batch.startedWith")}
            {batch.starter_volume ? `${Number(batch.starter_volume)} L ` : ""}
            {t("batch.from")}
            <Link href={`/app/batches/${starterSource.id}`} style={{ color: COLORS.green, fontWeight: 700, textDecoration: "none" }}>{starterSource.title}</Link>
            {batch.culture_generation ? (t("batch.generation", { culture_generation: batch.culture_generation })) : ""}
            {(() => {
              const water = dilutionWaterTarget(batchIngredients);
              return water ? t("batch.waterToAdd", { amount: Number(water.amount), unit: water.unit }) : "";
            })()}
          </div>
        )}

        {recipe && (diff.hasChanges || splitRecipeBlocked) && batch.status !== "archive" && (
          <div style={{ background: COLORS.amberSoft, border: `1px solid ${COLORS.amberSoftBorder}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: COLORS.amberText, lineHeight: 1.5 }}>
              {splitRecipeBlocked ? splitRecipeMessage : (
                <>
                  {t("batch.thisBatchDiffersFromIts2")}
                  {" — "}
                  {[
                    diff.added.length && t("batch.diffAdded", { count: diff.added.length }),
                    diff.modified.length && t("batch.diffModified", { count: diff.modified.length }),
                    diff.removed.length && t("batch.diffRemoved", { count: diff.removed.length }),
                  ].filter(Boolean).join(", ")}.
                </>
              )}
            </div>
            {!splitRecipeBlocked && (
              <button type="button" style={{ ...btnP, fontSize: 12, padding: "7px 12px" }} disabled={blocked} onClick={() => setSaveRecipeOpen(true)}>
                {t("batch.saveToRecipe")}
              </button>
            )}
          </div>
        )}

        {phases.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {phases.map((p, idx) => {
              const isCurrent = batch.status === "en_cours" && p.id === batch.current_phase_id;
              const timing = isCurrent ? computePhaseTiming(batch.phase_started_at, p.duration_value, p.duration_unit, now) : { status: "unknown" };
              const timingLabel = phaseTimingLabel(timing, lang);
              const done = batch.status === "degustation" || batch.status === "archive" || (batch.status === "en_cours" && idx < currentPhaseIdx);
              const items = batchIngredients.filter((bi) => bi.phase_id === p.id);
              const enteredAt = phaseEnteredAt[p.id];
              return (
                <details key={p.id} open={openPhases ? openPhases.has(p.id) : isCurrent} onToggle={(e) => togglePhase(p.id, e.currentTarget.open)} style={{ background: isCurrent ? COLORS.green : COLORS.surface, color: isCurrent ? COLORS.onGreen : COLORS.text, border: `1px solid ${isCurrent ? "transparent" : COLORS.border}`, borderRadius: 10, padding: "8px 12px", fontSize: 13, opacity: done || isCurrent ? 1 : 0.6 }}>
                  <summary style={{ listStyle: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontWeight: isCurrent ? 700 : 500, minHeight: 28 }}>
                    <span style={{ minWidth: 0 }}>
                      <span aria-hidden="true">{done ? "✓ " : isCurrent ? "● " : "○ "}</span>
                      {p.name}
                      {p.duration_value ? ` · ${t("batch.est")} ${p.duration_value}${DURATION_UNITS[p.duration_unit] || ""}` : ""}
                      {p.temperature_target ? ` · ${p.temperature_target}°C` : ""}
                    </span>
                    {timingLabel && <span style={{ ...(timingPill[timing.status] || timingPill.ontime), borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{timingLabel}</span>}
                  </summary>
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${isCurrent ? "rgba(255,255,255,0.25)" : COLORS.border}`, fontSize: 12.5, fontWeight: 400, lineHeight: 1.55 }}>
                    {enteredAt && <div style={{ opacity: 0.85, marginBottom: 6 }}>{t("batch.startedOn")}{fmt(enteredAt, lang)}</div>}
                    {p.notes && <div style={{ whiteSpace: "pre-line", marginBottom: items.length > 0 ? 6 : 0 }}>{p.notes}</div>}
                    {items.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {items.map((bi) => (
                          <li key={bi.id} style={{ opacity: bi.deducted ? 0.65 : 1 }}>
                            <span aria-hidden="true">{bi.is_starter ? "♻️ " : bi.deducted ? "✓ " : "○ "}</span>
                            {bi.name} — {Number(bi.amount)}{bi.unit}{lineTiming(bi) ? ` · ${lineTiming(bi)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!p.notes && items.length === 0 && <div style={{ opacity: 0.75 }}>{t("batch.nothingToAddAtThis")}</div>}
                  </div>
                </details>
              );
            })}
          </div>
        )}

        {batch.status !== "archive" && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: COLORS.text }}>{t("batch.batchVolume2")}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input id="batch-volume" style={{ ...inp, width: 100 }} type="number" step="any" placeholder="Volume (L)" value={volumeInput} onChange={(e) => setVolumeInput(e.target.value)} />
              <label style={{ fontSize: 12, color: COLORS.muted, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={rescaleOnVolumeChange} onChange={(e) => setRescaleOnVolumeChange(e.target.checked)} />
                {t("batch.recalculateQuantities")}
              </label>
              <button type="button" style={btnS} onClick={updateVolume} disabled={blocked}>{t("batch.update")}</button>
            </div>
          </div>
        )}

        {batch.status === "planifie" && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: COLORS.text }}>{t("batch.requiredIngredients")}</div>
            {batchIngredients.length === 0 && <div style={{ fontSize: 13, color: COLORS.faint }}>{t("batch.noIngredientsOnThisBatch")}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 4 }}>
              {groupedByPhase.map((group) => (
                <div key={group.phase?.id || "none"}>
                  {(groupedByPhase.length > 1 || group.phase) && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px 6px" }}>📌 {group.phase ? group.phase.name : (t("common.noPhase"))}</div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{group.items.map((bi) => ingredientRow(bi, { checkable: false }))}</div>
                </div>
              ))}
            </div>
            <button type="button" style={addIngredientBtn} disabled={blocked} onClick={() => setIngredientModal({ defaultPhaseId: phases[0]?.id ?? null })}>+ {t("common.addAnIngredient")}</button>
          </div>
        )}

        {batch.status === "en_cours" && currentPhase && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: COLORS.text }}>{t("batch.currentPhase", { name: currentPhase.name })}</div>
            {currentPhase.notes && <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 8, whiteSpace: "pre-line" }}>{currentPhase.notes}</div>}
            {currentIngredients.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>{currentIngredients.map((bi) => ingredientRow(bi, { checkable: true }))}</div>}
            <button type="button" style={addIngredientBtn} disabled={blocked} onClick={() => setIngredientModal({ defaultPhaseId: currentPhase.id })}>+ {t("common.addAnIngredient")}</button>
          </div>
        )}

        {batch.status === "degustation" && (
          <div style={{ ...section, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("common.tasting")}</div>
            <StarRating value={rating} onChange={changeRating} size={28} />
            <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} placeholder={t("batch.tastingNotesSavedAutomatically")} value={notes} onChange={(e) => changeNotes(e.target.value)} data-testid="tasting-notes" />
          </div>
        )}

        {batch.status === "archive" && (
          <div style={section}>
            {batch.rating && <div style={{ marginBottom: 6 }}><StarRating value={batch.rating} size={20} /></div>}
            {batch.notes && <div style={{ fontSize: 13, color: COLORS.muted, whiteSpace: "pre-line" }}>{batch.notes}</div>}
            {recipe && (
              <button style={{ ...btnP, marginTop: batch.rating || batch.notes ? 12 : 0 }} onClick={rebrew} disabled={blocked}>
                🔁 {t("batch.brewThisAgain")}
              </button>
            )}
          </div>
        )}

        {comparison.length > 0 && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2, color: COLORS.text }}>{t("batch.splitLots", { lotsLength: lots.length })}</div>
            <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.5, marginBottom: 12 }}>{t("batch.sameBaseDifferentFinishesSo")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {comparison.map((m) => {
                const own = m.ing.filter((i) => !commonNames.has(nameKey(i.name)));
                return (
                  <div key={m.b.id} style={{ background: COLORS.row, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, minWidth: 0 }}>
                        {m.isSelf ? <>{m.b.title}<span style={{ fontSize: 11, fontWeight: 600, color: COLORS.faint }}> · {t("batch.thisBatch")}</span></> : <Link href={`/app/batches/${m.b.id}`} style={{ color: COLORS.green, textDecoration: "none" }}>{m.b.title}</Link>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        {m.b.volume != null && <span style={{ fontSize: 12, color: COLORS.muted }}>{m.b.volume} L</span>}
                        <span style={m.b.status === "archive" ? badge(COLORS.muted, COLORS.soft) : badge()}>{STATUS_LABELS[m.b.status]}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12.5, color: own.length > 0 ? COLORS.text : COLORS.faint, marginTop: 6, lineHeight: 1.5 }}>
                      {own.length > 0 ? own.map((i) => `${i.name} ${i.amount}${i.unit}`).join(" · ") : (t("batch.plainNothingOfItsOwn"))}
                    </div>
                    {m.b.rating != null && <div style={{ marginTop: 6 }}><StarRating value={m.b.rating} size={16} /></div>}
                    {m.b.notes && <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 4, whiteSpace: "pre-line" }}>{m.b.notes}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {canRoll && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: COLORS.text }}><span aria-hidden="true">♻️ </span>{t("batch.rollIntoTheNextBatch")}</div>
            <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55, marginBottom: 10 }}>
              {t("batch.keepPartOfThisBatch")}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input id="rolling-volume" style={{ ...inp, width: 130 }} type="number" step="any" min="0" placeholder={t("batch.volumeKeptL")} value={rollVolume} onChange={(e) => setRollVolume(e.target.value)} />
              <button type="button" style={btnS} onClick={rollOver} disabled={blocked}>{t("batch.rollOver")}</button>
            </div>
            {rollWater != null && (
              <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text, marginTop: 10, lineHeight: 1.5 }}>
                {t("batch.nextBatchOfLL", { rollTarget, rollWater, rollKept })}
              </div>
            )}
            {rolledInto.length > 0 && (
              <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 10, lineHeight: 1.6, borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
                {t("batch.alreadyRolledInto")}
                {rolledInto.map((r, i) => (
                  <span key={r.id}>{i > 0 ? " · " : ""}<Link href={`/app/batches/${r.id}`} style={{ color: COLORS.green, fontWeight: 700, textDecoration: "none" }}>{r.title}</Link>{r.starter_volume ? ` (${Number(r.starter_volume)} L)` : ""}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {canSplit && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: COLORS.text }}>{t("common.splitThisBatch")}</div>
            <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55, marginBottom: 10 }}>
              {t("batch.moreVolumeThanPlannedBottle")}
            </div>
            {batch.volume ? (
              <button type="button" style={btnS} disabled={blocked} onClick={() => setSplitOpen(true)}>{t("batch.splitIntoLots")}</button>
            ) : (
              <div style={{ fontSize: 12.5, color: COLORS.faint }}>{t("batch.batchVolumeUnknownTheRemainder")}</div>
            )}
          </div>
        )}

        {batch.status !== "archive" && (
          <div style={section}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: COLORS.text }}>{t("batch.tools")}</div>
            <details open={inSecondFerment} style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10, marginTop: 8 }}>
              <summary style={toolSummary}>🫧 {t("batch.secondFermentSugar")}</summary>
              <div style={{ paddingTop: 14 }}><CarbonationCalculator lang={lang} initialVolumeL={batch.volume} initialType={recipe?.type} compact /></div>
            </details>
            <details style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10, marginTop: 10 }}>
              <summary style={toolSummary}>🧪 {t("batch.checkPh")}</summary>
              <div style={{ paddingTop: 14 }}><PhGuide lang={lang} initialType={recipe?.type} compact /></div>
            </details>
          </div>
        )}

        <div style={section}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: COLORS.text }}>{t("batch.journal")}</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <SimpleCombobox value={journalCategory} onChange={setJournalCategory} options={Object.entries(JOURNAL_CATEGORIES).map(([key, label]) => ({ value: key, label }))} placeholder="Type" style={{ width: 140, flex: "none" }} />
            <input style={{ ...inp, flex: 1, minWidth: 160 }} placeholder={t("batch.addANote")} value={journalText} onChange={(e) => setJournalText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addJournal()} data-testid="journal-input" />
            <button type="button" style={btnS} disabled={blocked} onClick={addJournal}>{t("common.add")}</button>
          </div>
          {journal.length === 0 ? (
            <div style={{ fontSize: 13, color: COLORS.faint }}>{t("batch.noNotesYet")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {journal.map((j) => (
                <div key={j.id} style={{ fontSize: 12, color: COLORS.muted }}>
                  <span style={{ fontWeight: 600 }}>{fmt(j.timestamp, lang)}</span> · {JOURNAL_CATEGORIES[j.category]}
                  {j.phase_id ? ` · ${phases.find((p) => p.id === j.phase_id)?.name || ""}` : ""}
                  {" — "}
                  <span style={{ color: COLORS.text }}>{j.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {log.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>{t("batch.actualProgress")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {log.map((l) => (
                <div key={l.id} style={{ fontSize: 12, color: COLORS.muted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {editingLog?.id === l.id ? (
                    <>
                      <input type="datetime-local" style={{ ...inp, width: 190 }} value={editingLog.value} onChange={(e) => setEditingLog({ id: l.id, value: e.target.value })} />
                      <button type="button" style={{ ...btnS, padding: "4px 8px", fontSize: 11 }} disabled={blocked} onClick={saveLogEdit}>OK</button>
                      <button type="button" onClick={() => setEditingLog(null)} style={ghostBtn}>{t("common.cancel")}</button>
                    </>
                  ) : (
                    <>
                      <span>{fmt(l.entered_at, lang)} — {STATUS_LABELS[l.stage]}{l.phase_id ? ` (${phases.find((p) => p.id === l.phase_id)?.name || ""})` : ""}</span>
                      <button type="button" onClick={() => setEditingLog({ id: l.id, value: toDatetimeLocal(l.entered_at) })} style={ghostBtn}>{t("common.edit")}</button>
                      <button type="button" onClick={() => deleteLog(l)} disabled={blocked} aria-label={t("batch.deleteEntryOf", { date: fmt(l.entered_at, lang) })} style={{ background: "none", border: `1px solid ${COLORS.danger}`, borderRadius: 6, color: COLORS.danger, cursor: "pointer", fontSize: 11, lineHeight: 1, padding: "3px 7px" }}>✕</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasAction && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: COLORS.surface, borderTop: `1px solid ${COLORS.border}`, boxShadow: "0 -2px 12px rgba(0,0,0,0.12)", padding: "12px 20px calc(12px + env(safe-area-inset-bottom))", zIndex: 100 }}>
          <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 8 }}>
            {hasPrevious && <button style={{ ...btnS, flex: 1 }} disabled={blocked} onClick={previousPhase}>{t("batch.previous")}</button>}
            {batch.status === "planifie" && <button style={{ ...btnP, flex: 1 }} disabled={blocked} onClick={start} data-testid="batch-start">{t("batch.start")}</button>}
            {batch.status === "en_cours" && <button style={{ ...btnP, flex: 1 }} disabled={blocked} onClick={next} data-testid="batch-next">{t("batch.nextPhase")}</button>}
            {batch.status === "degustation" && <button style={{ ...btnP, flex: 1 }} disabled={blocked} onClick={archive} data-testid="batch-archive">{t("batch.archive")}</button>}
          </div>
        </div>
      )}

      {adjustTarget && !blocked && <StockAdjustModal name={adjustTarget.name} unit={adjustTarget.unit} currentQuantity={adjustTarget.quantity} onSave={saveStockAdjust} onClose={() => setAdjustTarget(null)} />}
      {linkTarget && !blocked && <LinkToStockModal ingredientName={linkTarget.name} stock={stock} onSave={(stockName) => saveAlias(linkTarget.name, stockName)} onClose={() => setLinkTarget(null)} />}
      {ingredientModal && !blocked && <BatchIngredientModal item={ingredientModal.item} phases={phases} defaultPhaseId={ingredientModal.defaultPhaseId} onSave={saveIngredient} onClose={() => setIngredientModal(null)} />}
      {splitOpen && !blocked && <SplitBatchModal batch={batch} busy={blocked} onSplit={splitBatch} onClose={() => setSplitOpen(false)} />}
      {saveRecipeOpen && recipe && !splitRecipeBlocked && (
        <SaveRecipeChangesModal diff={diff} recipe={recipe} batchVolume={batch.volume} ratio={ratio} busy={blocked} onSaveVersion={saveAsNewVersion} onSaveNewRecipe={saveAsNewRecipe} onClose={() => setSaveRecipeOpen(false)} />
      )}
    </div>
  );
}
