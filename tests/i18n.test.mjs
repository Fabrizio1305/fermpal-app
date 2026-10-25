// Socle multilangue (lib/i18n) : parité des dictionnaires, repli sur le
// français, interpolation, pluriels, détection de langue.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_LANG,
  DICTIONARIES,
  SUPPORTED_LANGS,
  localeFor,
  makeT,
  normalizeLang,
  t,
} from "../lib/i18n/index.js";

// Langues dont le dictionnaire doit être COMPLET (mêmes clés que fr.json) :
// toutes. Une nouvelle langue peut démarrer en sous-ensemble (t() replie sur
// le français) en la laissant hors de cette liste le temps de la traduction.
const COMPLETE_LANGS = ["fr", "en", "it"];

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("dictionnaires : JSON plat, clés triées, valeurs non vides", () => {
  for (const lang of SUPPORTED_LANGS) {
    const raw = readFileSync(new URL(`../lib/i18n/${lang}.json`, import.meta.url), "utf8");
    const dict = JSON.parse(raw);
    const keys = Object.keys(dict);
    assert.deepEqual(keys, [...keys].sort(), `${lang}.json : clés à trier (diffs stables)`);
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, "string", `${lang}.json › ${key} : une chaîne, pas un objet (pluriels = clé.one / clé.other)`);
      assert.ok(value.trim().length > 0, `${lang}.json › ${key} : valeur vide`);
      assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9][a-zA-Z0-9_]*)+$/, `${lang}.json › ${key} : clé « espace.element » attendue`);
    }
  }
});

test("dictionnaires : parité des clés et des interpolations avec fr.json", () => {
  const fr = DICTIONARIES[DEFAULT_LANG];
  const frKeys = new Set(Object.keys(fr));
  for (const lang of SUPPORTED_LANGS) {
    if (lang === DEFAULT_LANG) continue;
    const dict = DICTIONARIES[lang];
    const orphans = Object.keys(dict).filter((k) => !frKeys.has(k));
    assert.deepEqual(orphans, [], `${lang}.json : clés absentes de fr.json`);
    if (COMPLETE_LANGS.includes(lang)) {
      const missing = [...frKeys].filter((k) => !(k in dict));
      assert.deepEqual(missing, [], `${lang}.json : clés manquantes`);
    }
    for (const key of Object.keys(dict)) {
      assert.equal(placeholders(dict[key]), placeholders(fr[key]), `${lang}.json › ${key} : mêmes variables {x} qu'en français`);
    }
  }
});

test("t() : langue demandée, repli français, clé inconnue", () => {
  const tt = makeT({
    fr: { "common.cancel": "Annuler", "common.hello": "Bonjour {name}" },
    en: { "common.cancel": "Cancel" },
    it: {},
  });
  assert.equal(tt("common.cancel", null, "fr"), "Annuler");
  assert.equal(tt("common.cancel", null, "en"), "Cancel");
  assert.equal(tt("common.cancel", null, "it"), "Annuler", "italien absent → français");
  assert.equal(tt("common.hello", { name: "Fab" }, "en"), "Bonjour Fab", "clé absente en anglais → texte français interpolé");
  assert.equal(tt("common.hello", {}, "fr"), "Bonjour {name}", "variable absente : marqueur laissé visible");
  assert.equal(tt("nope.missing", null, "en"), "nope.missing", "clé inconnue partout → la clé");
  assert.equal(tt("common.cancel"), "Annuler", "sans langue : français");
  assert.equal(tt("common.cancel", null, "en-US"), "Cancel", "code régional normalisé");
});

test("t() : pluriels par Intl.PluralRules (fr : 0 et 1 au singulier ; en : seul 1)", () => {
  const tt = makeT({
    fr: { "batch.days.one": "{count} jour", "batch.days.other": "{count} jours", "batch.only": "seul" },
    en: { "batch.days.one": "{count} day", "batch.days.other": "{count} days", "batch.only": "only" },
    it: {},
  });
  assert.equal(tt("batch.days", { count: 0 }, "fr"), "0 jour");
  assert.equal(tt("batch.days", { count: 1 }, "fr"), "1 jour");
  assert.equal(tt("batch.days", { count: 3 }, "fr"), "3 jours");
  assert.equal(tt("batch.days", { count: 0 }, "en"), "0 days");
  assert.equal(tt("batch.days", { count: 1 }, "en"), "1 day");
  assert.equal(tt("batch.days", { count: 2 }, "it"), "2 jours", "repli français avec la règle française");
  assert.equal(tt("batch.only", { count: 2 }, "en"), "only", "count sans variantes : la clé simple");
});

test("normalizeLang / localeFor", () => {
  assert.equal(normalizeLang("en-US"), "en");
  assert.equal(normalizeLang("IT"), "it");
  assert.equal(normalizeLang("de-CH"), "fr", "langue non gérée → défaut");
  assert.equal(normalizeLang("de-CH", "en"), "en");
  assert.equal(normalizeLang(null), "fr");
  assert.equal(normalizeLang(42), "fr");
  assert.equal(localeFor("fr"), "fr-CH");
  assert.equal(localeFor("en"), "en-GB");
  assert.equal(localeFor("it"), "it-CH");
  assert.equal(localeFor("zz"), "fr-CH");
  assert.equal(new Date("2026-09-21T10:00:00Z").toLocaleDateString(localeFor("it"), { day: "2-digit", month: "2-digit", year: "numeric" }), "21.09.2026", "it-CH : points, comme fr-CH");
  assert.equal(typeof t, "function");
});
