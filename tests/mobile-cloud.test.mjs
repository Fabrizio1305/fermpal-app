// Copies du carnet (lot L4, dans le kDrive depuis le 23/10), testables sans
// réseau : nommage et rétention des copies, décision d'envoi automatique,
// empreinte du carnet = empreinte de l'export, envoi / liste / restauration /
// purge sur un dépôt en mémoire (même interface que platform/kdrive.js).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeDriver } from "../mobile/src/db/nodeDriver.js";
import { runMigrations } from "../mobile/src/db/migrations.js";
import { saveRecipe } from "../mobile/src/data/recipes.js";
import { buildExportBundle, notebookFingerprint } from "../mobile/src/data/exportImport.js";
import { verifyBundle } from "../mobile/src/data/exportImport.js";
import { autoBackupIfDue, backupDate, backupFileName, downloadCloudBackup, listCloudBackups, selectPrunable, setAutoBackupEnabled, shouldAutoBackup, uploadBackup, AUTO_MIN_INTERVAL_MS, KEEP } from "../mobile/src/data/cloudBackups.js";

// localStorage minimal (absent sous Node) : état de la copie automatique.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

// Dépôt en mémoire : list / upload / download / remove, comme kdriveRemote.
function memoryRemote() {
  const files = new Map();
  return {
    files,
    async list() {
      return [...files].map(([name, bytes]) => ({ name, size: bytes.length }));
    },
    async upload(name, bytes) {
      if (files.has(name)) throw Object.assign(new Error("destination_already_exists"), { code: "destination_already_exists" });
      files.set(name, bytes);
    },
    async download(name) {
      return files.get(name);
    },
    async remove(names) {
      for (const n of names) files.delete(n);
    },
  };
}

test("backupFileName : horodatage UTC trié naturellement, relu par backupDate", () => {
  const d = new Date("2026-09-11T16:14:22.789Z");
  const name = backupFileName(d, 2, "android");
  assert.equal(name, "2026-09-11T16-14-22-789Z_v2_android.json");
  assert.equal(backupDate(name), Date.parse("2026-09-11T16:14:22.789Z"));
  // Anciens noms à la seconde : toujours lus.
  assert.equal(backupDate("2026-09-11T16-14-22Z_v2_android.json"), Date.parse("2026-09-11T16:14:22Z"));
  assert.equal(backupDate("autre-chose.json"), null);
  assert.equal(backupFileName(d, 2, "web/dev !"), "2026-09-11T16-14-22-789Z_v2_webdev.json");
  // Deux copies dans la même seconde : deux noms.
  assert.notEqual(backupFileName(new Date(d.getTime() + 1), 2, "android"), name);
  const later = backupFileName(new Date("2026-09-12T08:00:00Z"), 2, "android");
  assert.ok(later > name, "le nom le plus récent trie après");
});

test("selectPrunable : garde les KEEP plus récentes, rend les plus anciennes", () => {
  const files = Array.from({ length: 13 }, (_, i) => ({ name: backupFileName(new Date(Date.UTC(2026, 0, 1 + i)), 2, "android") }));
  const shuffled = [files[5], files[0], files[12], ...files.slice(1, 5), ...files.slice(6, 12)];
  const doomed = selectPrunable(shuffled, KEEP);
  assert.equal(doomed.length, 3);
  assert.deepEqual(doomed.map((f) => f.name), [files[2].name, files[1].name, files[0].name]);
  assert.deepEqual(selectPrunable(files.slice(0, 10), KEEP), []);
  assert.deepEqual(selectPrunable([], KEEP), []);
});

test("shouldAutoBackup : chaque garde dans l'ordre, puis « changed »", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  const base = { enabled: true, configured: true, online: true, fingerprint: "b", last: { at: now - 2 * AUTO_MIN_INTERVAL_MS, fingerprint: "a" }, now };
  assert.deepEqual(shouldAutoBackup({ ...base, configured: false }), { due: false, reason: "not_configured" });
  assert.deepEqual(shouldAutoBackup({ ...base, enabled: false }), { due: false, reason: "disabled" });
  assert.deepEqual(shouldAutoBackup({ ...base, online: false }), { due: false, reason: "offline" });
  assert.deepEqual(shouldAutoBackup({ ...base, fingerprint: "a" }), { due: false, reason: "unchanged" });
  assert.deepEqual(shouldAutoBackup({ ...base, last: { at: now - 60_000, fingerprint: "a" } }), { due: false, reason: "too_soon" });
  assert.deepEqual(shouldAutoBackup(base), { due: true, reason: "changed" });
  // Première copie : aucun historique → due.
  assert.deepEqual(shouldAutoBackup({ ...base, last: { at: null, fingerprint: null } }), { due: true, reason: "changed" });
});

test("notebookFingerprint = manifest.sha256 de l'export, et change avec le carnet", async () => {
  const db = createNodeDriver(":memory:");
  await runMigrations(db);
  await saveRecipe(db, { recipe: { title: "Kéfir test", type: "kefir_eau" }, phases: [{ key: "f1", name: "F1" }], ingredients: [] });
  const before = await notebookFingerprint(db);
  const bundle = await buildExportBundle(db, { platform: "node" });
  assert.equal(before, bundle.manifest.sha256);
  await saveRecipe(db, { recipe: { title: "Kombucha test", type: "kombucha" } });
  assert.notEqual(await notebookFingerprint(db), before);
  await db.close();
});

test("copie dans le dépôt : export complet vérifiable, listé, relu, purgé au-delà de KEEP", async () => {
  const db = createNodeDriver(":memory:");
  await runMigrations(db);
  await saveRecipe(db, { recipe: { title: "Kéfir test", type: "kefir_eau" }, phases: [{ key: "f1", name: "F1" }], ingredients: [] });
  const remote = memoryRemote();
  // Fichiers étrangers dans le dossier : ignorés par la liste et jamais purgés.
  remote.files.set("notes.txt", new Uint8Array([1]));
  for (let i = 1; i <= 12; i++) remote.files.set(backupFileName(new Date(Date.UTC(2025, 0, i)), 2, "android"), new TextEncoder().encode("{}"));

  const r = await uploadBackup(db, { platform: "android", remote });
  assert.equal(r.counts.recipes, 1);
  assert.equal(r.pruned, 3);
  const list = await listCloudBackups({ remote });
  assert.equal(list.length, KEEP);
  assert.equal(list[0].name, r.name, "la plus récente en tête");
  assert.ok(remote.files.has("notes.txt"));
  assert.equal(remote.files.has(backupFileName(new Date(Date.UTC(2025, 0, 3)), 2, "android")), false);

  const bundle = await downloadCloudBackup(r.name, { remote });
  assert.equal(bundle.manifest.counts.recipes, 1);
  await verifyBundle(bundle);
});

test("autoBackupIfDue : désactivée → rien ; activée → envoie une fois, puis « unchanged »", async () => {
  const db = createNodeDriver(":memory:");
  await runMigrations(db);
  await saveRecipe(db, { recipe: { title: "Kombucha test", type: "kombucha" } });
  const remote = memoryRemote();
  store.clear();
  assert.deepEqual(await autoBackupIfDue(db, { remote }), { done: false, reason: "disabled" });
  setAutoBackupEnabled(true);
  const first = await autoBackupIfDue(db, { remote, platform: "android" });
  assert.equal(first.done, true);
  assert.equal(first.reason, "uploaded");
  assert.equal(remote.files.size, 1);
  const second = await autoBackupIfDue(db, { remote, platform: "android" });
  assert.equal(second.reason, "unchanged");
  assert.equal(remote.files.size, 1);
});
