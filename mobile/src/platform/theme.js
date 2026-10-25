// Apparence de l'app : "auto" (réglage du téléphone), "light" ou "dark".
// Mémorisée sur l'appareil (localStorage : convenance par appareil, pas une
// donnée du carnet). Appliquée par `data-theme` sur <html>, que theme.css lit,
// et aux barres système d'Android (heure, batterie, réseau ; barre du bas).
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

const KEY = "fermpal_theme";

export const THEMES = ["auto", "light", "dark"];

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

// Icônes des barres système : sombres sur le fond clair, claires sur le fond
// sombre. Sans ça, elles restaient sombres en mode sombre, donc invisibles.
function applySystemBars() {
  if (!Capacitor.isNativePlatform()) return;
  SystemBars.setStyle({ style: effectiveTheme() === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  applySystemBars();
}

export function applyStoredTheme() {
  applyTheme(getStoredTheme());
  // En mode « auto », suivre le téléphone quand il passe en clair ou en sombre.
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applySystemBars);
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : "auto";
  try {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // stockage indisponible : le réglage vaut pour cette session seulement
  }
  applyTheme(next);
  return next;
}

// Thème effectivement affiché (utile pour la barre d'état native).
export function effectiveTheme() {
  const stored = getStoredTheme();
  if (stored !== "auto") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
