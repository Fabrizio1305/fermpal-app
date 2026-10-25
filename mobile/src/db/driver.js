// Pilote SQLite de l'application (Android natif et mode web de développement),
// au-dessus de @capacitor-community/sqlite. Interface commune avec
// nodeDriver.js (tests) :
//   query(sql, params) → lignes ; run(sql, params) → { changes } ; exec(sql) ;
//   transaction(fn) ; persist() ; close().
//
// Sur le web, le moteur (jeep-sqlite / sql.js) travaille en mémoire et ne
// persiste dans IndexedDB qu'à `saveToStore` : `persist()` l'appelle après
// chaque transaction validée. Sur Android, le fichier SQLite est durable de
// lui-même et `persist()` ne fait rien. Le mode web sert aux tests, pas à
// prouver la durabilité Android (cadrage §4).

import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

let connection = null;
let webStoreReady = false;

export function isNative() {
  return Capacitor.isNativePlatform();
}

async function getConnection() {
  if (!connection) connection = new SQLiteConnection(CapacitorSQLite);
  if (!isNative() && !webStoreReady) {
    // Le composant <jeep-sqlite> est déclaré dans index.html ; il charge
    // assets/sql-wasm.wasm depuis l'application elle-même (aucun CDN).
    await customElements.whenDefined("jeep-sqlite");
    await connection.initWebStore();
    webStoreReady = true;
  }
  return connection;
}

// Le plugin natif ne supprime une base que si sa connexion est enregistrée
// (« No available connection for database … » sinon — vu sur le Pixel le
// 13/09 : le fichier temporaire d'une restauration précédente ne pouvait plus
// être effacé, et toute restauration suivante échouait). On ouvre donc (ou
// récupère) la connexion, puis delete() qui efface et ferme.
export async function deleteDatabaseIfExists(database) {
  const conn = await getConnection();
  const hasConnection = (await conn.isConnection(database, false)).result;
  if (!(await conn.isDatabase(database)).result) {
    if (hasConnection) await conn.closeConnection(database, false).catch(() => {});
    return;
  }
  const db = hasConnection ? await conn.retrieveConnection(database, false) : await conn.createConnection(database, false, "no-encryption", 1, false);
  try {
    await db.open().catch(() => {});
    await db.delete();
  } catch (err) {
    // Dernier recours : l'ancien chemin (suffit en mode web).
    await CapacitorSQLite.deleteDatabase({ database }).catch(() => {
      throw err;
    });
  } finally {
    await conn.closeConnection(database, false).catch(() => {});
  }
}

export async function openDriver(database) {
  const conn = await getConnection();
  const consistent = (await conn.checkConnectionsConsistency()).result;
  const exists = (await conn.isConnection(database, false)).result;
  const db = consistent && exists ? await conn.retrieveConnection(database, false) : await conn.createConnection(database, false, "no-encryption", 1, false);
  await db.open();
  await db.execute("pragma foreign_keys = on", false);
  let inTransaction = false;
  const web = !isNative();

  const driver = {
    platform: web ? "web" : Capacitor.getPlatform(),
    database,
    async query(sql, params = []) {
      const res = await db.query(sql, params);
      return res.values || [];
    },
    async run(sql, params = []) {
      const res = await db.run(sql, params, false);
      return { changes: res.changes?.changes ?? 0 };
    },
    async exec(sql) {
      await db.execute(sql, false);
    },
    // Lot d'instructions paramétrées en UN aller-retour vers le moteur : le
    // pont natif (et le composant web) coûte cher par appel — 300 recettes
    // font ~2 500 insertions.
    async runBatch(items) {
      if (items.length === 0) return { changes: 0 };
      const res = await db.executeSet(items.map((i) => ({ statement: i.sql, values: i.params || [] })), false);
      return { changes: res.changes?.changes ?? 0 };
    },
    async transaction(fn) {
      if (inTransaction) throw new Error("transaction imbriquée refusée");
      await db.beginTransaction();
      inTransaction = true;
      try {
        const result = await fn();
        await db.commitTransaction();
        inTransaction = false;
        await driver.persist();
        return result;
      } catch (err) {
        inTransaction = false;
        try {
          await db.rollbackTransaction();
        } catch {
          // La transaction a pu être déjà annulée par le moteur.
        }
        throw err;
      }
    },
    async persist() {
      if (web) await conn.saveToStore(database);
    },
    async close() {
      await conn.closeConnection(database, false);
    },
    // Supprime le fichier de base (bases temporaires de restauration) et
    // FERME la connexion : à appeler à la place de close(), pas après (le
    // plugin natif refuse de supprimer une base dont la connexion est fermée).
    async destroy() {
      await db.delete();
      await conn.closeConnection(database, false).catch(() => {});
    },
  };
  return driver;
}
