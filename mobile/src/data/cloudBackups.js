// Copie du carnet dans le kDrive (23/10, usage personnel — remplace la
// sauvegarde Supabase du lot L4) : le paquet d'export complet — même format que
// « Exporter », empreinte incluse, donc restaurable par le même chemin vérifié —
// déposé dans « FermPal/sauvegardes-app » (platform/kdrive.js). La rétention
// (10 copies) est appliquée ici après chaque envoi. `remote` : dépôt injectable
// (tests), par défaut le kDrive relié dans Réglages.
import { buildExportBundle, notebookFingerprint } from "./exportImport.js";
import { kdriveConfigured, kdriveRemote } from "../platform/kdrive.js";

export const KEEP = 10;
// Envois automatiques regroupés : pas plus d'un toutes les 10 min, et
// seulement si le carnet a changé depuis la dernière copie (manuelle ou non).
export const AUTO_MIN_INTERVAL_MS = 10 * 60 * 1000;

const KEYS = { auto: "fermpal.cloud.auto", lastAt: "fermpal.cloud.lastAt", lastFingerprint: "fermpal.cloud.lastFingerprint", lastAuto: "fermpal.cloud.lastAuto" };

function read(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, String(value));
  } catch {
    /* stockage indisponible : l'état revient au prochain lancement */
  }
}

export function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function autoBackupEnabled() {
  return read(KEYS.auto) === "1";
}
export function setAutoBackupEnabled(on) {
  write(KEYS.auto, on ? "1" : "0");
}
// { at: ms | null, fingerprint: string | null } de la dernière copie réussie
// depuis cet appareil.
export function lastBackupInfo() {
  const at = Number(read(KEYS.lastAt)) || null;
  return { at, fingerprint: read(KEYS.lastFingerprint) };
}
function rememberBackup(fingerprint, at = Date.now()) {
  write(KEYS.lastAt, at);
  write(KEYS.lastFingerprint, fingerprint);
}
export function forgetBackupState() {
  write(KEYS.lastAt, null);
  write(KEYS.lastFingerprint, null);
  write(KEYS.lastAuto, null);
}

// Dernière tentative automatique ({ at, done, reason, error? }) : affichée sous
// la case « Copie automatique » — sinon l'utilisateur ne peut pas distinguer
// « rien à envoyer » de « ça ne marche pas » (retour du Pixel, 12/09).
export const AUTO_EVENT = "fermpal:cloud-auto";
export function lastAutoAttempt() {
  try {
    return JSON.parse(read(KEYS.lastAuto) || "null");
  } catch {
    return null;
  }
}
function rememberAutoAttempt(result, at = Date.now()) {
  const entry = { at, ...result };
  write(KEYS.lastAuto, JSON.stringify(entry));
  try {
    globalThis.dispatchEvent?.(new CustomEvent(AUTO_EVENT, { detail: entry }));
  } catch {
    /* hors navigateur */
  }
  return entry;
}

// Nom de fichier = horodatage UTC à la milliseconde, trié naturellement +
// version de schéma + plateforme : « 2026-09-11T16-14-22-789Z_v2_android.json ».
// À la seconde, deux copies rapprochées (manuelle + automatique, double appui)
// portaient le même nom et la seconde était refusée « existe déjà » (vu en test).
export function backupFileName(date = new Date(), schemaVersion = 0, platform = "unknown") {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `${stamp}_v${schemaVersion}_${String(platform).replace(/[^a-z0-9]/gi, "") || "unknown"}.json`;
}

// Date (ms) d'une copie d'après son nom ; null si le nom n'est pas le nôtre.
export function backupDate(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z_/.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] || "000"}Z`) : null;
}

// Copies au-delà de `keep`, les plus anciennes (par nom = horodatage).
export function selectPrunable(files, keep = KEEP) {
  const recentFirst = [...files].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return recentFirst.slice(Math.max(0, keep));
}

// Faut-il envoyer une copie automatique maintenant ? Pur ; la raison sert à
// l'affichage et aux tests.
export function shouldAutoBackup({ enabled, configured, online, fingerprint, last, now = Date.now(), minInterval = AUTO_MIN_INTERVAL_MS }) {
  if (!configured) return { due: false, reason: "not_configured" };
  if (!enabled) return { due: false, reason: "disabled" };
  if (!online) return { due: false, reason: "offline" };
  if (last?.fingerprint && last.fingerprint === fingerprint) return { due: false, reason: "unchanged" };
  if (last?.at && now - last.at < minInterval) return { due: false, reason: "too_soon" };
  return { due: true, reason: "changed" };
}

export async function uploadBackup(db, { platform = "unknown", remote = kdriveRemote() } = {}) {
  const bundle = await buildExportBundle(db, { platform });
  const name = backupFileName(new Date(), bundle.schemaVersion, platform);
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  await remote.upload(name, bytes);
  rememberBackup(bundle.manifest.sha256);
  let pruned = 0;
  try {
    pruned = await pruneCloudBackups({ remote });
  } catch {
    /* la rétention se rattrape à la copie suivante */
  }
  return { name, size: bytes.length, counts: bundle.manifest.counts, pruned };
}

// [{ name, size, at }] du plus récent au plus ancien (nos copies seulement).
export async function listCloudBackups({ remote = kdriveRemote() } = {}) {
  return (await remote.list())
    .filter((f) => typeof f.name === "string" && f.name.endsWith(".json") && backupDate(f.name) != null)
    .map((f) => ({ name: f.name, size: Number(f.size) || null, at: backupDate(f.name) }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

// Paquet d'une copie (à passer à verifyBundle / restoreBundle).
export async function downloadCloudBackup(name, { remote = kdriveRemote() } = {}) {
  return JSON.parse(new TextDecoder().decode(await remote.download(name)));
}

export async function deleteCloudBackup(name, { remote = kdriveRemote() } = {}) {
  await remote.remove([name]);
}

export async function pruneCloudBackups({ remote = kdriveRemote(), keep = KEEP } = {}) {
  const doomed = selectPrunable(await listCloudBackups({ remote }), keep);
  if (doomed.length === 0) return 0;
  await remote.remove(doomed.map((f) => f.name));
  return doomed.length;
}

// Envoi automatique si dû — appelé à l'ouverture et au retour au premier plan
// (App.jsx). Ne lève jamais : renvoie { done, reason }.
export async function autoBackupIfDue(db, { platform = "unknown", now = Date.now(), remote } = {}) {
  const configured = remote ? true : kdriveConfigured();
  const enabled = autoBackupEnabled();
  // Désactivée ou non reliée : rien à consigner (pas de ligne d'état à afficher).
  if (!configured || !enabled) return { done: false, reason: configured ? "disabled" : "not_configured" };
  try {
    if (!isOnline()) return rememberAutoAttempt({ done: false, reason: "offline" }, now);
    const fingerprint = await notebookFingerprint(db);
    const verdict = shouldAutoBackup({ enabled, configured, online: true, fingerprint, last: lastBackupInfo(), now });
    if (!verdict.due) return rememberAutoAttempt({ done: false, reason: verdict.reason }, now);
    const result = await uploadBackup(db, { platform, remote: remote || kdriveRemote() });
    return rememberAutoAttempt({ done: true, reason: "uploaded", name: result.name, size: result.size, pruned: result.pruned }, now);
  } catch (error) {
    return rememberAutoAttempt({ done: false, reason: "error", error: error?.code || error?.message || String(error) }, now);
  }
}
