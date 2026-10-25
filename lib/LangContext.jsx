"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, STORAGE_KEY, detectLang, normalizeLang } from "./i18n/index.js";

// Langue du RENDU SERVEUR. Le français est le défaut depuis le 30/07 : sur une
// URL unique servant les deux langues (`/`, `/pricing`, `/faq`, `/login`), le
// HTML initial ne peut être que dans une seule langue — celle-ci doit être
// celle du marché visé et celle des métadonnées. Le `<title>`, la description
// et l'Open Graph de `app/layout.jsx` sont en français depuis toujours ; le
// corps partait en anglais, ce qui donnait à Google et aux aperçus de partage
// une page au titre français et au contenu anglais. L'anglais reste servi
// après hydratation, et la surface anglaise indexable existe déjà sur ses
// propres routes (`/en/tools`, `/en/blog`, `/en/fermentation-tracker`).
//
// Les langues gérées (fr, en, it…) sont dans lib/i18n : ce contexte ne porte
// que le choix courant.

const LangCtx = createContext({ lang: DEFAULT_LANG, setLang: () => {} });

// `initialLang` : l'app Android (pas de rendu serveur) passe detectLang() pour
// que le tout premier rendu — et les effets de montage des écrans — soient
// déjà dans la bonne langue. Le site laisse le défaut (HTML serveur en
// français) et corrige après hydratation.
export function LangProvider({ children, initialLang }) {
  const [lang, setLangState] = useState(() => normalizeLang(initialLang, DEFAULT_LANG));

  useEffect(() => {
    // Choix mémorisé d'abord ; sinon la langue du navigateur. Un anglophone
    // voit donc brièvement le français avant l'hydratation — c'est exactement
    // ce que subissaient les francophones jusqu'au 30/07, dans l'autre sens.
    setLangState(detectLang());
  }, []);

  useEffect(() => {
    // <html lang> statique ("fr" dans le layout) : on l'aligne sur la langue
    // réellement affichée pour les moteurs qui rendent le JS.
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l) => {
    const code = normalizeLang(l, DEFAULT_LANG);
    setLangState(code);
    localStorage.setItem(STORAGE_KEY, code);
  };

  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}
