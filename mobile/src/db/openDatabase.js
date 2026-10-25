// Ouverture de la base principale du carnet : migrations (avec copie de
// secours préalable si la base contient déjà quelque chose), puis vérification
// avant usage normal. En cas d'échec, la base est rendue quand même à
// l'appelant pour permettre l'EXPORT (écran de récupération), jamais
// l'écriture, et jamais de remise à zéro automatique (cadrage §4).
import { Capacitor } from "@capacitor/core";
import { openDriver, deleteDatabaseIfExists } from "./driver.js";
import { runMigrations, verifyDatabase } from "./migrations.js";
import { DATA_TABLES } from "./schema.js";
import { buildExportBundle } from "../data/exportImport.js";
import { saveBackup } from "../platform/backups.js";

export const MAIN_DB = "fermpal_carnet";
export const TEMP_DB = "fermpal_restore_tmp";
export const EXPECTED_TABLES = [...DATA_TABLES, "schema_migrations"];

export function platformName() {
  return Capacitor.getPlatform();
}

// Copie cohérente de l'état courant, nommée, avant une opération qui le change.
export async function backupBeforeChange(db, label) {
  const bundle = await buildExportBundle(db, { platform: platformName() });
  const name = await saveBackup(label, bundle);
  return { name, bundle };
}

export async function openMainDatabase() {
  const db = await openDriver(MAIN_DB);
  try {
    const migration = await runMigrations(db, {
      beforeMigrate: ({ from, to }) => backupBeforeChange(db, `avant-migration-v${from}-vers-v${to}`),
    });
    await verifyDatabase(db, { expectedTables: EXPECTED_TABLES });
    return { db, migration, error: null };
  } catch (error) {
    return { db, migration: null, error };
  }
}

// Base jetable pour la répétition générale d'une restauration. Un reste d'un
// essai interrompu est supprimé d'abord : on part toujours d'une base vide.
// Si ce reste ne peut pas être effacé (Android, 13/09), on prend un nom
// unique plutôt que d'échouer — ou pire, de répéter dans une base non vide.
export async function openTempDatabase() {
  try {
    await deleteDatabaseIfExists(TEMP_DB);
    return await openDriver(TEMP_DB);
  } catch {
    return openDriver(`${TEMP_DB}_${Date.now()}`);
  }
}
