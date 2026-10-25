// Diagnostic embarqué : ce que l'app voit réellement sur l'appareil, pour
// comprendre un défaut sans brancher le téléphone à un ordinateur. Rien n'est
// envoyé nulle part : c'est affiché dans Paramètres → Diagnostic, et c'est
// l'utilisateur qui décide d'en faire une capture.
import { Capacitor } from "@capacitor/core";

const MAX_ERRORS = 10;
const errors = [];

// Aussi appelé pour les erreurs ATTRAPÉES (toast) : le message affiché passe,
// le diagnostic garde le détail (statut HTTP, code Supabase).
export function recordError(kind, err) {
  const parts = [err?.message || (typeof err === "string" ? err : JSON.stringify(err ?? null))];
  if (err?.status) parts.push(`HTTP ${err.status}`);
  if (err?.code && typeof err.code === "string") parts.push(err.code);
  errors.unshift({ at: new Date().toISOString().slice(11, 19), kind, message: parts.join(" · ").slice(0, 300) });
  if (errors.length > MAX_ERRORS) errors.pop();
}
const record = recordError;

export function installErrorCapture() {
  if (typeof window === "undefined" || window.__fermpalDiag) return;
  window.__fermpalDiag = true;
  window.addEventListener("error", (e) => record("error", e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => record("promesse", e.reason));
}

export function recentErrors() {
  return errors.slice();
}

export const NATIVE_PLUGINS = ["CapacitorSQLite", "LocalNotifications", "Filesystem", "Share", "App"];

export function nativeInfo() {
  const headers = (typeof window !== "undefined" && window.Capacitor?.PluginHeaders) || [];
  return {
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    plugins: Object.fromEntries(NATIVE_PLUGINS.map((name) => [name, Capacitor.isPluginAvailable(name)])),
    registered: headers.map((h) => h.name),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    online: typeof navigator === "undefined" ? null : navigator.onLine,
  };
}

// Sonde des services connectés : un GET vers chaque hôte autorisé par la CSP,
// statut HTTP ou message d'erreur (« Failed to fetch » = bloqué avant le réseau :
// CSP, DNS, pas de connexion). Ne prouve rien d'autre que « ça passe ».
export async function probeHost(url, { headers, timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.name === "TimeoutError" ? "délai dépassé" : err?.message || String(err) };
  }
}

// Promesse bornée dans le temps : renvoie { ok, value } ou { ok: false, timeout: true }.
export function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, timeout: true }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error });
      },
    );
  });
}
