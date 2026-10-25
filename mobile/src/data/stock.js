// Lecture du stock et des alias. Les écritures passent par stockOperation
// (stock_create / stock_update / stock_remove) et upsertAlias (batches.js).

export async function listStock(db) {
  return db.query("select * from ingredients order by created_at, id");
}

export async function listAliases(db) {
  return db.query("select alias, stock_name from ingredient_aliases order by alias");
}
