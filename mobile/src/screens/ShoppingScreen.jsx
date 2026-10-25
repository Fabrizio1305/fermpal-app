// Liste de courses du carnet local. Porté de app/app/shopping/page.jsx :
// cocher enregistre un achat dans le stock (opération journalisée).
import { useEffect, useState } from "react";
import Loading from "@/app/components/Loading";
import { ingredientIcon } from "@/lib/ingredientCategories";
import { findStockItem } from "@/lib/ingredientMatcher";
import { useToast } from "@/lib/UiContext";
import { inp, btnP, btnS, card, COLORS } from "@/lib/uiStyles";
import MobileShell from "../components/MobileShell.jsx";
import { useDb } from "../App.jsx";
import { listShopping, addShoppingRows, removeShoppingItem, clearBought } from "../data/shopping.js";
import { listStock, listAliases } from "../data/stock.js";
import { stockSnapshot } from "../data/stockOperations.js";
import { useStockOps } from "../hooks/useStockOps.js";
import { useT } from "@/lib/i18n/useT";

const UNITS = ["g", "kg", "ml", "L", "pcs", "sachet"];


export default function ShoppingScreen() {
  const { db } = useDb();
  const { t } = useT();
  const toast = useToast();
  const ops = useStockOps(db);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("g");
  const blocked = ops.busy;

  const load = async () => {
    setItems(await listShopping(db));
    setLoaded(true);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const add = async (e) => {
    e.preventDefault();
    const value = name.trim();
    if (!value || blocked) return;
    await ops.act(async () => {
      await addShoppingRows(db, [{ name: value, amount: amount ? Number(amount) : null, unit }]);
      setName("");
      setAmount("");
    });
    await load();
  };

  const toggle = async (item) => {
    if (blocked) return;
    const payload = { shoppingId: item.id, expectedRevision: item.stock_revision, checked: !item.checked };
    if (payload.checked) {
      const [stock, aliases] = await Promise.all([listStock(db), listAliases(db)]);
      const { item: match } = findStockItem(item.name, stock, aliases);
      payload.stockId = match?.id || null;
      payload.expectedStock = stockSnapshot(stock);
    }
    const result = await ops.run("shopping_set", payload);
    await load();
    if (!result) return;
    const movements = result.movements || [];
    if (movements.some((m) => Number(m.delta) > 0)) toast(t("shopping.restocked2"));
    else if (movements.some((m) => m.reason === "incompatible_unit")) toast(t("shopping.incompatible"));
    else if (movements.some((m) => m.reason === "no_amount")) toast(t("shopping.noAmount"));
  };

  const remove = async (id) => {
    if (blocked) return;
    await ops.act(() => removeShoppingItem(db, id));
    await load();
  };

  const clearAll = async () => {
    if (blocked) return;
    await ops.act(() => clearBought(db));
    await load();
  };

  if (!loaded) return <Loading />;

  const toBuy = items.filter((i) => !i.checked);
  const bought = items.filter((i) => i.checked);

  const row = (item) => (
    <div key={item.id} data-testid="shopping-item" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${COLORS.soft}`, opacity: item.checked ? 0.55 : 1 }}>
      <input type="checkbox" disabled={blocked} checked={item.checked} onChange={() => toggle(item)} aria-label={t("shopping.bought2", { name: item.name })} style={{ width: 20, height: 20, cursor: "pointer" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, textDecoration: item.checked ? "line-through" : "none" }}>
          {ingredientIcon(item.name, item.category)} {item.name}
          {item.amount != null ? <span style={{ color: COLORS.muted, fontWeight: 500 }}> · {item.amount} {item.unit}</span> : null}
        </div>
        {item.recipe_title && <div style={{ fontSize: 10, color: COLORS.faint }}>✨ {t("shopping.from")} « {item.recipe_title} »</div>}
      </div>
      <button disabled={blocked} onClick={() => remove(item.id)} aria-label={t("common.delete3", { name: item.name })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLORS.faint, minWidth: 36, minHeight: 36 }}>
        ✕
      </button>
    </div>
  );

  return (
    <MobileShell title={`🛒 ${t("shopping.title")}`} back="/app/stock" backLabel="Stock">
      <div style={{ fontSize: 12, color: COLORS.faint, margin: "-10px 0 16px" }}>{t("shopping.restockHint2")}</div>
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input style={{ ...inp, flex: 1, minWidth: 0 }} placeholder={t("shopping.namePh")} value={name} onChange={(e) => setName(e.target.value)} data-testid="shopping-name" />
        <input style={{ ...inp, width: 70, flex: "none" }} type="number" min="0" step="any" placeholder={t("shopping.qty")} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t("common.amount")} />
        <select style={{ ...inp, width: "auto", flex: "none" }} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={t("common.unit")}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button type="submit" style={btnP} disabled={blocked}>{t("common.add")}</button>
      </form>

      {items.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🛒</div>
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>{t("shopping.empty2")}</div>
        </div>
      ) : (
        <div style={card}>
          {toBuy.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, marginBottom: 4 }}>{t("shopping.toBuy")} ({toBuy.length})</div>
              {toBuy.map(row)}
            </>
          )}
          {bought.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, margin: "14px 0 4px" }}>{t("shopping.bought")} ({bought.length})</div>
              {bought.map(row)}
              <button disabled={blocked} onClick={clearAll} style={{ ...btnS, width: "100%", marginTop: 12 }}>{t("shopping.clear")}</button>
            </>
          )}
        </div>
      )}
    </MobileShell>
  );
}
