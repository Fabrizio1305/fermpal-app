// Copie le moteur sql.js (wasm) dans les fichiers publics de l'app pour le
// mode WEB (jeep-sqlite le charge depuis assets/sql-wasm.wasm — jamais depuis
// un CDN). Sur Android, le plugin SQLite natif n'en a pas besoin. Le fichier
// copié est ignoré par git ; ce script tourne avant chaque build.
//
// ⚠️ Le wasm doit être de la MÊME version de sql.js que la glue JavaScript
// figée dans jeep-sqlite (2.8.0 → sql.js 1.11.x). Un wasm plus récent (1.14)
// échoue au chargement (« LinkError: function import requires a callable »,
// constaté le 11/09). D'où l'épinglage `sql.js@1.11.0` en devDependency.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqljsDir = path.resolve(here, "../../node_modules/sql.js");
const version = JSON.parse(readFileSync(path.join(sqljsDir, "package.json"), "utf8")).version;
if (!version.startsWith("1.11.")) {
  console.error(`sql.js ${version} installé : jeep-sqlite 2.8.0 attend un wasm 1.11.x (voir commentaire en tête).`);
  process.exit(1);
}
const src = path.join(sqljsDir, "dist/sql-wasm.wasm");
const dstDir = path.resolve(here, "../public/assets");
mkdirSync(dstDir, { recursive: true });
copyFileSync(src, path.join(dstDir, "sql-wasm.wasm"));
console.log("sql-wasm.wasm copié dans mobile/public/assets/");
