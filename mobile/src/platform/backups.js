// Copies de secours automatiques (avant migration, avant restauration).
// Android : fichiers JSON dans le dossier privé de l'app (Directory.Data,
// hors sauvegarde cloud, supprimés avec l'app). Web de développement :
// IndexedDB. Nombre borné : les plus anciennes sont purgées.
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

const DIR = "backups";
const KEEP = 8;

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function isNative() {
  return Capacitor.isNativePlatform();
}

// --- IndexedDB (web) ---------------------------------------------------------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fermpal-backups", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(storeMode, fn) {
  return idb().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction("files", storeMode);
        const store = tx.objectStore("files");
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => database.close();
      }),
  );
}

// --- API ---------------------------------------------------------------------
export async function saveBackup(label, bundle) {
  const name = `${label}-${stamp()}.json`;
  const text = JSON.stringify(bundle);
  if (isNative()) {
    await Filesystem.writeFile({ path: `${DIR}/${name}`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  } else {
    await idbRequest("readwrite", (s) => s.put({ name, text, mtime: Date.now(), size: text.length }));
  }
  await pruneBackups(KEEP);
  return name;
}

export async function listBackups() {
  let items;
  if (isNative()) {
    try {
      const res = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
      items = res.files.filter((f) => f.name.endsWith(".json")).map((f) => ({ name: f.name, mtime: f.mtime, size: f.size }));
    } catch {
      items = [];
    }
  } else {
    items = (await idbRequest("readonly", (s) => s.getAll())).map(({ name, mtime, size }) => ({ name, mtime, size }));
  }
  return items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name));
}

export async function readBackup(name) {
  let text;
  if (isNative()) {
    const res = await Filesystem.readFile({ path: `${DIR}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
    text = res.data;
  } else {
    text = (await idbRequest("readonly", (s) => s.get(name)))?.text;
  }
  if (!text) throw new Error("backup_not_found");
  return JSON.parse(text);
}

export async function deleteBackup(name) {
  if (isNative()) await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: Directory.Data });
  else await idbRequest("readwrite", (s) => s.delete(name));
}

export async function pruneBackups(keep = KEEP) {
  const all = await listBackups();
  for (const b of all.slice(keep)) await deleteBackup(b.name).catch(() => {});
}
