// Pilote SQLite pour les tests Node (node:sqlite, intégré à Node ≥ 22.13).
// Même interface que le pilote Capacitor (driver.js) : la couche données et
// les migrations sont testées sur un vrai moteur SQLite, sans émulateur.
// Jamais embarqué dans l'application.

import { DatabaseSync } from "node:sqlite";

export function createNodeDriver(path = ":memory:") {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("pragma foreign_keys = on");
  let inTransaction = false;

  return {
    platform: "node",
    async query(sql, params = []) {
      // Objets ordinaires (node:sqlite renvoie des objets sans prototype) : comparables aux
      // résultats rejoués depuis le JSON.
      return sqlite.prepare(sql).all(...params).map((r) => ({ ...r }));
    },
    async run(sql, params = []) {
      const r = sqlite.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async exec(sql) {
      sqlite.exec(sql);
    },
    async runBatch(items) {
      const prepared = new Map();
      let changes = 0;
      for (const { sql, params = [] } of items) {
        if (!prepared.has(sql)) prepared.set(sql, sqlite.prepare(sql));
        changes += Number(prepared.get(sql).run(...params).changes);
      }
      return { changes };
    },
    async transaction(fn) {
      if (inTransaction) throw new Error("transaction imbriquée refusée");
      sqlite.exec("begin immediate");
      inTransaction = true;
      try {
        const result = await fn();
        sqlite.exec("commit");
        return result;
      } catch (err) {
        sqlite.exec("rollback");
        throw err;
      } finally {
        inTransaction = false;
      }
    },
    async persist() {},
    async close() {
      sqlite.close();
    },
  };
}
