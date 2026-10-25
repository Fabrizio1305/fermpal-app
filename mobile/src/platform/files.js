// Sortie et lecture des fichiers d'export.
// Android : le fichier est écrit dans le cache privé de l'app puis proposé
// via la feuille de partage du système (Drive, Fichiers, mail… au choix de
// l'utilisateur) — aucun serveur FermPal. Web : téléchargement.
// Lecture : <input type="file"> natif (fonctionne dans la WebView Android).
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { exportFileName } from "../data/exportImport.js";

export async function exportToFile(bundle, { title = "Export FermPal" } = {}) {
  const fileName = exportFileName();
  const text = JSON.stringify(bundle);
  if (Capacitor.isNativePlatform()) {
    const path = `exports/${fileName}`;
    const { uri } = await Filesystem.writeFile({ path, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    try {
      await Share.share({ title, dialogTitle: title, files: [uri] });
      return { fileName, method: "share" };
    } catch (err) {
      // Feuille de partage refermée sans choix : ce n'est pas une erreur.
      if (/cancel/i.test(err?.message || "")) return { fileName, method: "share", cancelled: true };
      throw err;
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { fileName, method: "download" };
}

export async function readJsonFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Le fichier n'est pas un JSON valide.");
  }
}
