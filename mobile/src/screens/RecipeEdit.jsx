// Éditeur de recette du carnet local. Porté de app/app/recipes/[id]/page.jsx :
// même formulaire (titre, type, volume, style, notes, tags, phases, lignes
// d'ingrédients, historique des versions, duplication), mais toutes les
// écritures passent par la couche données SQLite en UNE transaction
// (data/recipes.js). Hors périmètre L1, donc non repris ici : stock et voyants
// de manque, liste de courses, brassins. Ils arrivent avec L2.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { localeFor } from "@/lib/i18n";
import IngredientCombobox from "@/app/components/IngredientCombobox";
import LinkToStockModal from "@/app/components/LinkToStockModal";
import Loading from "@/app/components/Loading";
import StarRating from "@/app/components/StarRating";
import { analyzeRecipeNeeds } from "@/lib/recipeShortfalls";
import { findStockItem } from "@/lib/ingredientMatcher";
import SimpleCombobox from "@/app/components/SimpleCombobox";
import { CATEGORIES, ingredientIcon, categoryLabel } from "@/lib/ingredientCategories";
import { RECIPE_TYPES, durationUnits, typeLabel, phaseName } from "@/lib/recipeTypes";
import { useToast, useConfirm } from "@/lib/UiContext";
import { inp, btnP, btnSLink as btnS, card, COLORS } from "@/lib/uiStyles";
import { MobileMenu } from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { INGREDIENT_CATALOG, STYLE_CATALOG, catalogName } from "../data/catalogs.js";
import { getRecipeFull, saveRecipe, duplicateRecipe, listTagsAndStyles } from "../data/recipes.js";
import { listStock, listAliases } from "../data/stock.js";
import { addShoppingRows } from "../data/shopping.js";
import { createBatchForRecipe, upsertAlias } from "../data/batches.js";
import { useStockOps } from "../hooks/useStockOps.js";
import { useT } from "@/lib/i18n/useT";

let tempCounter = 0;
function nextTempId(prefix) {
  tempCounter += 1;
  return `${prefix}-${tempCounter}`;
}

function phaseFromTemplate(tpl, lang) {
  return {
    tempId: nextTempId("phase"),
    open: false,
    name: tpl.nameKey ? phaseName(tpl, lang) : tpl.name,
    durationValue: tpl.durationValue != null ? String(tpl.durationValue) : "",
    durationUnit: tpl.durationUnit || "jours",
    temperatureTarget: tpl.temperatureTarget != null ? String(tpl.temperatureTarget) : "",
    notes: "",
  };
}

function fmtDate(ts, lang) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(localeFor(lang), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function emptyLine() {
  return {
    tempId: nextTempId("line"),
    open: true,
    phaseTempId: "",
    category: "autre",
    name: "",
    amount: "",
    unit: "g",
    sub_type: "",
    alpha_acid_pct: "",
    timing: "",
    is_starter: false,
  };
}

// Lignes/phases lues en base → état du formulaire (tempId côté écran, realId = id en base).
function phasesFromRows(rows) {
  const idMap = {};
  const phases = rows.map((p) => {
    const tempId = nextTempId("phase");
    idMap[p.id] = tempId;
    return {
      tempId,
      realId: p.id,
      open: false,
      name: p.name,
      durationValue: p.duration_value != null ? String(p.duration_value) : "",
      durationUnit: p.duration_unit || "jours",
      temperatureTarget: p.temperature_target != null ? String(p.temperature_target) : "",
      notes: p.notes || "",
    };
  });
  return { phases, idMap };
}

function linesFromRows(rows, idMap) {
  return rows.map((r) => ({
    tempId: nextTempId("line"),
    open: false,
    phaseTempId: r.phase_id ? idMap[r.phase_id] || "" : "",
    category: r.category,
    name: r.name,
    amount: String(r.amount),
    unit: r.unit,
    sub_type: r.sub_type || "",
    alpha_acid_pct: r.alpha_acid_pct != null ? String(r.alpha_acid_pct) : "",
    timing: r.timing || "",
    is_starter: !!r.is_starter,
  }));
}

export default function RecipeEdit() {
  const params = useParams();
  const router = useRouter();
  const isNew = params.id === "new";
  const { db } = useDb();
  const { t, lang } = useT();
  const DURATION_UNITS = durationUnits(lang);
  const toast = useToast();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState(false);
  const ops = useStockOps(db);
  const [stock, setStock] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [recipeBatches, setRecipeBatches] = useState([]);
  const [showBatches, setShowBatches] = useState(false);
  const [stockEditItem, setStockEditItem] = useState(null);
  const [stockEditQty, setStockEditQty] = useState("");
  const [linkTarget, setLinkTarget] = useState(null);
  const STATUS_LABELS = { planifie: t("common.planned"), en_cours: t("common.inProgress"), degustation: t("common.tasting"), archive: t("common.archived") };


  const reloadStock = async () => {
    const [st, al] = await Promise.all([listStock(db), listAliases(db)]);
    setStock(st);
    setAliases(al);
  };
  const [knownStyles, setKnownStyles] = useState([]);
  const [allRecipeTags, setAllRecipeTags] = useState([]);

  const [title, setTitle] = useState("");
  const [type, setType] = useState("kefir_eau");
  const [batchSizeRef, setBatchSizeRef] = useState("");
  const [style, setStyle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [phases, setPhases] = useState([]);
  const [lines, setLines] = useState([emptyLine()]);

  // Voyant rouge/vert par ligne et « manquants → courses » : le MÊME calcul
  // (lib/recipeShortfalls) que le site.
  const needs = useMemo(() => analyzeRecipeNeeds(lines, { stock, aliases }), [lines, stock, aliases]);
  const needByTempId = new Map(needs.lines.map((n) => [n.tempId, n]));
  const [versions, setVersions] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [showVersions, setShowVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Garde-fou « modifications non enregistrées » (même mécanique que le site).
  const formSnapshot = JSON.stringify({
    title,
    type,
    batchSizeRef,
    style,
    instructions,
    tags,
    phases: phases.map(({ open, ...p }) => p),
    lines: lines.map(({ open, ...l }) => l),
  });
  const liveSnapshot = useRef(formSnapshot);
  useEffect(() => {
    liveSnapshot.current = formSnapshot;
  }, [formSnapshot]);
  const savedSnapshot = useRef(null);
  useEffect(() => {
    if (loaded && savedSnapshot.current === null) savedSnapshot.current = liveSnapshot.current;
  }, [loaded]);
  useEffect(() => {
    const warn = (e) => {
      if (savedSnapshot.current === null || liveSnapshot.current === savedSnapshot.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { tags: knownTags, styles } = await listTagsAndStyles(db);
      const [st, al] = await Promise.all([listStock(db), listAliases(db)]);
      if (cancelled) return;
      setStock(st);
      setAliases(al);
      if (!isNew) setRecipeBatches(await db.query("select * from batches where recipe_id = ? order by created_at desc", [params.id]));
      setAllRecipeTags(knownTags);
      setKnownStyles(styles);
      if (!isNew) {
        const full = await getRecipeFull(db, params.id);
        if (cancelled) return;
        if (!full) {
          toast(t("common.recipeNotFound"), "error");
          router.replace("/app/recipes");
          return;
        }
        setTitle(full.recipe.title);
        setType(full.recipe.type);
        setBatchSizeRef(full.recipe.batch_size_ref != null ? String(full.recipe.batch_size_ref) : "");
        setStyle(full.recipe.style || "");
        setInstructions(full.recipe.instructions || "");
        setTags(full.recipe.tags || []);
        setCurrentVersion(full.recipe.current_version || 1);
        const { phases: loadedPhases, idMap } = phasesFromRows(full.phases);
        setPhases(loadedPhases);
        if (full.ingredients.length > 0) setLines(linesFromRows(full.ingredients, idMap));
        setVersions(full.versions);
      } else {
        setPhases(RECIPE_TYPES.kefir_eau.phaseTemplate.map((tpl) => phaseFromTemplate(tpl, lang)));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, isNew, params.id]);

  const loadPhaseTemplate = async (typeId) => {
    if (phases.length > 0 && !(await confirm(t("recipe.replaceCurrentPhasesWithThe")))) return;
    setPhases(RECIPE_TYPES[typeId].phaseTemplate.map((tpl) => phaseFromTemplate(tpl, lang)));
  };

  const updatePhase = (tempId, patch) => setPhases((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)));
  const addPhase = () => setPhases((prev) => [...prev, { ...phaseFromTemplate({ name: t("recipe.newPhase"), durationUnit: "jours" }), open: true }]);
  const removePhase = async (tempId) => {
    if (!(await confirm(t("recipe.removeThisPhase")))) return;
    setPhases((prev) => prev.filter((p) => p.tempId !== tempId));
    setLines((prev) => prev.map((l) => (l.phaseTempId === tempId ? { ...l, phaseTempId: "" } : l)));
  };

  const updateLine = (tempId, patch) => setLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)));
  const removeLine = async (tempId) => {
    if (!(await confirm(t("recipe.removeThisIngredient")))) return;
    setLines((prev) => prev.filter((l) => l.tempId !== tempId));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const save = async () => {
    if (!title.trim()) return toast(t("recipe.giveTheRecipeATitle"), "error");
    setSaving(true);
    try {
      await saveRecipe(db, {
        id: isNew ? null : params.id,
        recipe: { title, type, batch_size_ref: batchSizeRef, style, instructions, tags },
        phases: phases.map((p) => ({ key: p.tempId, id: p.realId, name: p.name, duration_value: p.durationValue, duration_unit: p.durationUnit, temperature_target: p.temperatureTarget, notes: p.notes })),
        ingredients: lines.map((l) => ({ phaseKey: l.phaseTempId || null, category: l.category, name: l.name, amount: l.amount, unit: l.unit, sub_type: l.sub_type, alpha_acid_pct: l.alpha_acid_pct, timing: l.timing, is_starter: l.is_starter })),
      });
      savedSnapshot.current = liveSnapshot.current;
      toast(t("recipe.recipeSaved"));
      router.push("/app/recipes");
    } catch (err) {
      toast((t("common.error")) + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const addTag = (raw) => {
    const tag = raw.trim().toLowerCase().replace(/[,;]+$/, "");
    if (!tag || tags.includes(tag)) return;
    setTags((prev) => [...prev, tag]);
  };
  const removeTag = (tag) => setTags((prev) => prev.filter((x) => x !== tag));
  const onTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      addTag(tagInput);
      setTagInput("");
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const restoreVersion = async (v) => {
    if (!(await confirm(t("recipe.restoreVersionConfirm2", { version: v.version, date: fmtDate(v.created_at, lang) })))) return;
    const snap = v.snapshot;
    setTitle(snap.recipe?.title || "");
    setType(snap.recipe?.type || type);
    setBatchSizeRef(snap.recipe?.batch_size_ref != null ? String(snap.recipe.batch_size_ref) : "");
    setStyle(snap.recipe?.style || "");
    setInstructions(snap.recipe?.instructions || "");
    setTags(snap.recipe?.tags || []);
    // Même règle que le site : les phases vivantes à la même position gardent
    // leur identifiant (W07 sera repris au lot 2 avec une identité de phase).
    const livePhases = phases;
    const { phases: restored, idMap } = phasesFromRows(snap.phases || []);
    setPhases(restored.map((p, idx) => ({ ...p, realId: livePhases[idx]?.realId })));
    setLines(linesFromRows(snap.ingredients || [], idMap));
    setViewingVersion(null);
    setShowVersions(false);
  };

  const addMissingToShopping = async () => {
    await reloadStock();
    const { shopping } = analyzeRecipeNeeds(lines, { stock: await listStock(db), aliases: await listAliases(db) });
    if (shopping.length === 0) return toast(t("recipe.nothingMissingEverythingIsAlready"));
    await ops.act(() => addShoppingRows(db, shopping.map((r) => ({ ...r, recipe_title: title.trim() || null }))));
    toast(t("recipe.itemsAddedToShopping", { count: shopping.length }));
  };

  const quickCreateBatch = async () => {
    const batch = await ops.act(() => createBatchForRecipe(db, {
      recipe: { id: params.id, title, batch_size_ref: batchSizeRef ? Number(batchSizeRef) : null },
      title: `${title} #${recipeBatches.length + 1}`,
      volume: batchSizeRef,
      lang,
    }));
    if (batch) router.push(`/app/batches/${batch.id}`);
  };

  const openStockEdit = (name) => {
    const { item } = findStockItem(name, stock, aliases);
    if (!item) return;
    setStockEditItem(item);
    setStockEditQty(String(item.quantity ?? ""));
  };

  const saveStockQty = async () => {
    if (!stockEditItem) return;
    const newQty = Number(stockEditQty);
    if (!stockEditQty.trim() || !Number.isFinite(newQty)) return toast(t("common.invalidQuantity"), "error");
    const result = await ops.run("stock_update", { stockId: stockEditItem.id, expectedRevision: stockEditItem.stock_revision, values: { quantity: newQty } });
    setStockEditItem(null);
    await reloadStock();
    if (result) toast(t("common.stockUpdated"));
  };

  const saveAlias = async (alias, stockName) => {
    await ops.act(() => upsertAlias(db, alias, stockName));
    await reloadStock();
    setLinkTarget(null);
  };

  const duplicate = async () => {
    try {
      const { id } = await duplicateRecipe(db, params.id, { suffix: t("recipe.copy") });
      toast(t("recipe.recipeDuplicated"));
      router.push(`/app/recipes/${id}`);
    } catch (err) {
      toast((t("common.error")) + err.message, "error");
    }
  };

  const recipeTypeOptions = useMemo(() => Object.entries(RECIPE_TYPES).map(([key, rt]) => ({ value: key, label: `${rt.icon} ${typeLabel(key, lang)}` })), [lang]);
  const categoryOptions = useMemo(() => Object.entries(CATEGORIES).map(([key, c]) => ({ value: key, label: `${c.icon} ${categoryLabel(key, lang)}` })), [lang]);

  if (!loaded) return <Loading />;

  const phaseOptions = [{ value: "", label: t("common.noPhase") }, ...phases.map((p) => ({ value: p.tempId, label: p.name || (t("recipe.unnamedPhase")) }))];
  const knownUnits = [...new Set(["g", "kg", "mg", "ml", "L", "cl", "pièce", "pièces", "gousse", "gousses", "sachet", "càs", "càc", ...lines.map((l) => l.unit).filter(Boolean)])].sort();
  // Catalogues dans la langue de l'app (les noms saisis dans les recettes restent tels quels).
  const styleOptions = [...STYLE_CATALOG.filter((s) => s.recipe_type === type).map((s) => catalogName(s, lang)), ...knownStyles].filter((v, i, a) => a.indexOf(v) === i);
  const catalogItems = INGREDIENT_CATALOG.map((c) => ({ ...c, name: catalogName(c, lang) }));

  const lineGroups = phases
    .map((p) => ({ key: p.tempId, label: p.name || (t("recipe.unnamedPhase")), lines: lines.filter((l) => l.phaseTempId === p.tempId) }))
    .filter((g) => g.lines.length > 0);
  const noPhaseLines = lines.filter((l) => !l.phaseTempId || !phases.find((p) => p.tempId === l.phaseTempId));
  if (noPhaseLines.length > 0) {
    lineGroups.push({ key: "__none__", label: lineGroups.length > 0 ? (t("common.noPhase")) : null, lines: noPhaseLines });
  }

  return (
    <>
      <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif", paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Link href="/app/recipes" style={{ fontSize: 13, color: COLORS.muted, textDecoration: "none" }}>
              {t("common.recipes2")}
            </Link>
            <MobileMenu />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0 20px" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: COLORS.green }}>{isNew ? (t("recipe.newRecipe")) : (t("recipe.editRecipe"))}</div>
            {!isNew && (
              <div style={{ display: "flex", gap: 6 }}>
                <button style={btnS} onClick={() => setShowVersions((v) => !v)} title={t("recipe.versionHistory")}>
                  🕓 v{currentVersion}
                </button>
                <button style={btnS} onClick={() => setShowBatches((v) => !v)} data-testid="recipe-batches-toggle">
                  {t("recipe.batchCount", { count: recipeBatches.length })}
                </button>
              </div>
            )}
          </div>

          {!isNew && showBatches && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: recipeBatches.length > 0 ? 12 : 0 }}>
                {recipeBatches.length === 0 && <div style={{ fontSize: 13, color: COLORS.faint }}>{t("recipe.noBatchesForThisRecipe2")}</div>}
                {recipeBatches.map((b) => (
                  <Link key={b.id} href={`/app/batches/${b.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: COLORS.text, textDecoration: "none", minHeight: 32 }}>
                    <span>{b.title}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: COLORS.muted }}>{STATUS_LABELS[b.status]}</span>
                      {b.rating && <StarRating value={b.rating} size={12} />}
                    </span>
                  </Link>
                ))}
              </div>
              <button style={btnP} onClick={quickCreateBatch} disabled={ops.busy} data-testid="recipe-new-batch">
                {t("recipe.newBatchFromThisRecipe2")}
              </button>
            </div>
          )}

          {!isNew && showVersions && (
            <div style={{ background: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 10 }}>{t("recipe.versionHistory")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {versions.length === 0 && <div style={{ fontSize: 13, color: COLORS.faint }}>{t("recipe.noSavedChangesYet")}</div>}
                {versions.map((v) => (
                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: COLORS.text, gap: 8 }}>
                    <span>{t("recipe.version")} {v.version} — {fmtDate(v.created_at, lang)}</span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button type="button" style={{ ...btnS, padding: "4px 10px", fontSize: 12 }} onClick={() => setViewingVersion(v)}>
                        {t("recipe.view")}
                      </button>
                      <button type="button" style={{ ...btnS, padding: "4px 10px", fontSize: 12 }} onClick={() => restoreVersion(v)}>
                        {t("common.restore")}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <input style={inp} placeholder={t("common.recipeTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <SimpleCombobox value={type} onChange={setType} options={recipeTypeOptions} placeholder={t("recipe.drinkType")} style={{ flex: 1 }} />
              <input style={{ ...inp, width: 120 }} type="number" step="any" placeholder="Volume (L)" value={batchSizeRef} onChange={(e) => setBatchSizeRef(e.target.value)} />
            </div>
            <SimpleCombobox value={style} onChange={setStyle} options={styleOptions} placeholder={t("recipe.styleOptionalEGIpa")} freeText />
            <div style={{ position: "relative" }}>
              <textarea
                style={{ ...inp, minHeight: 60, resize: "vertical", display: "block", paddingRight: 38, fontFamily: "inherit" }}
                placeholder={t("recipe.summaryGeneralNotesStepDetails")}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setNotesExpanded(true)}
                aria-label={t("recipe.expandNotes")}
                style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, border: "none", borderRadius: 7, background: COLORS.soft, color: COLORS.muted, fontSize: 13, cursor: "pointer", lineHeight: 1 }}
              >
                ⛶
              </button>
            </div>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 10px", border: `1.5px solid ${COLORS.line}`, borderRadius: 9, background: COLORS.surface, cursor: "text", minHeight: 44, alignItems: "center" }}
              onClick={(e) => e.currentTarget.querySelector("input")?.focus()}
            >
              {tags.map((tag) => (
                <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: COLORS.greenChip, color: COLORS.green, borderRadius: 99, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
                  #{tag}
                  <button type="button" onClick={() => removeTag(tag)} aria-label={t("recipe.removeTag", { tag })} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 13, color: COLORS.green, fontWeight: 700 }}>
                    ×
                  </button>
                </span>
              ))}
              <input
                style={{ border: "none", outline: "none", fontSize: 13, color: COLORS.text, minWidth: 120, flex: 1, background: "transparent" }}
                placeholder={tags.length === 0 ? (t("recipe.tagsEnterOrCommaTo")) : ""}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={() => { if (tagInput.trim()) { addTag(tagInput); setTagInput(""); } }}
              />
            </div>
            {allRecipeTags.filter((tag) => !tags.includes(tag)).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingTop: 2 }}>
                <span style={{ fontSize: 11, color: COLORS.faint, alignSelf: "center", marginRight: 2 }}>{t("recipe.suggestions")}</span>
                {allRecipeTags.filter((tag) => !tags.includes(tag)).slice(0, 12).map((tag) => (
                  <button key={tag} type="button" onClick={() => addTag(tag)} style={{ background: COLORS.greenSoft, color: COLORS.green, border: `1px solid ${COLORS.greenSoftBorder}`, borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    +#{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("recipe.phases")}</div>
            <button type="button" style={btnS} onClick={() => loadPhaseTemplate(type)}>
              {t("recipe.loadTemplate2", { name: typeLabel(type, lang) })}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {phases.map((p, i) => {
              const summary = [p.durationValue ? `${p.durationValue}${DURATION_UNITS[p.durationUnit] || ""}` : null, p.temperatureTarget ? `${p.temperatureTarget}°C` : null].filter(Boolean).join(" · ");
              return (
                <div key={p.tempId} style={{ background: COLORS.surface, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div onClick={() => updatePhase(p.tempId, { open: !p.open })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", minHeight: 32 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: COLORS.faint }}>{p.open ? "▾" : "▸"}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{p.name || `Phase ${i + 1}`}</span>
                    </div>
                    {!p.open && summary && <span style={{ fontSize: 12, color: COLORS.faint }}>{summary}</span>}
                  </div>
                  {p.open && (
                    <>
                      <input style={inp} placeholder={t("recipe.phaseName")} value={p.name} onChange={(e) => updatePhase(p.tempId, { name: e.target.value })} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <input style={{ ...inp, flex: 1 }} type="number" step="any" placeholder={t("recipe.duration")} value={p.durationValue} onChange={(e) => updatePhase(p.tempId, { durationValue: e.target.value })} />
                        <select style={{ ...inp, width: 90 }} value={p.durationUnit} onChange={(e) => updatePhase(p.tempId, { durationUnit: e.target.value })}>
                          {Object.entries(DURATION_UNITS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                        <input style={{ ...inp, width: 90 }} type="number" step="any" placeholder="°C" value={p.temperatureTarget} onChange={(e) => updatePhase(p.tempId, { temperatureTarget: e.target.value })} />
                      </div>
                      <textarea style={{ ...inp, minHeight: 44, resize: "vertical" }} placeholder={t("recipe.notesInstructionsForThisPhase")} value={p.notes} onChange={(e) => updatePhase(p.tempId, { notes: e.target.value })} />
                      <button type="button" style={{ ...btnS, alignSelf: "flex-start" }} onClick={() => removePhase(p.tempId)}>
                        {t("recipe.removeThisPhase2")}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" style={{ ...btnS, marginBottom: 20 }} onClick={addPhase}>
            {t("recipe.addAPhase")}
          </button>

          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>{t("common.ingredients")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
            {lineGroups.map((group) => (
              <div key={group.key}>
                {group.label && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px 6px" }}>📌 {group.label}</div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.lines.map((l) => (
                    <div key={l.tempId} style={{ background: COLORS.surface, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div onClick={() => updateLine(l.tempId, { open: !l.open })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", minHeight: 32 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 11, color: COLORS.faint, flexShrink: 0 }}>{l.open ? "▾" : "▸"}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ingredientIcon(l.name, l.category)} {l.name || (t("recipe.newIngredient"))}
                          </span>
                          {!l.open && l.is_starter && <span style={{ fontSize: 10, color: COLORS.green, fontWeight: 600, flexShrink: 0 }} title={t("recipe.reusableStarterTip")}>♻️</span>}
                        </div>
                        {!l.open && l.name && l.amount && (() => {
                          const need = needByTempId.get(l.tempId);
                          const stockItem = need?.stockItem ?? null;
                          const inStock = stockItem != null ? Number(stockItem.quantity) : null;
                          const isInsufficient = Boolean(need && (need.status === "missing" || need.status === "short"));
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, marginLeft: 8 }} onClick={(e) => e.stopPropagation()}>
                              {need?.via === "fuzzy" && stockItem && <span style={{ fontSize: 10, color: COLORS.warn, fontWeight: 600 }}>~{stockItem.name}</span>}
                              {!stockItem && (
                                <button type="button" style={{ fontSize: 11, color: COLORS.green, background: COLORS.greenSoft, border: `1px solid ${COLORS.greenSoftBorder}`, borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontWeight: 600, marginRight: 4 }} onClick={() => setLinkTarget({ name: l.name, unit: l.unit })} title={t("common.linkToAStockIngredient")}>🔗</button>
                              )}
                              <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text }}>{l.amount}{l.unit}</span>
                              <span style={{ fontSize: 12, color: COLORS.faint }}>/</span>
                              <span
                                style={{ fontSize: 12, fontWeight: 700, color: isInsufficient ? COLORS.danger : COLORS.green, cursor: stockItem ? "pointer" : "default", borderBottom: stockItem ? "1px dashed currentColor" : "none" }}
                                title={stockItem ? (t("recipe.clickToEditStock")) : (t("recipe.notFoundInStock"))}
                                onClick={() => { if (stockItem) openStockEdit(l.name); }}
                                data-testid="line-stock"
                              >
                                {inStock != null ? `${inStock}${stockItem.unit || l.unit}` : "—"}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                      {l.open && (
                        <>
                          <div style={{ display: "flex", gap: 6 }}>
                            <IngredientCombobox
                              value={l.name}
                              onPick={(patch) => {
                                const { quantity, supplier, ...rest } = patch;
                                updateLine(l.tempId, { ...rest, unit: rest.unit ?? l.unit });
                              }}
                              style={{ flex: 2 }}
                              groups={[
                                { label: t("recipe.myStock"), items: stock },
                                { label: t("common.genericCatalog"), items: catalogItems },
                              ]}
                            />
                            <SimpleCombobox value={l.category} onChange={(v) => updateLine(l.tempId, { category: v })} options={categoryOptions} placeholder={t("common.category")} style={{ flex: 1 }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input style={{ ...inp, flex: 1 }} type="number" step="any" placeholder={t("common.quantity")} value={l.amount} onChange={(e) => updateLine(l.tempId, { amount: e.target.value })} />
                            <SimpleCombobox value={l.unit} onChange={(v) => updateLine(l.tempId, { unit: v })} options={knownUnits} placeholder={t("common.unit")} style={{ width: 80 }} freeText />
                            <SimpleCombobox value={l.phaseTempId} onChange={(v) => updateLine(l.tempId, { phaseTempId: v })} options={phaseOptions} placeholder={t("common.phase")} style={{ width: 160 }} />
                          </div>
                          {l.category === "houblon" ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <input style={{ ...inp, flex: 1 }} type="number" step="any" placeholder={t("recipe.alphaAcid")} value={l.alpha_acid_pct} onChange={(e) => updateLine(l.tempId, { alpha_acid_pct: e.target.value })} />
                              <input style={{ ...inp, flex: 2 }} placeholder={t("recipe.timingEG60minBoil")} value={l.timing} onChange={(e) => updateLine(l.tempId, { timing: e.target.value })} />
                            </div>
                          ) : (
                            <input style={inp} placeholder={t("recipe.subTypeOptionalEG")} value={l.sub_type} onChange={(e) => updateLine(l.tempId, { sub_type: e.target.value })} />
                          )}
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.muted, cursor: "pointer" }}>
                            <input type="checkbox" checked={l.is_starter} onChange={(e) => updateLine(l.tempId, { is_starter: e.target.checked })} />
                            {t("recipe.reusableStarterGrainsScoby")}
                          </label>
                          <button type="button" style={{ ...btnS, alignSelf: "flex-start" }} onClick={() => removeLine(l.tempId)}>
                            {t("recipe.removeThisIngredient2")}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <button type="button" style={btnS} onClick={addLine}>
              {t("recipe.addAnIngredient")}
            </button>
            {lines.some((l) => l.name.trim() && !l.is_starter) && (
              <button type="button" style={btnS} onClick={addMissingToShopping} disabled={ops.busy} data-testid="add-missing">
                🛒 {t("recipe.addMissingToShoppingList")}
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btnP} onClick={save} disabled={saving} data-testid="save-recipe">
              {t("common.save")}
            </button>
            {!isNew && (
              <button style={btnS} onClick={duplicate}>
                📄 {t("common.duplicate")}
              </button>
            )}
            <Link href="/app/recipes" style={btnS}>
              {t("common.cancel")}
            </Link>
          </div>
        </div>
      </div>

      {stockEditItem && (
        <div onClick={() => setStockEditItem(null)} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 24, width: 280, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>{t("recipe.updateStock")}</div>
            <div style={{ fontSize: 13, color: COLORS.muted }}>{stockEditItem.name}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input style={{ ...inp, flex: 1 }} type="number" step="any" value={stockEditQty} onChange={(e) => setStockEditQty(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveStockQty(); if (e.key === "Escape") setStockEditItem(null); }} />
              <span style={{ fontSize: 13, color: COLORS.muted, flexShrink: 0 }}>{stockEditItem.unit}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnP} disabled={ops.busy} onClick={saveStockQty}>{t("common.save")}</button>
              <button style={btnS} onClick={() => setStockEditItem(null)}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {linkTarget && <LinkToStockModal ingredientName={linkTarget.name} stock={stock} onSave={(stockName) => saveAlias(linkTarget.name, stockName)} onClose={() => setLinkTarget(null)} />}

      {notesExpanded && (
        <div onClick={() => setNotesExpanded(false)} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 720, height: "min(85vh, 640px)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>{t("recipe.notesInstructions")}</div>
            <textarea style={{ ...inp, flex: 1, resize: "none", fontSize: 14, lineHeight: 1.65, fontFamily: "inherit" }} value={instructions} onChange={(e) => setInstructions(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setNotesExpanded(false); }} autoFocus />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button style={btnP} onClick={() => setNotesExpanded(false)}>{t("common.close")}</button>
            </div>
          </div>
        </div>
      )}

      {viewingVersion && (
        <div onClick={() => setViewingVersion(null)} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 24, width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>
              {t("recipe.version")} {viewingVersion.version} — {fmtDate(viewingVersion.created_at, lang)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{viewingVersion.snapshot.recipe?.title}</div>
            {viewingVersion.snapshot.recipe?.instructions && <div style={{ fontSize: 13, color: COLORS.muted, whiteSpace: "pre-wrap" }}>{viewingVersion.snapshot.recipe.instructions}</div>}
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.faint, textTransform: "uppercase", marginTop: 6 }}>{t("recipe.phases")}</div>
            {(viewingVersion.snapshot.phases || []).map((p) => (
              <div key={p.id} style={{ fontSize: 13, color: COLORS.text }}>
                {p.name} {p.duration_value ? `— ${p.duration_value} ${DURATION_UNITS[p.duration_unit] || ""}` : ""}
              </div>
            ))}
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.faint, textTransform: "uppercase", marginTop: 6 }}>{t("common.ingredients")}</div>
            {(viewingVersion.snapshot.ingredients || []).map((r) => (
              <div key={r.id} style={{ fontSize: 13, color: COLORS.text }}>
                {r.name} — {r.amount}{r.unit}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={btnP} onClick={() => restoreVersion(viewingVersion)}>{t("recipe.restoreThisVersion")}</button>
              <button style={btnS} onClick={() => setViewingVersion(null)}>{t("common.close")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
