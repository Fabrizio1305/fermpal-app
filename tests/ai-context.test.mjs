// Contexte local de la génération IA (app Android) : ce qui entre dans le
// prompt est borné et assaini, quoi que le client envoie.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CONTEXT_STOCK, normalizeLocalContext } from "../lib/aiContext.js";

test("absent ou mal formé → null (le serveur lit alors la base)", () => {
  for (const raw of [undefined, null, "x", 12, [], [{ name: "Sucre" }]]) assert.equal(normalizeLocalContext(raw), null);
});

test("objet sans listes → contexte vide mais présent (la base n'est PAS lue)", () => {
  assert.deepEqual(normalizeLocalContext({}), { stock: [], knownTypes: [] });
  assert.deepEqual(normalizeLocalContext({ stock: "non", knownTypes: 3 }), { stock: [], knownTypes: [] });
});

test("lignes de stock : champs assainis, valeurs par défaut, lignes invalides écartées", () => {
  const { stock } = normalizeLocalContext({
    stock: [
      { name: "  Sucre   blanc ", quantity: "500", unit: "g", category: "sucre", expiry_date: "2026-12-31" },
      { name: "Citron", quantity: 3, unit: "pcs", category: "inconnue", expiry_date: "hier" },
      { name: "Gingembre", quantity: 0.25, unit: null },
      { name: "", quantity: 1 },
      { name: "Sans quantité" },
      { name: "Négatif", quantity: -1 },
      { name: "NaN", quantity: "abc" },
      null,
      "texte",
      { name: "x".repeat(200), quantity: 1, unit: "y".repeat(40) },
    ],
  });
  assert.deepEqual(stock[0], { name: "Sucre blanc", quantity: 500, unit: "g", category: "sucre", expiry_date: "2026-12-31" });
  assert.deepEqual(stock[1], { name: "Citron", quantity: 3, unit: "pcs", category: "autre", expiry_date: null });
  assert.deepEqual(stock[2], { name: "Gingembre", quantity: 0.25, unit: "g", category: "autre", expiry_date: null });
  assert.equal(stock.length, 4);
  assert.equal(stock[3].name.length, 80);
  assert.equal(stock[3].unit.length, 12);
});

test("stock borné à MAX_CONTEXT_STOCK lignes", () => {
  const rows = Array.from({ length: MAX_CONTEXT_STOCK + 50 }, (_, i) => ({ name: `Ingrédient ${i}`, quantity: 1 }));
  assert.equal(normalizeLocalContext({ stock: rows }).stock.length, MAX_CONTEXT_STOCK);
});

test("knownTypes : uniquement des types connus, dédoublonnés (pas de « constructor »)", () => {
  const { knownTypes } = normalizeLocalContext({ knownTypes: ["kefir_eau", "kombucha", "kefir_eau", "constructor", "__proto__", 42, "inconnu"] });
  assert.deepEqual(knownTypes, ["kefir_eau", "kombucha"]);
});
