/**
 * Ingredient matching: exact → alias → fuzzy
 *
 * normalize() strips accents, stopwords and punctuation so that
 * "Sucre de Canne" and "sucre-de-canne" both become "sucre canne".
 * Fuzzy matching is token-based (common-word overlap ratio) rather than
 * edit distance, which handles multi-word reorderings better.
 */

const STOPWORDS = new Set([
  "de", "du", "des", "d", "l", "la", "le", "les",
  "of", "the", "a", "an",
  "et", "and",
]);

export function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/[''`]/g, "")             // curly/straight apostrophes
    .replace(/[-_/]/g, " ")            // separators → space
    .replace(/[^a-z0-9 ]/g, "")        // remove remaining punctuation
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .join(" ")
    .trim();
}

/**
 * Returns a similarity score [0, 1] based on shared tokens.
 * Score = 2 * |intersection| / (|A| + |B|)  (Sørensen–Dice)
 */
export function fuzzyScore(a, b) {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach((t) => { if (tb.has(t)) shared++; });
  return (2 * shared) / (ta.size + tb.size);
}

/**
 * Find a stock item for a given ingredient name.
 * Priority: 1. exact (case-insensitive) → 2. alias → 3. fuzzy ≥ threshold
 *
 * @param {string} name
 * @param {Array}  stock        — array of { name, ... }
 * @param {Array}  aliases      — array of { alias, stock_name }
 * @param {number} threshold    — fuzzy score threshold (default 0.75)
 * @returns {{ item: object|null, via: 'exact'|'alias'|'fuzzy'|null }}
 */
export function findStockItem(name, stock, aliases = [], threshold = 0.75) {
  const lower = name.toLowerCase().trim();

  // 1. Exact match
  const exact = stock.find((s) => s.name.toLowerCase().trim() === lower);
  if (exact) return { item: exact, via: "exact" };

  // 2. Alias match
  const alias = aliases.find((a) => a.alias.toLowerCase().trim() === lower);
  if (alias) {
    const item = stock.find((s) => s.name.toLowerCase().trim() === alias.stock_name.toLowerCase().trim());
    if (item) return { item, via: "alias" };
  }

  // 3. Fuzzy match
  let best = null;
  let bestScore = 0;
  for (const s of stock) {
    const score = fuzzyScore(name, s.name);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (bestScore >= threshold) return { item: best, via: "fuzzy" };

  return { item: null, via: null };
}
