// Routeur à ancre (#/app/recipes/…), volontairement minuscule : pas de
// dépendance, fonctionne tel quel dans la WebView Capacitor (https://localhost)
// et en fichier statique. Les chemins reprennent ceux du site (/app/recipes)
// pour que les écrans portés changent le moins possible.
import { createContext, useContext, useEffect, useState } from "react";

export const DEFAULT_PATH = "/app";

export function getHashPath() {
  const h = window.location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : DEFAULT_PATH;
}

export function navigate(path, { replace = false } = {}) {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}

export function useHashPath() {
  const [path, setPath] = useState(getHashPath);
  useEffect(() => {
    const onChange = () => setPath(getHashPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

// "/app/recipes/:id" contre "/app/recipes/42" → { id: "42" } ; null sinon.
export function matchPath(pattern, path) {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("?")[0].split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export const RouteContext = createContext({ pathname: DEFAULT_PATH, params: {} });

export function useRoute() {
  return useContext(RouteContext);
}
