// Liste de courses du carnet local. Cocher/décocher (avec mouvement de stock)
// passe par stockOperation("shopping_set") ; ici : lecture, ajout, retrait.

import { newId, nowIso, rowToShopping } from "./rows.js";

export async function listShopping(db) {
  return (await db.query("select * from shopping_list order by created_at, id")).map(rowToShopping);
}

// `rows` : [{ name, amount?, unit?, category?, source?, recipe_title? }]
export async function addShoppingRows(db, rows, { now } = {}) {
  const ts = nowIso(now);
  const clean = (rows || []).map((r) => ({
    name: String(r.name || "").trim(),
    amount: r.amount == null || r.amount === "" ? null : Number(r.amount),
    unit: r.unit || "g",
    category: r.category || "autre",
    source: r.source === "recipe_ai" ? "recipe_ai" : "manual",
    recipe_title: r.recipe_title || null,
  })).filter((r) => r.name);
  if (clean.length === 0) return [];
  const ids = [];
  await db.transaction(async () => {
    await db.runBatch(clean.map((r) => {
      const id = newId();
      ids.push(id);
      return {
        sql: "insert into shopping_list (id, name, amount, unit, category, source, recipe_title, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [id, r.name, r.amount, r.unit, r.category, r.source, r.recipe_title, ts],
      };
    }));
  });
  return ids;
}

export async function removeShoppingItem(db, id) {
  return db.transaction(async () => (await db.run("delete from shopping_list where id = ?", [id])).changes === 1);
}

export async function clearBought(db) {
  return db.transaction(async () => (await db.run("delete from shopping_list where checked = 1")).changes);
}
