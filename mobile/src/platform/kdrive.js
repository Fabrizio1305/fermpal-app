// Copie du carnet dans le kDrive (Infomaniak) de l'utilisateur : dossier
// « FermPal/sauvegardes-app » de son espace privé. Accès : un
// jeton d'API Infomaniak (droit « kDrive ») et le n° du kDrive, gardés sur le
// téléphone seulement (jamais dans les exports ni les copies). kDrive refuse les
// appels d'une page web : tout passe par platform/http.js (canal natif).
// Même schéma que MyGarden ; ici un seul dossier, une copie = un fichier JSON.
import { request as defaultRequest } from "./http.js";

const KEY = "fermpal.kdrive"; // { token, driveId, folder }
export const KDRIVE_API = "https://api.infomaniak.com";
export const APP_FOLDER = "FermPal";
export const BACKUP_FOLDER = "sauvegardes-app";

function read() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) || "null");
  } catch {
    return null;
  }
}
function write(value) {
  try {
    if (value) globalThis.localStorage?.setItem(KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* non mémorisé */
  }
}

export const kdriveConfigured = () => !!read()?.folder;
export const forgetKdrive = () => write(null);

const fail = (code, extra) => Object.assign(new Error(code), { code, ...extra });

function client({ token, driveId, request = defaultRequest }) {
  const call = async (method, path, { body, responseType = "json", headers = {} } = {}) => {
    let res;
    try {
      res = await request({ method, url: `${KDRIVE_API}${path}`, headers: { Authorization: `Bearer ${token}`, ...headers }, body, responseType });
    } catch {
      throw fail("network");
    }
    if (res.status === 401 || res.status === 403) throw fail("bad_token");
    if (responseType === "json" && res.data?.result === "error") throw fail(res.data.error?.code || "kdrive_error", { status: res.status });
    if (res.status >= 400) throw fail("kdrive_error", { status: res.status });
    return res.data;
  };
  // Tous les éléments d'un dossier (pages suivies).
  const children = async (dirId) => {
    const out = [];
    let cursor = null;
    do {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page = await call("GET", `/3/drive/${driveId}/files/${dirId}/files${q}`);
      out.push(...(page.data || []));
      cursor = page.has_more ? page.cursor : null;
    } while (cursor);
    return out;
  };
  const ensureDir = async (parentId, name) => {
    const found = (await children(parentId)).find((f) => f.type === "dir" && f.name === name);
    if (found) return found.id;
    return (await call("POST", `/3/drive/${driveId}/files/${parentId}/directory`, { body: { name }, headers: { "Content-Type": "application/json" } })).data.id;
  };
  return { call, children, ensureDir };
}

// Première connexion : vérifie le jeton, trouve l'espace privé, crée (ou retrouve)
// « FermPal/sauvegardes-app », puis mémorise le tout.
export async function setupKdrive({ token, driveId }, { request } = {}) {
  const t = String(token || "").trim();
  const d = String(driveId || "").trim();
  if (!t || !/^\d+$/.test(d)) throw fail("bad_config");
  const c = client({ token: t, driveId: d, request });
  const top = await c.children(1);
  const privateDir = top.find((f) => f.visibility === "is_private_space") || top.find((f) => f.type === "dir" && f.name === "Private");
  if (!privateDir) throw fail("kdrive_error");
  const folder = await c.ensureDir(await c.ensureDir(privateDir.id, APP_FOLDER), BACKUP_FOLDER);
  write({ token: t, driveId: d, folder });
  return folder;
}

// Dépôt distant pour data/cloudBackups.js : list, upload, download, remove (par nom).
export function kdriveRemote({ request, config = read() } = {}) {
  if (!config?.folder) throw fail("not_configured");
  const c = client({ token: config.token, driveId: config.driveId, request });
  const ids = new Map(); // nom → n° de fichier kDrive
  const idOf = async (name) => {
    if (!ids.has(name)) await remote.list();
    const id = ids.get(name);
    if (!id) throw fail("not_found");
    return id;
  };
  const remote = {
    async list() {
      const files = (await c.children(config.folder)).filter((f) => f.type === "file");
      ids.clear();
      for (const f of files) ids.set(f.name, f.id);
      return files.map((f) => ({ name: f.name, size: f.size ?? null }));
    },
    // Toujours en octets bruts : sous Android, un type « application/json » ferait
    // partir le texte base64 au lieu du fichier (CapacitorHttp) ; kDrive déduit le
    // type du nom.
    async upload(name, bytes) {
      const q = new URLSearchParams({ directory_id: String(config.folder), file_name: name, total_size: String(bytes.length), conflict: "error" });
      const res = await c.call("POST", `/3/drive/${config.driveId}/upload?${q}`, { body: bytes, headers: { "Content-Type": "application/octet-stream" } });
      if (res?.data?.id) ids.set(name, res.data.id);
    },
    async download(name) {
      return c.call("GET", `/2/drive/${config.driveId}/files/${await idOf(name)}/download`, { responseType: "bytes" });
    },
    async remove(names) {
      for (const n of names) {
        await c.call("DELETE", `/2/drive/${config.driveId}/files/${await idOf(n)}`);
        ids.delete(n);
      }
    },
  };
  return remote;
}
