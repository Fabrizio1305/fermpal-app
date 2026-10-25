// Stock d'ingrédients du carnet local. Porté de app/app/stock/page.jsx :
// créer, corriger, dupliquer, supprimer (l'import CSV est dans Paramètres) — chaque écriture
// est une opération de stock journalisée (data/stockOperations.js).
import { useEffect, useState } from "react";
import IngredientCombobox from "@/app/components/IngredientCombobox";
import Loading from "@/app/components/Loading";
import SimpleCombobox from "@/app/components/SimpleCombobox";
import { CATEGORIES, daysUntil, categoryLabel } from "@/lib/ingredientCategories";
import { useToast, useConfirm } from "@/lib/UiContext";
import { inp, btnP, btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { INGREDIENT_CATALOG, catalogName } from "../data/catalogs.js";
import { listStock } from "../data/stock.js";
import { useStockOps } from "../hooks/useStockOps.js";
import { useT } from "@/lib/i18n/useT";

function ExpiryBadge({ date }) {
  const { t } = useT();
  if (!date) return null;
  const d = daysUntil(date);
  if (d === null) return null;
  const [y, m, day] = date.split("-");
  const label = d < 0 ? (t("common.expired")) : d === 0 ? (t("stock.today")) : d === 1 ? (t("stock.tomorrow")) : `D-${d}`;
  const color = d < 0 ? COLORS.danger : d <= 15 ? COLORS.warn : COLORS.green;
  return (
    <span style={{ color, fontSize: 12, fontWeight: 600, marginLeft: 6, whiteSpace: "nowrap" }}>
      ● {label} · {day}/{m}/{y.slice(2)}
    </span>
  );
}

const clearBtn = {
  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: COLORS.line, border: "none", borderRadius: "50%",
  width: 22, height: 22, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontWeight: 700, lineHeight: 1,
};

export default function StockScreen() {
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const ops = useStockOps(db);
  const [loaded, setLoaded] = useState(false);
  const [stock, setStock] = useState([]);
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState("");
  const [fname, setFname] = useState("");
  const [fqty, setFqty] = useState("");
  const [funit, setFunit] = useState("g");
  const [fcategory, setFcategory] = useState("autre");
  const [fexpiry, setFexpiry] = useState("");
  const [fsupplier, setFsupplier] = useState("");
  const blocked = ops.busy;

  const reload = async () => {
    setStock(await listStock(db));
    setLoaded(true);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const resetForm = () => {
    setEditItem(null);
    setFname("");
    setFqty("");
    setFunit("g");
    setFcategory("autre");
    setFexpiry("");
    setFsupplier("");
  };

  const fillForm = (item) => {
    setFname(item.name);
    setFqty(String(item.quantity));
    setFunit(item.unit);
    setFcategory(item.category);
    setFexpiry(item.expiry_date || "");
    setFsupplier(item.supplier || "");
  };

  const startEdit = (item) => {
    if (blocked) return;
    setEditItem(item);
    fillForm(item);
  };

  const pickFromCatalog = ({ name, unit, category, supplier }) => {
    setFname(name);
    if (unit) setFunit(unit);
    if (category) setFcategory(category);
    if (supplier !== undefined) setFsupplier(supplier || "");
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (blocked || !fname.trim()) return;
    if (!Number.isFinite(Number(fqty))) return toast(t("common.invalidQuantity"), "error");
    const row = { name: fname.trim(), quantity: Number(fqty) || 0, unit: funit, category: fcategory, expiry_date: fexpiry || null, supplier: fsupplier.trim() || null };
    const result = editItem
      ? await ops.run("stock_update", { stockId: editItem.id, expectedRevision: editItem.stock_revision, values: row })
      : await ops.run("stock_create", { rows: [row] });
    resetForm();
    await reload();
    if (result) toast(editItem ? (t("common.stockUpdated")) : (t("stock.ingredientAdded")));
  };

  const remove = async (item) => {
    if (blocked) return;
    if (!(await confirm(t("stock.removeFromStockRestoringDeductions", { name: item.name })))) return;
    const result = await ops.run("stock_remove", { stockId: item.id, expectedRevision: item.stock_revision });
    await reload();
    if (result) toast(t("stock.ingredientRemoved"));
  };

  const duplicateItem = (item) => {
    if (blocked) return;
    setEditItem(null);
    fillForm(item);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!loaded) return <Loading />;

  const filtered = search.trim() ? stock.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase())) : stock;
  const groups = Object.entries(CATEGORIES)
    .map(([key, c]) => ({ key, ...c, items: filtered.filter((i) => (i.category || "autre") === key) }))
    .filter((g) => g.items.length > 0);
  const knownSuppliers = [...new Set(stock.map((i) => i.supplier).filter(Boolean))].sort();
  const knownUnits = [...new Set(["g", "kg", "mg", "ml", "L", "cl", "pièce", "pièces", "gousse", "gousses", "sachet", "càs", "càc", ...stock.map((i) => i.unit).filter(Boolean)])].sort();
  const categoryOptions = Object.entries(CATEGORIES).map(([key, c]) => ({ value: key, label: `${c.icon} ${categoryLabel(key, lang)}` }));
  const groupsFor = (excludeId) => [
    { label: t("stock.myIngredients"), items: stock.filter((i) => i.id !== excludeId) },
    { label: t("common.genericCatalog"), items: INGREDIENT_CATALOG.map((c) => ({ ...c, name: catalogName(c, lang) })) },
  ];

  const fields = (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...inp, flex: 1 }} type="number" step="any" placeholder={t("common.quantity")} value={fqty} onChange={(e) => setFqty(e.target.value)} data-testid="stock-qty" />
        <SimpleCombobox value={funit} onChange={setFunit} options={knownUnits} placeholder={t("common.unit")} style={{ width: 90 }} freeText />
      </div>
      <SimpleCombobox value={fcategory} onChange={setFcategory} options={categoryOptions} placeholder={t("common.category")} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input type="date" value={fexpiry} onChange={(e) => setFexpiry(e.target.value)} style={{ ...inp, color: fexpiry ? COLORS.text : COLORS.faint, paddingRight: fexpiry ? 36 : 12 }} aria-label={t("stock.expiryDate")} />
          {fexpiry && (
            <button type="button" onClick={() => setFexpiry("")} style={clearBtn} aria-label={t("stock.clearDate")}>×</button>
          )}
        </div>
        <SimpleCombobox value={fsupplier} onChange={setFsupplier} options={knownSuppliers} placeholder={t("stock.supplierOptional")} style={{ flex: 1 }} freeText />
      </div>
    </>
  );

  return (
    <MobileShell title={t("stock.stock")} back="/app" backLabel={t("common.dashboard")}>
      <form onSubmit={submit} style={{ ...card, marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{t("stock.addIngredient")}</div>
        <IngredientCombobox value={fname} onPick={pickFromCatalog} groups={groupsFor(null)} />
        {fields}
        <button type="submit" style={btnP} disabled={blocked} data-testid="stock-add">
          {t("common.add")}
        </button>
      </form>

      <input style={{ ...inp, marginBottom: 12 }} placeholder={t("stock.searchIngredient")} value={search} onChange={(e) => setSearch(e.target.value)} />

      {groups.length === 0 && (
        <div style={{ ...card, textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
            {stock.length === 0
              ? (t("stock.yourStockIsEmptyAdd"))
              : (t("stock.noResults"))}
          </div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.green, marginBottom: 6 }}>{g.icon} {categoryLabel(g.key, lang)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.items.map((item) => (
              <div key={item.id} data-testid="stock-item" style={{ ...card, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
                    {item.name}
                    <ExpiryBadge date={item.expiry_date} />
                  </div>
                  <div style={{ fontSize: 12, color: item.quantity < 0 ? COLORS.danger : COLORS.muted, fontWeight: item.quantity < 0 ? 700 : 400 }}>
                    <span data-testid="stock-qty-label">{item.quantity} {item.unit}</span>
                    {item.quantity < 0 ? (t("stock.missing")) : ""}
                    {item.supplier ? ` · ${item.supplier}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="action-btn" disabled={blocked} onClick={() => startEdit(item)} title={t("common.edit")} aria-label={t("common.edit2", { name: item.name })}>
                    ✏️ <span className="btn-label">{t("common.edit")}</span>
                  </button>
                  <button className="action-btn" disabled={blocked} title={t("common.duplicate")} aria-label={t("stock.duplicate", { name: item.name })} onClick={() => duplicateItem(item)}>
                    📄 <span className="btn-label">{t("common.duplicate")}</span>
                  </button>
                  <button className="action-btn danger" disabled={blocked} onClick={() => remove(item)} title={t("common.delete")} aria-label={t("common.delete3", { name: item.name })}>
                    🗑️ <span className="btn-label">{t("common.delete")}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {editItem && (
        <div onClick={resetForm} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: "20px 20px 0 0", padding: "16px 16px 36px", width: "100%", maxWidth: 500, boxSizing: "border-box", boxShadow: "0 -4px 30px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ width: 40, height: 4, background: COLORS.line, borderRadius: 99, margin: "0 auto 8px" }} />
            <div style={{ fontWeight: 700, fontSize: 14, color: COLORS.text, marginBottom: 6 }}>{t("stock.edit", { name: editItem.name })}</div>
            <IngredientCombobox value={fname} onPick={pickFromCatalog} groups={groupsFor(editItem.id)} />
            {fields}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={submit} style={btnP} disabled={blocked} data-testid="stock-save">{t("common.save")}</button>
              <button onClick={resetForm} style={btnS}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
