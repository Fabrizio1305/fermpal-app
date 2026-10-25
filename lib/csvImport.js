// Import CSV minimal pour le stock d'ingrédients : en-tête flexible
// (FR ou EN), gère les champs entre guillemets (virgule ou "" échappé
// dedans) — suffisant pour un export/tableur simple (Excel FR inclus).

// Sépare une ligne CSV en colonnes en respectant les guillemets RFC4180.
function parseCSVLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cols.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  cols.push(cur.trim());
  return cols;
}

// Accepte "1.5" et "1,5" (virgule décimale FR/Excel).
function parseQuantity(v) {
  if (!v) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function parseIngredientsCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (...names) => names.map((n) => headers.indexOf(n)).find((i) => i !== -1) ?? -1;

  const iName = idx("name", "nom");
  const iQty = idx("quantity", "quantite", "quantité");
  const iUnit = idx("unit", "unite", "unité");
  const iCategory = idx("category", "categorie", "catégorie");
  const iExpiry = idx("expiry_date", "expiration", "peremption", "péremption");
  const iSupplier = idx("supplier", "fournisseur");

  return lines
    .slice(1)
    .map((line) => {
      const cols = parseCSVLine(line);
      return {
        name: iName !== -1 ? cols[iName] : "",
        quantity: iQty !== -1 ? parseQuantity(cols[iQty]) : 0,
        unit: iUnit !== -1 ? cols[iUnit] || "g" : "g",
        category: iCategory !== -1 ? cols[iCategory] || "autre" : "autre",
        expiry_date: iExpiry !== -1 && cols[iExpiry] ? cols[iExpiry] : null,
        supplier: iSupplier !== -1 && cols[iSupplier] ? cols[iSupplier] : null,
      };
    })
    .filter((r) => r.name);
}
