// Socle multilangue du carnet (web + app Android) — chantier I, plan dans
// docs/I18N-PLAN-2026-09-16.md. Un dictionnaire JSON plat par langue
// (clé "écran.élément" → texte), le français est la langue de développement
// et le repli. Aucune librairie, aucun React : les modules sans composant
// (phaseTiming, reminders, route IA…) appellent t() avec la langue explicite ;
// les composants passent par useT() (./useT.js). Ajouter une langue = un
// fichier JSON + une entrée dans SUPPORTED_LANGS.
import fr from "./fr.json" with { type: "json" };
import en from "./en.json" with { type: "json" };
import it from "./it.json" with { type: "json" };

export const SUPPORTED_LANGS = ["fr", "en", "it"];
export const DEFAULT_LANG = "fr";
// Un navigateur dans une langue non gérée (allemand…) est traité comme
// international : anglais, comme avant le chantier.
export const BROWSER_FALLBACK_LANG = "en";
export const STORAGE_KEY = "fermpal_lang";

// Noms natifs, jamais traduits : c'est ce qu'un utilisateur cherche dans un
// sélecteur de langue.
export const LANG_NAMES = { fr: "Français", en: "English", it: "Italiano" };
export const LANG_FLAGS = { fr: "🇫🇷", en: "🇬🇧", it: "🇮🇹" };

// Locale des dates et nombres : un seul endroit (avant : "fr-CH"/"en-GB" en
// dur dans 5 fichiers, "fr-FR"/"en-US" dans un sixième).
const LOCALES = { fr: "fr-CH", en: "en-GB", it: "it-CH" };

export const DICTIONARIES = { fr, en, it };

// "en-US" → "en", "IT" → "it", null / "de" → fallback.
export function normalizeLang(value, fallback = DEFAULT_LANG) {
  if (typeof value !== "string") return fallback;
  const code = value.toLowerCase().slice(0, 2);
  return SUPPORTED_LANGS.includes(code) ? code : fallback;
}

export function localeFor(lang) {
  return LOCALES[normalizeLang(lang)];
}

// Langue à afficher sur cet appareil : choix mémorisé, sinon langue du
// navigateur, sinon anglais. Côté client uniquement (localStorage/navigator) ;
// sans eux, renvoie le défaut serveur.
export function detectLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage indisponible (SSR, mode privé verrouillé) : on continue.
  }
  if (SUPPORTED_LANGS.includes(saved)) return saved;
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  return normalizeLang(navigator.language || "", BROWSER_FALLBACK_LANG);
}

const warned = new Set();
function warnMissing(key, lang) {
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") return;
  const tag = `${lang}:${key}`;
  if (warned.has(tag)) return;
  warned.add(tag);
  console.warn(`[i18n] clé manquante « ${key} » (${lang})`);
}

// Interpolation `{name}` ; une variable absente laisse le marqueur visible.
function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

function pluralRule(lang, count) {
  try {
    return new Intl.PluralRules(localeFor(lang)).select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
}

// Résolution d'une clé dans une langue : `clé.<règle>` puis `clé.other` si
// `vars.count` est un nombre (pluriels via Intl.PluralRules — en français
// 0 et 1 sont « one », en anglais seul 1), sinon la clé telle quelle.
function lookup(dict, key, vars, lang) {
  if (!dict) return undefined;
  if (vars && typeof vars.count === "number") {
    const plural = dict[`${key}.${pluralRule(lang, vars.count)}`] ?? dict[`${key}.other`];
    if (plural !== undefined) return plural;
  }
  return dict[key];
}

// Fabrique la fonction de traduction sur un jeu de dictionnaires (les tests
// injectent le leur). Ordre : langue demandée → français → la clé elle-même.
export function makeT(dicts) {
  return function t(key, vars, lang = DEFAULT_LANG) {
    const code = normalizeLang(lang);
    let text = lookup(dicts[code], key, vars, code);
    if (text === undefined && code !== DEFAULT_LANG) {
      warnMissing(key, code);
      text = lookup(dicts[DEFAULT_LANG], key, vars, DEFAULT_LANG);
    }
    if (text === undefined) {
      warnMissing(key, DEFAULT_LANG);
      return key;
    }
    return interpolate(text, vars);
  };
}

// t(clé, variables?, langue?) — la langue est obligatoire hors composant
// (sinon le texte sort en français quel que soit l'utilisateur).
export const t = makeT(DICTIONARIES);
