// Crochets de test exposés sur window.__fermpal UNIQUEMENT quand le build est
// fait avec VITE_TEST_HOOKS=1 (suite Playwright en mode web). L'APK et le build
// normal n'en contiennent pas : le module est vide sans cette variable.
import { MIGRATIONS } from "./db/schema.js";
import { currentSchemaVersion, runMigrations } from "./db/migrations.js";
import { countRecipes } from "./data/recipes.js";
import { readAllData, canonicalJson, sha256Hex } from "./data/exportImport.js";
import { seedSyntheticRecipes } from "./data/seed.js";
import { backupBeforeChange } from "./db/openDatabase.js";
import { listBackups } from "./platform/backups.js";
import { seedStoreDemo } from "./data/storeDemo.js";

export function installTestHooks(db) {
  if (import.meta.env.VITE_TEST_HOOKS !== "1" || !db) return;
  window.__fermpal = {
    ready: true,
    platform: db.platform,
    version: () => currentSchemaVersion(db),
    count: () => countRecipes(db),
    fingerprint: async () => sha256Hex(canonicalJson(await readAllData(db))),
    seed: (n = 300) => seedSyntheticRecipes(db, { count: n }),
    // Carnet de démonstration des captures de la fiche Play (mobile/scripts/store-screenshots.mjs).
    storeDemo: (lang = "fr") => seedStoreDemo(db, lang),
    // Quantité en stock d'un ingrédient (par nom), pour vérifier les prélèvements.
    async stockQuantity(name) {
      const rows = await db.query("select quantity, unit from ingredients where name = ?", [name]);
      return rows[0] ? { quantity: Number(rows[0].quantity), unit: rows[0].unit } : null;
    },
    listBackups,
    // Lecture SQL libre (tests seulement).
    query: (sql, params = []) => db.query(sql, params),
    // Simule une coupure au milieu d'une migration vers une version suivante :
    // la table créée doit disparaître, la version et les données rester.
    async simulateInterruptedMigration() {
      const versionBefore = await currentSchemaVersion(db);
      const recipesBefore = await countRecipes(db);
      const backupsBefore = (await listBackups()).length;
      let error = null;
      try {
        await runMigrations(db, {
          migrations: [
            ...MIGRATIONS,
            {
              version: versionBefore + 1,
              name: "test_panne",
              sql: "create table test_panne (id text primary key); insert into test_panne values ('x');",
              up: async () => {
                throw new Error("panne simulée pendant la migration");
              },
            },
          ],
          beforeMigrate: ({ from, to }) => backupBeforeChange(db, `avant-migration-v${from}-vers-v${to}`),
        });
      } catch (err) {
        error = err.message;
      }
      const leftover = await db.query("select name from sqlite_master where type = 'table' and name = 'test_panne'");
      return {
        error,
        versionBefore,
        versionAfter: await currentSchemaVersion(db),
        recipesBefore,
        recipesAfter: await countRecipes(db),
        tableCreated: leftover.length > 0,
        backupsBefore,
        backupsAfter: (await listBackups()).length,
      };
    },
  };
}
