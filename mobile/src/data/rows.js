// Lecture/écriture des lignes SQLite du carnet : booléens 0/1 → true/false,
// JSON texte → objets. Une seule définition, utilisée par toutes les couches.

export function newId() {
  return globalThis.crypto.randomUUID();
}

export function nowIso(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function rowToRecipe(r) {
  if (!r) return null;
  return { ...r, tags: Array.isArray(parseJson(r.tags, [])) ? parseJson(r.tags, []) : [], is_ai_generated: !!r.is_ai_generated, archived: !!r.archived };
}

export function rowToRecipeIngredient(r) {
  return r ? { ...r, is_starter: !!r.is_starter } : null;
}

export function rowToBatch(b) {
  return b ? { ...b, has_been_split: !!b.has_been_split } : null;
}

export function rowToLine(l) {
  return l ? { ...l, deducted: !!l.deducted, is_starter: !!l.is_starter } : null;
}

export function rowToShopping(s) {
  return s ? { ...s, checked: !!s.checked } : null;
}

export function rowToMovement(m) {
  return m ? { ...m, line_snapshot: m.line_snapshot ? parseJson(m.line_snapshot, null) : null } : null;
}

export function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
