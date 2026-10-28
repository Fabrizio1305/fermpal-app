// Liste des recettes du carnet local. Porté de app/app/recipes/page.jsx ;
// les appels Supabase sont remplacés par la couche données SQLite. La recette
// IA (fonction connectée, lot L4) a son écran : /app/recipes/ai.
import { useEffect, useState } from "react";
import Link from "next/link";
import Loading from "@/app/components/Loading";
import { RECIPE_TYPES as TYPES, typeLabel } from "@/lib/recipeTypes";
import { useToast, useConfirm } from "@/lib/UiContext";
import { inp, btnPLink as btnP, btnSLink as btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { listRecipes, deleteRecipe, countArchivedRecipes } from "../data/recipes.js";
import { useT } from "@/lib/i18n/useT";

export default function RecipesList() {
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [recipes, setRecipes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterTag, setFilterTag] = useState("");
  // Recettes d'archive (versions brassées lors de brassins passés) : vue à part.
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);

  const reload = async () => {
    setRecipes(await listRecipes(db, { archived: showArchived }));
    setArchivedCount(await countArchivedRecipes(db));
    setLoaded(true);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, showArchived]);

  const remove = async (id, title) => {
    if (!(await confirm(t("recipes.deleteRecipe", { title })))) return;
    try {
      await deleteRecipe(db, id);
      setRecipes((prev) => prev.filter((r) => r.id !== id));
      if (showArchived) setArchivedCount((n) => n - 1);
      toast(t("recipes.recipeDeleted"));
    } catch (err) {
      toast((t("common.error")) + err.message, "error");
      await reload();
    }
  };

  if (!loaded) return <Loading />;

  const allTags = [...new Set(recipes.flatMap((r) => r.tags || []))].sort();

  let filtered = recipes;
  if (search.trim()) filtered = filtered.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()));
  if (filterType) filtered = filtered.filter((r) => r.type === filterType);
  if (filterTag) filtered = filtered.filter((r) => (r.tags || []).includes(filterTag));

  const hasFilters = search.trim() || filterType || filterTag;

  return (
    <MobileShell
      title={t("common.recipes")}
      actions={
        <>
          <Link href="/app/recipes/ai" style={btnS} title={t("recipes.aiRecipe")} data-testid="recipes-ai">
            ✨
          </Link>
          <Link href="/app/recipes/new" style={btnP}>
            {t("recipes.new")}
          </Link>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...inp, flex: 1 }} placeholder={t("recipes.searchARecipe")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inp, width: "auto", flex: "none" }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">{t("recipes.allTypes")}</option>
          {Object.entries(TYPES).map(([key, rt]) => (
            <option key={key} value={key}>{rt.icon} {typeLabel(key, lang)}</option>
          ))}
        </select>
      </div>

      {allTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilterTag(filterTag === tag ? "" : tag)}
              style={{ background: filterTag === tag ? COLORS.green : COLORS.greenChip, color: filterTag === tag ? COLORS.onGreen : COLORS.green, border: "none", borderRadius: 99, padding: "3px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {showArchived ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.5 }}>{t("recipes.archivesHint")}</div>
          <button className="action-btn" style={{ fontSize: 12, padding: "5px 12px", alignSelf: "flex-start" }} onClick={() => setShowArchived(false)} data-testid="recipes-mine">
            ← {t("recipes.myRecipes")}
          </button>
        </div>
      ) : archivedCount > 0 && (
        <button className="action-btn" style={{ fontSize: 12, padding: "5px 12px", marginBottom: 12 }} onClick={() => setShowArchived(true)} data-testid="recipes-archives">
          🗄️ {t("recipes.archives", { count: archivedCount })}
        </button>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span data-testid="recipe-count" style={{ fontSize: 12, color: COLORS.muted }}>
          {t("recipes.count", { count: filtered.length })}
          {hasFilters ? (t("recipes.of", { recipesLength: recipes.length })) : ""}
        </span>
        {hasFilters && (
          <button className="action-btn" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => { setSearch(""); setFilterType(""); setFilterTag(""); }}>
            {t("common.clearFilters")}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ ...card, textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📖</div>
            <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
              {recipes.length === 0
                ? (t("recipes.noRecipesYetCreateYour2"))
                : (t("common.noResultsWithTheseFilters"))}
            </div>
          </div>
        )}
        {filtered.map((r) => (
          <div key={r.id} data-testid="recipe-card" style={{ ...card, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {TYPES[r.type]?.icon} {r.title}
                </div>
                <div style={{ fontSize: 12, color: COLORS.muted }}>
                  {typeLabel(r.type, lang)}
                  {r.batch_size_ref ? ` · ${r.batch_size_ref}L` : ""}
                  {r.style ? ` · ${r.style}` : ""}
                  {r.source_type === "synthetic" ? (t("recipes.demo")) : ""}
                  {r.current_version > 1 ? ` · v${r.current_version}` : ""}
                </div>
                {r.tags && r.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {r.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setFilterTag(filterTag === tag ? "" : tag)}
                        style={{ background: filterTag === tag ? COLORS.green : COLORS.greenSoft, color: filterTag === tag ? COLORS.onGreen : COLORS.green, border: "none", borderRadius: 99, padding: "1px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginLeft: 8, flexShrink: 0 }}>
                {/* aria-label : sur petit écran le libellé est masqué (globals.css) et
                    l'emoji seul ne fait pas un nom accessible (Q09). */}
                <Link href={`/app/recipes/${r.id}`} className="action-btn primary" title={t("common.edit")} aria-label={t("recipes.edit", { title: r.title })}>
                  ✏️ <span className="btn-label">{t("common.edit")}</span>
                </Link>
                <button className="action-btn danger" onClick={() => remove(r.id, r.title)} title={t("common.delete")} aria-label={t("common.delete2", { title: r.title })}>
                  🗑️ <span className="btn-label">{t("common.delete")}</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MobileShell>
  );
}
