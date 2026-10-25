"use client";

// Hook des composants : `t` lié à la langue du LangContext. Séparé de
// ./index.js pour que les modules serveur (route IA, rappels) importent le
// socle sans tirer React ni le contexte client.
import { useCallback } from "react";
import { useLang } from "../LangContext.jsx";
import { t as translate } from "./index.js";

export function useT() {
  const { lang, setLang } = useLang();
  const t = useCallback((key, vars) => translate(key, vars, lang), [lang]);
  return { t, lang, setLang };
}
