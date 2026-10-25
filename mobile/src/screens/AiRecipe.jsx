// Recette IA dans le carnet local (lot L4) — porté de app/app/recipes/ai/page.jsx.
// Depuis le 23/10 (usage personnel), Gemini est appelé en direct avec la clé
// gardée sur le téléphone (platform/gemini.js, même prompt que le site via
// lib/recipeAi.js) : le stock et les types déjà brassés sont lus dans la base
// LOCALE et passés comme contexte borné ; l'analyse des manquants est la même
// que sur la fiche recette (lib/recipeShortfalls) ; l'import écrit dans le
// carnet local (saveRecipe + liste de courses). Pas de jardin dans le carnet :
// l'option n'est pas proposée. Sans clé ou hors ligne, l'écran l'explique.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SimpleCombobox from "@/app/components/SimpleCombobox";
import { RECIPE_TYPES, durationUnits, typeLabel } from "@/lib/recipeTypes";
import { ingredientIcon } from "@/lib/ingredientCategories";
import { analyzeRecipeNeeds } from "@/lib/recipeShortfalls";
import { useToast } from "@/lib/UiContext";
import { inp, btnP, btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { STYLE_CATALOG, catalogName } from "../data/catalogs.js";
import { saveRecipe } from "../data/recipes.js";
import { addShoppingRows } from "../data/shopping.js";
import { listStock, listAliases } from "../data/stock.js";
import { generateRecipe, hasGeminiKey } from "../platform/gemini.js";
import { isOnline } from "../data/cloudBackups.js";
import { aiErrorText } from "../components/CloudSection.jsx";
import { useT } from "@/lib/i18n/useT";

const lbl = { fontSize: 12, fontWeight: 700, color: COLORS.muted };
const hint = { fontSize: 11, color: COLORS.faint };

function ChoiceRow({ label, hintText, value, onChange, options }) {
  return (
    <>
      <label style={lbl}>{label}</label>
      <div style={{ ...hint, marginTop: 2 }}>{hintText}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 12 }}>
        {options.map(([key, text]) => {
          const base = { flex: 1, padding: "8px 4px", fontSize: 12 };
          return (
            <button key={key} type="button" onClick={() => onChange(key)} style={value === key ? { ...btnP, ...base } : { ...btnS, ...base }}>
              {text}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function AiRecipe() {
  const router = useRouter();
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();

  const [hasKey] = useState(hasGeminiKey);
  const [tab, setTab] = useState("choose");
  const lucky = tab === "lucky";
  const [type, setType] = useState("kefir_eau");
  const [volume, setVolume] = useState("2");
  const [luckyVolume, setLuckyVolume] = useState("");
  const [effort, setEffort] = useState("any");
  const [timeframe, setTimeframe] = useState("unlimited");
  const [strictStock, setStrictStock] = useState(true);
  const [includeExpired, setIncludeExpired] = useState(false);
  const [preferExpiring, setPreferExpiring] = useState(false);
  const [style, setStyle] = useState("");
  const [wish, setWish] = useState("");
  const [mode, setMode] = useState("stock");
  const [stock, setStock] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [knownTypes, setKnownTypes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const importedRef = useRef(false);

  useEffect(() => {
    (async () => {
      setStock(await listStock(db));
      setAliases(await listAliases(db));
      const rows = await db.query("select distinct type from recipes where source_type <> 'synthetic'");
      setKnownTypes(rows.map((r) => r.type).filter((k) => Object.hasOwn(RECIPE_TYPES, k)));
    })();
  }, [db]);

  const needs = useMemo(() => (result ? analyzeRecipeNeeds(result.ingredients, { stock, aliases, garden: [] }) : null), [result, stock, aliases]);
  const analysis = needs ? needs.lines : null;
  const missing = needs ? needs.shopping : [];

  const today = new Date().toISOString().slice(0, 10);
  const usableStockCount = stock.filter((i) => Number(i.quantity) > 0 && (includeExpired || !i.expiry_date || i.expiry_date >= today)).length;
  const thinStock = lucky && usableStockCount < 2;
  const styleOptions = STYLE_CATALOG.filter((sc) => sc.recipe_type === type).map((sc) => catalogName(sc, lang));

  const generate = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    importedRef.current = false;
    try {
      // Contexte local borné (revalidé par lib/aiContext) : le stock
      // utilisable et les types déjà brassés, jamais d'identifiants.
      const context = {
        stock: stock.filter((i) => Number(i.quantity) > 0).slice(0, 300).map((i) => ({ name: i.name, quantity: Number(i.quantity), unit: i.unit, category: i.category, expiry_date: i.expiry_date || null })),
        knownTypes,
      };
      const payload = lucky
        ? { surprise: true, volume: luckyVolume === "" ? null : Number(luckyVolume), effort, timeframe, strictStock, includeExpired, preferExpiring, useGarden: false, wish, lang, context }
        : { type, volume: Number(volume), style, wish, mode, lang, context };
      // Appel direct à Gemini avec la clé gardée sur le téléphone (23/10).
      const { recipe } = await generateRecipe(payload);
      setResult(recipe);
    } catch (err) {
      setError(err?.code === "empty_stock" ? t("ai.emptyStock") : aiErrorText(t, err?.code) || t("ai.error"));
    }
    setBusy(false);
  };

  const doImport = async (withShopping) => {
    if (!result || busy) return;
    setBusy(true);
    try {
      const phases = result.phases.map((p, i) => ({ key: `p${i}`, name: p.name, duration_value: p.duration_value, duration_unit: p.duration_unit, temperature_target: p.temperature_target, notes: p.notes || null }));
      const { id } = await saveRecipe(db, {
        recipe: { title: result.title, type: result.type, source_type: "ai", is_ai_generated: 1, batch_size_ref: result.batch_size_ref, style: style.trim() || null, instructions: result.instructions },
        phases,
        ingredients: result.ingredients.map((ing) => ({ phaseKey: phases[ing.phase_index]?.key || null, category: ing.category, name: ing.name, amount: ing.amount, unit: ing.unit, is_starter: ing.is_starter ? 1 : 0 })),
      });
      if (withShopping && missing.length > 0) {
        // On achète ce qui MANQUE, pas la quantité entière (lib/recipeShortfalls).
        await addShoppingRows(db, missing.map((ing) => ({ name: ing.name, amount: ing.amount, unit: ing.unit, category: ing.category, source: "recipe_ai", recipe_title: result.title })));
      }
      importedRef.current = true;
      toast(t("ai.imported"));
      router.push(`/app/recipes/${id}`);
    } catch (err) {
      toast((t("common.error")) + (err?.message || String(err)), "error");
      setBusy(false);
    }
  };

  const phaseIngredients = (idx) => (analysis || []).filter((i) => i.phase_index === idx);
  const online = isOnline();

  return (
    <MobileShell title={`✨ ${t("common.aiRecipe")}`} back="/app/recipes" backLabel={t("common.recipes")}>
      {!hasKey ? (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }} data-testid="ai-gate">
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>{t("ai.gateTitle")}</div>
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>{t("ai.gateBody")}</div>
          <Link href="/app/settings" style={{ ...btnP, textDecoration: "none", textAlign: "center" }}>{t("ai.gateCta")}</Link>
        </div>
      ) : (
        <>
          {!online && <div style={{ ...card, marginBottom: 12, fontSize: 13, color: COLORS.amberText }} data-testid="ai-offline">{t("ai.offline")}</div>}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => setTab("choose")} style={lucky ? { ...btnS, flex: 1 } : { ...btnP, flex: 1 }}>✨ {t("ai.tabChoose")}</button>
            <button type="button" onClick={() => setTab("lucky")} style={lucky ? { ...btnP, flex: 1 } : { ...btnS, flex: 1 }} data-testid="ai-tab-lucky">🎲 {t("ai.tabLucky")}</button>
          </div>

          <div style={{ ...card, marginBottom: 16 }}>
            {lucky && (
              <>
                <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.5, marginBottom: 12 }}>{t("ai.luckyIntro")}</div>
                <label style={lbl}>{t("ai.volume")}</label>
                <input type="number" min="0.5" max="50" step="0.5" value={luckyVolume} onChange={(e) => setLuckyVolume(e.target.value)} placeholder={t("ai.luckyVolumePh")} style={{ ...inp, marginTop: 4, marginBottom: 12 }} />
                <ChoiceRow label={t("ai.effort")} hintText={t("ai.effortHint")} value={effort} onChange={setEffort} options={[["quick", t("ai.effortQuick")], ["any", t("ai.effortAny")], ["project", t("ai.effortProject")]]} />
                <ChoiceRow label={t("ai.timeframe")} hintText={t("ai.timeframeHint")} value={timeframe} onChange={setTimeframe} options={[["days", t("ai.timeframeSoon")], ["weeks", t("ai.timeframeWeeks")], ["unlimited", t("ai.timeframeLong")]]} />
                <label style={lbl}>{t("ai.options")}</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6, marginBottom: 12 }}>
                  {[
                    [t("ai.optStrict"), strictStock, setStrictStock],
                    [t("ai.optExpired"), includeExpired, setIncludeExpired],
                    [t("ai.optExpiring"), preferExpiring, setPreferExpiring],
                  ].map(([text, checked, setChecked]) => (
                    <label key={text} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 17, height: 17 }} />
                      {text}
                    </label>
                  ))}
                </div>
              </>
            )}

            {!lucky && (
              <>
                <label style={lbl}>{t("ai.type")}</label>
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setStyle("");
                  }}
                  style={{ ...inp, marginTop: 4, marginBottom: 12 }}
                  data-testid="ai-type"
                >
                  {Object.entries(RECIPE_TYPES).map(([key, rt]) => (
                    <option key={key} value={key}>{rt.icon} {typeLabel(key, lang)}</option>
                  ))}
                </select>
                <label style={lbl}>{t("ai.volume")}</label>
                <input type="number" min="0.5" max="50" step="0.5" value={volume} onChange={(e) => setVolume(e.target.value)} style={{ ...inp, marginTop: 4, marginBottom: 12 }} />
                <label style={lbl}>{t("ai.style")}</label>
                <div style={{ marginTop: 4, marginBottom: 12 }}>
                  <SimpleCombobox value={style} onChange={setStyle} options={styleOptions} placeholder={t("ai.stylePh")} freeText />
                </div>
              </>
            )}

            <label style={lbl}>{t("ai.wish")}</label>
            <textarea value={wish} onChange={(e) => setWish(e.target.value.slice(0, 300))} placeholder={t("ai.wishPh")} rows={2} style={{ ...inp, marginTop: 4, marginBottom: 12, resize: "vertical", fontFamily: "inherit" }} />

            {!lucky && (
              <>
                <label style={lbl}>{t("common.ingredients")}</label>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={() => setMode("stock")} style={mode === "stock" ? { ...btnP, flex: 1 } : { ...btnS, flex: 1 }}>📦 {t("ai.modeStock")}</button>
                  <button type="button" onClick={() => setMode("free")} style={mode === "free" ? { ...btnP, flex: 1 } : { ...btnS, flex: 1 }}>🛒 {t("ai.modeFree")}</button>
                </div>
                <div style={{ ...hint, marginTop: 6 }}>{mode === "stock" ? t("ai.modeHintStock") : t("ai.modeHintFree")}</div>
              </>
            )}

            <button type="button" onClick={generate} disabled={busy || thinStock} style={{ ...btnP, width: "100%", marginTop: 14, opacity: busy || thinStock ? 0.6 : 1 }} data-testid="ai-generate">
              {busy && !result ? (lucky ? t("ai.luckyBusy") : t("ai.generating")) : lucky ? `🎲 ${t("ai.luckyGo")}` : `✨ ${t("ai.generate")}`}
            </button>
            {thinStock && <div style={{ fontSize: 11, color: COLORS.amberText, marginTop: 6, textAlign: "center" }}>{t("ai.thinStock")}</div>}
            {error && (
              <div style={{ marginTop: 10, fontSize: 12, color: COLORS.danger, fontWeight: 600 }} data-testid="ai-error">
                {error}
              </div>
            )}
          </div>

          {result && analysis && (
            <div style={card} data-testid="ai-result">
              <div style={{ fontSize: 17, fontWeight: 800, color: COLORS.text }}>{RECIPE_TYPES[result.type]?.icon} {result.title}</div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>{result.batch_size_ref} L · {result.phases.length} phases</div>
              {result.why && (
                <div style={{ background: COLORS.greenSoft, border: `1px solid ${COLORS.greenSoftBorder}`, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.green, marginBottom: 3 }}>🎲 {t("ai.why")}</div>
                  <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>{result.why}</div>
                </div>
              )}
              {result.phases.map((p, idx) => {
                const ings = phaseIngredients(idx);
                const miss = ings.filter((i) => !i.is_starter && (!i.stockItem || i.shortfall != null));
                return (
                  <div key={idx} style={{ marginBottom: 12, padding: 10, background: COLORS.row, borderRadius: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.green }}>
                      {idx + 1}. {p.name}
                      {p.duration_value ? (
                        <span style={{ color: COLORS.faint, fontWeight: 500 }}>
                          {" "}· {p.duration_value} {durationUnits(lang)[p.duration_unit] || p.duration_unit}{p.temperature_target ? ` · ${p.temperature_target}°C` : ""}
                        </span>
                      ) : null}
                    </div>
                    {ings.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {ings.map((ing, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: COLORS.text }}>
                            <span>
                              {ingredientIcon(ing.name, ing.category)} {ing.name}
                              {ing.is_starter ? <span style={{ color: COLORS.amberText, fontSize: 10, fontWeight: 700 }}> ⭐ {t("ai.starter")}</span> : null}
                            </span>
                            <span style={{ color: COLORS.muted }}>
                              {ing.amount} {ing.unit}{" "}
                              {ing.is_starter ? null : ing.shortfall != null ? (
                                <span style={{ color: COLORS.amberText, fontWeight: 700 }}>🛒 {t("ai.short", { n: ing.shortfall, unit: ing.unit })}</span>
                              ) : ing.stockItem ? (
                                <span style={{ color: COLORS.green, fontWeight: 700 }}>✓ {t("ai.inStock")}</span>
                              ) : (
                                <span style={{ color: COLORS.danger, fontWeight: 700 }}>🛒 {t("ai.missing")}</span>
                              )}
                            </span>
                          </div>
                        ))}
                        {miss.length === 0 && <div style={{ fontSize: 11, color: COLORS.green, marginTop: 2 }}>✅ {t("ai.phaseOk")}</div>}
                      </div>
                    )}
                    {p.notes && <div style={{ ...hint, marginTop: 4 }}>{p.notes}</div>}
                  </div>
                );
              })}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {missing.length > 0 ? (
                  <button type="button" onClick={() => doImport(true)} disabled={busy} style={{ ...btnP, opacity: busy ? 0.6 : 1 }} data-testid="ai-import-shopping">{t("ai.importShopping", { count: missing.length })}</button>
                ) : null}
                <button type="button" onClick={() => doImport(false)} disabled={busy} style={missing.length > 0 ? { ...btnS, opacity: busy ? 0.6 : 1 } : { ...btnP, opacity: busy ? 0.6 : 1 }} data-testid="ai-import">{t("ai.import")}</button>
                <button type="button" onClick={generate} disabled={busy} style={{ ...btnS, opacity: busy ? 0.6 : 1 }}>{t("ai.retry")}</button>
              </div>
            </div>
          )}
        </>
      )}
    </MobileShell>
  );
}
