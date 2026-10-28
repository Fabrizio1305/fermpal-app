// Import d'un export Brewfather (web : Paramètres → Données → Exporter les
// données en JSON). Pur : reçoit l'objet JSON et rend un PLAN d'import au
// format du carnet (recettes, phases, lignes, brassins, journal) ; l'écriture
// est dans mobile/src/data/brewfatherImport.js.
//
// Ce qui est repris : les recettes, et les brassins passés avec la recette
// telle que brassée. Un brassin Brewfather embarque sa propre copie de la
// recette ; quand elle diffère de la recette actuelle, elle devient une
// « recette d'archive » (masquée de la liste, rattachée à la recette actuelle)
// pour que chaque brassin reste rebrassable à l'identique. Le stock, les
// profils d'équipement et les brassins en préparation ne sont pas repris.
//
// Unités Brewfather : fermentescibles en kg, houblons en g, températures en °C,
// volumes en L, couleur en SRM (convertie en EBC), dates en millisecondes.

import { t } from "./i18n/index.js";

const SRM_TO_EBC = 1.97;
const BREWING_FERMENTABLES = ["Grain", "Liquid Extract", "Dry Extract"];

export class BrewfatherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrewfatherError";
    this.code = code;
  }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, digits) => (num(v) == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const sg = (v) => (num(v) == null ? null : v.toFixed(3));
const clean = (s) => (typeof s === "string" ? s.trim() : "");

// Date Brewfather (millisecondes, ou { seconds } pour `_created`) → ISO.
function iso(v) {
  const ms = num(v) ?? (num(v?.seconds) != null ? v.seconds * 1000 : null);
  return ms == null ? null : new Date(ms).toISOString();
}

export function readBrewfatherExport(json) {
  const data = json?.data;
  if (!data || !Array.isArray(data.recipes)) throw new BrewfatherError("not_brewfather", "Ce fichier n'est pas un export Brewfather.");
  return {
    userName: clean(json.user?.name),
    recipes: data.recipes.filter((r) => r && r._id),
    batches: Array.isArray(data.batches) ? data.batches.filter((b) => b && b._id) : [],
  };
}

// ---------------------------------------------------------------------------
// Type de boisson
// ---------------------------------------------------------------------------

function isBrewing(r) {
  return (r.fermentables || []).some((f) => BREWING_FERMENTABLES.includes(f.type));
}

function drinkType(r) {
  const style = typeof r.style === "object" && r.style ? r.style : {};
  const hay = [r.name, typeof r.style === "string" ? r.style : style.name, style.category, style.type].map(clean).join(" ").toLowerCase();
  const brewing = isBrewing(r);
  if (/k[ée]fir/.test(hay)) {
    if (/kefir de lait|k[ée]fir de lait|milk kefir|dairy kefir/.test(hay)) return brewing ? "hybride" : "kefir_lait";
    return brewing ? "hybride" : "kefir_eau";
  }
  if (/\bbraggot\b/.test(hay)) return "braggot";
  if (brewing) return "biere";
  if (/\b(mead|hydromel|melomel|metheglin)\b/.test(hay)) return "hydromel";
  if (/\b(cider|cidre)\b/.test(hay)) return "cidre";
  if (/\bkvas/.test(hay)) return "kvas";
  if (/\bjun\b/.test(hay)) return "jun";
  if (/\bkombucha\b/.test(hay)) return "kombucha";
  if (/ginger beer/.test(hay)) return "ginger_beer";
  return "biere";
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const FERMENTATION_STEP_NAMES = {
  Primary: "phases.primaryFermentation",
  Secondary: "phases.secondaryFermentation",
  Tertiary: "phases.tertiaryFermentation",
  "Cold Crash": "phases.coldCrash",
  Conditioning: "phases.conditioning",
};

function phaseLabel(key, lang) {
  switch (key) {
    case "phases.primaryFermentation": return t("phases.primaryFermentation", null, lang);
    case "phases.secondaryFermentation": return t("phases.secondaryFermentation", null, lang);
    case "phases.tertiaryFermentation": return t("phases.tertiaryFermentation", null, lang);
    case "phases.coldCrash": return t("phases.coldCrash", null, lang);
    case "phases.conditioning": return t("phases.conditioning", null, lang);
    default: return t("phases.fermentation", null, lang);
  }
}

function buildPhases(r, lang) {
  const phases = [];
  const steps = (r.mash?.steps || []).filter((s) => num(s.stepTime) > 0);
  if (isBrewing(r) && steps.length > 0) {
    const main = steps.reduce((a, b) => (b.stepTime > a.stepTime ? b : a));
    const water = r.water || {};
    const notes = [
      ...steps.map((s) => `${clean(s.name) || t("brewfather.step", null, lang)} : ${num(s.stepTemp) ?? "?"} °C · ${s.stepTime} min`),
      num(water.mashWaterAmount) ? t("brewfather.mashWater", { value: round(water.mashWaterAmount, 1) }, lang) : null,
      num(water.spargeWaterAmount) ? t("brewfather.spargeWater", { value: round(water.spargeWaterAmount, 1) }, lang) : null,
      num(water.mashPh) ? t("brewfather.mashPh", { value: round(water.mashPh, 2) }, lang) : null,
    ].filter(Boolean);
    phases.push({
      key: "mash",
      name: t("phases.mash", null, lang),
      duration_value: steps.reduce((sum, s) => sum + s.stepTime, 0),
      duration_unit: "minutes",
      temperature_target: num(main.stepTemp),
      notes: notes.join("\n"),
    });
  }
  if (num(r.boilTime) > 0) {
    const notes = [
      num(r.boilSize) ? t("brewfather.boilVolume", { value: round(r.boilSize, 1) }, lang) : null,
      num(r.preBoilGravity) ? t("brewfather.preBoilGravity", { value: sg(r.preBoilGravity) }, lang) : null,
    ].filter(Boolean);
    phases.push({ key: "boil", name: t("phases.boil", null, lang), duration_value: r.boilTime, duration_unit: "minutes", temperature_target: 100, notes: notes.join("\n") });
  }
  const fermSteps = (r.fermentation?.steps || []).filter((s) => s && (num(s.stepTime) != null || num(s.stepTemp) != null));
  if (fermSteps.length === 0) {
    phases.push({ key: "ferm0", name: phaseLabel("phases.fermentation", lang), duration_value: null, duration_unit: "jours", temperature_target: num(r.primaryTemp), notes: "", stepType: "Primary" });
  } else {
    // Deux étapes du même type (palier de température) : « Fermentation primaire 2 ».
    const seen = {};
    fermSteps.forEach((s, i) => {
      const label = phaseLabel(FERMENTATION_STEP_NAMES[s.type], lang);
      seen[label] = (seen[label] || 0) + 1;
      phases.push({
        key: `ferm${i}`,
        name: seen[label] > 1 ? `${label} ${seen[label]}` : label,
        duration_value: num(s.stepTime),
        duration_unit: "jours",
        temperature_target: num(s.stepTemp),
        notes: "",
        stepType: s.type,
      });
    });
  }
  const last = phases.at(-1);
  if (num(r.carbonation) > 0) last.notes = [last.notes, t("brewfather.carbonation", { value: round(r.carbonation, 1) }, lang)].filter(Boolean).join("\n");
  return phases;
}

// Phase d'un ingrédient selon son usage Brewfather (repli sur la plus proche).
function phaseFinder(phases) {
  const has = (key) => phases.some((p) => p.key === key);
  const ferm = phases.filter((p) => p.key.startsWith("ferm"));
  const first = (...keys) => keys.find(has) ?? phases[0].key;
  return (use) => {
    switch (use) {
      case "Mash": case "Sparge": case "Steep": case "Mash Water Addition": case "Sparge Water Addition":
        return first("mash", "boil", "ferm0");
      case "Boil": case "First Wort": case "Aroma": case "Whirlpool": case "Flameout":
        return first("boil", "mash", "ferm0");
      case "Secondary":
        return (ferm.find((p) => p.stepType === "Secondary") ?? ferm[1] ?? ferm[0]).key;
      case "Bottle": case "Bottling":
        return phases.at(-1).key;
      default:
        return ferm[0].key;
    }
  };
}

// ---------------------------------------------------------------------------
// Ingrédients
// ---------------------------------------------------------------------------

function timingFor(use, { time, temp } = {}, lang) {
  const min = num(time);
  switch (use) {
    case "Boil": return min != null ? t("brewfather.timing.boil", { min }, lang) : t("brewfather.timing.boilNoTime", null, lang);
    case "First Wort": return t("brewfather.timing.firstWort", null, lang);
    case "Aroma": case "Whirlpool": {
      const base = min != null ? t("brewfather.timing.whirlpool", { min }, lang) : t("brewfather.timing.whirlpoolNoTime", null, lang);
      return num(temp) ? `${base} · ${temp} °C` : base;
    }
    case "Flameout": return t("brewfather.timing.flameout", null, lang);
    case "Mash": return t("brewfather.timing.mash", null, lang);
    case "Sparge": return t("brewfather.timing.sparge", null, lang);
    case "Steep": return t("brewfather.timing.steep", null, lang);
    case "Mash Water Addition": return t("brewfather.timing.mashWater", null, lang);
    case "Sparge Water Addition": return t("brewfather.timing.spargeWater", null, lang);
    case "Primary": return t("brewfather.timing.primary", null, lang);
    case "Secondary": return t("brewfather.timing.secondary", null, lang);
    case "Bottle": case "Bottling": return t("brewfather.timing.bottling", null, lang);
    default: return null;
  }
}

// Unités Brewfather des « divers » → unités du carnet (impériales converties).
const MISC_UNITS = {
  g: [1, "g"], kg: [1, "kg"], mg: [1, "mg"], ml: [1, "ml"], l: [1, "L"],
  items: [1, "pièce"], each: [1, "pièce"], pkg: [1, "sachet"], tsp: [1, "càc"], tbsp: [1, "càs"],
  oz: [28.35, "g"], lb: [453.59, "g"], cup: [240, "ml"],
};

function weight(kg) {
  if (num(kg) == null) return { amount: 0, unit: "g" };
  return kg >= 1 ? { amount: round(kg, 3), unit: "kg" } : { amount: round(kg * 1000, 1), unit: "g" };
}

const joinNotes = (...parts) => parts.map((p) => (typeof p === "string" ? p.trim() : p)).filter(Boolean).join(" · ") || null;

// Notes d'un ingrédient : seulement celles de l'utilisateur (`userNotes`) ;
// `notes` porte la description du catalogue Brewfather, qu'on ne recopie pas.
function buildIngredients(r, phases, lang) {
  const phaseOf = phaseFinder(phases);
  const lines = [];
  for (const f of r.fermentables || []) {
    const use = clean(f.use) || "Mash";
    const category = f.type === "Sugar" ? "sucre" : BREWING_FERMENTABLES.includes(f.type) || f.type === "Adjunct" ? "grain" : "autre";
    lines.push({
      phaseKey: phaseOf(use),
      category,
      name: clean(f.name),
      ...weight(f.amount),
      timing: use === "Mash" ? null : timingFor(use, f, lang),
      notes: joinNotes(category === "grain" && num(f.color) > 0 ? `${round(f.color * SRM_TO_EBC, 1)} EBC` : null, clean(f.supplier) || clean(f.origin), f.userNotes),
    });
  }
  for (const h of r.hops || []) {
    const use = clean(h.use) || "Boil";
    const timing = use === "Dry Hop"
      ? (num(h.time) != null ? t("brewfather.timing.dryHop", { days: h.time }, lang) : t("brewfather.timing.dryHopNoTime", null, lang))
      : timingFor(use, h, lang);
    lines.push({
      phaseKey: use === "Dry Hop" ? phaseOf("Primary") : phaseOf(use),
      category: "houblon",
      name: clean(h.name),
      amount: round(num(h.amount) ?? 0, 1),
      unit: "g",
      alpha_acid_pct: round(h.alpha, 1),
      timing,
      notes: joinNotes(clean(h.type), num(h.ibu) ? `${round(h.ibu, 1)} IBU` : null, h.userNotes),
    });
  }
  for (const m of r.miscs || []) {
    const use = clean(m.use);
    const [factor, unit] = MISC_UNITS[clean(m.unit).toLowerCase()] || [1, clean(m.unit) || "g"];
    lines.push({
      phaseKey: phaseOf(use),
      category: ["Spice", "Herb"].includes(m.type) ? "plante" : "autre",
      name: clean(m.name),
      amount: round((num(m.amount) ?? 0) * factor, 2),
      unit,
      timing: timingFor(use, use === "Boil" ? m : {}, lang),
      notes: joinNotes(m.userNotes),
    });
  }
  for (const y of r.yeasts || []) {
    const unit = clean(y.unit);
    lines.push({
      phaseKey: phaseOf("Primary"),
      category: "levure",
      name: clean(y.name),
      amount: round(num(y.amount) ?? 0, 2),
      unit: unit === "pkg" ? "sachet" : unit || "sachet",
      sub_type: [clean(y.laboratory), clean(y.productId)].filter(Boolean).join(" ") || null,
      notes: joinNotes(clean(y.form), num(y.attenuation) ? `${round(y.attenuation, 0)} %` : null, y.userNotes),
    });
  }
  return lines.filter((l) => l.name);
}

// ---------------------------------------------------------------------------
// Recette
// ---------------------------------------------------------------------------

export function mapRecipe(r, { userName = "", lang = "fr" } = {}) {
  const phases = buildPhases(r, lang);
  const author = clean(r.author);
  const own = !author || (userName && author.toLowerCase().startsWith(userName.toLowerCase().split(" ")[0]));
  const instructions = [
    own ? null : t("brewfather.author", { name: author }, lang),
    num(r.efficiency) ? t("brewfather.efficiency", { value: round(r.efficiency, 0) }, lang) : null,
    clean(r.notes) || null,
  ].filter(Boolean).join("\n\n");
  return {
    recipe: {
      title: clean(r.name) || t("brewfather.untitled", null, lang),
      type: drinkType(r),
      source_type: "brewfather",
      style: clean(typeof r.style === "string" ? r.style : r.style?.name) || null,
      batch_size_ref: round(r.batchSize, 2),
      boil_time: num(r.boilTime),
      expected_og: round(r.og, 3),
      expected_fg: round(r.fg, 3),
      expected_abv: round(r.abv, 1),
      expected_ibu: round(r.ibu, 0),
      expected_ebc: num(r.color) != null ? round(r.color * SRM_TO_EBC, 0) : null,
      instructions: instructions || null,
      tags: ["brewfather"],
      created_at: iso(r._created) ?? iso(r._timestamp_ms),
    },
    phases: phases.map(({ stepType, ...p }) => p),
    ingredients: buildIngredients(r, phases, lang),
  };
}

// Empreinte du contenu brassable : deux recettes de même empreinte se brassent
// à l'identique (le titre, les notes et les valeurs calculées n'y entrent pas).
function contentKey(m) {
  const { recipe } = m;
  return JSON.stringify([recipe.type, recipe.style, recipe.batch_size_ref, recipe.boil_time, m.phases, m.ingredients]);
}

// ---------------------------------------------------------------------------
// Brassin
// ---------------------------------------------------------------------------

function measuresText(b, snap, lang) {
  const items = [
    num(b.measuredOg) ? t("brewfather.m.og", { value: sg(b.measuredOg) }, lang) + (num(snap?.og) ? t("brewfather.m.target", { value: sg(snap.og) }, lang) : "") : null,
    num(b.measuredFg) ? t("brewfather.m.fg", { value: sg(b.measuredFg) }, lang) + (num(snap?.fg) ? t("brewfather.m.target", { value: sg(snap.fg) }, lang) : "") : null,
    num(b.measuredAbv) && num(b.measuredOg) && num(b.measuredFg) ? t("brewfather.m.abv", { value: round(b.measuredAbv, 1) }, lang) : null,
    num(b.measuredAttenuation) && num(b.measuredFg) ? t("brewfather.m.attenuation", { value: round(b.measuredAttenuation, 0) }, lang) : null,
    num(b.measuredEfficiency) && num(b.measuredOg) ? t("brewfather.m.efficiency", { value: round(b.measuredEfficiency, 0) }, lang) : null,
    num(b.measuredMashPh) ? t("brewfather.m.mashPh", { value: round(b.measuredMashPh, 2) }, lang) : null,
    num(b.measuredPreBoilGravity) ? t("brewfather.m.preBoil", { value: sg(b.measuredPreBoilGravity) }, lang) : null,
    num(b.measuredBoilSize) ? t("brewfather.m.boilVolume", { value: round(b.measuredBoilSize, 1) }, lang) : null,
    num(b.measuredBatchSize) ? t("brewfather.m.volume", { value: round(b.measuredBatchSize, 1) }, lang) : null,
    num(b.measuredBottlingSize) ? t("brewfather.m.bottlingVolume", { value: round(b.measuredBottlingSize, 1) }, lang) : null,
  ].filter(Boolean);
  return items.length ? `${t("brewfather.m.title", null, lang)}\n${items.join("\n")}` : null;
}

// Dates d'entrée dans chaque phase : brassage le jour J, puis les étapes de
// fermentation à la suite, jamais après la mise en bouteille.
function phaseDates(phases, b) {
  const brew = num(b.brewDate);
  const end = Math.max(num(b.bottlingDate) ?? brew, brew);
  let cursor = Math.max(num(b.fermentationStartDate) ?? brew, brew);
  return phases.map((p) => {
    if (!p.key.startsWith("ferm")) return iso(brew);
    const at = Math.min(cursor, end);
    if (num(p.duration_value) != null) cursor += p.duration_value * 86400000;
    return iso(at);
  });
}

function mapBatch(b, recipeExternalId, mapped, { snap, stub, lang }) {
  const brew = num(b.brewDate);
  const done = Math.max(num(b.bottlingDate) ?? brew, brew);
  const journal = [];
  const measures = measuresText(b, snap, lang);
  if (measures) journal.push({ timestamp: iso(brew), content: measures });
  if (stub) journal.push({ timestamp: iso(brew), content: t("brewfather.stubRecipe", null, lang) });
  if (clean(b.batchNotes)) journal.push({ timestamp: iso(brew), content: clean(b.batchNotes) });
  for (const n of b.notes || []) {
    if (clean(n?.note)) journal.push({ timestamp: iso(n.timestamp) ?? iso(brew), content: clean(n.note) });
  }
  const dates = phaseDates(mapped.phases, b);
  const rating = num(b.tasteRating);
  return {
    external_id: `brewfather:batch:${b._id}`,
    recipe_external_id: recipeExternalId,
    title: `${clean(snap?.name) || mapped.recipe.title} #${b.batchNo ?? "?"}`,
    volume: round(num(b.measuredBatchSize) ?? snap?.batchSize ?? mapped.recipe.batch_size_ref, 2),
    created_at: iso(brew),
    completed_at: iso(done),
    rating: rating > 0 ? Math.min(5, Math.max(1, Math.round(rating / 20))) : null,
    notes: clean(b.tasteNotes) || null,
    log: [
      { stage: "planifie", phaseKey: null, entered_at: iso(brew) },
      ...mapped.phases.map((p, i) => ({ stage: "en_cours", phaseKey: p.key, entered_at: dates[i] })),
      { stage: "degustation", phaseKey: null, entered_at: iso(done) },
      { stage: "archive", phaseKey: null, entered_at: iso(done) },
    ],
    journal,
    lines: mapped.ingredients.map((l) => ({ phaseKey: l.phaseKey, category: l.category, name: l.name, amount: l.amount, unit: l.unit })),
  };
}

// ---------------------------------------------------------------------------
// Plan d'import
// ---------------------------------------------------------------------------

// Rend { recipes, batches, skipped } : les recettes actuelles d'abord, puis
// les recettes d'archive (qui pointent vers leur recette actuelle), puis les
// brassins (qui pointent vers une recette du plan par son external_id).
export function planBrewfatherImport(json, { lang = "fr" } = {}) {
  const { userName, recipes, batches } = readBrewfatherExport(json);
  const ctx = { userName, lang };
  const current = new Map();
  for (const r of recipes) {
    const mapped = mapRecipe(r, ctx);
    current.set(r._id, { ...mapped, external_id: `brewfather:recipe:${r._id}`, archived: false, archive_of_external_id: null, key: contentKey(mapped) });
  }
  const archives = new Map();
  const planned = [];
  const skipped = { planning: 0, noRecipe: 0 };
  const sorted = [...batches].sort((a, b) => (num(a.brewDate) ?? 0) - (num(b.brewDate) ?? 0));
  for (const b of sorted) {
    if (b.status === "Planning") {
      skipped.planning++;
      continue;
    }
    const snap = b.recipe && clean(b.recipe.name) ? b.recipe : null;
    const base = current.get(b.recipe?._id) ?? null;
    let target = null;
    if (!snap) {
      target = base;
    } else {
      const mapped = mapRecipe(snap, ctx);
      const key = contentKey(mapped);
      if (base && base.key === key) target = base;
      else if (archives.has(key)) target = archives.get(key);
      else {
        target = {
          ...mapped,
          recipe: { ...mapped.recipe, title: `${mapped.recipe.title} (#${b.batchNo ?? "?"})`, created_at: iso(b.brewDate) ?? mapped.recipe.created_at },
          external_id: `brewfather:recipe:${snap._id}:batch:${b._id}`,
          archived: true,
          archive_of_external_id: base?.external_id ?? null,
          key,
        };
        archives.set(key, target);
      }
    }
    if (!target) {
      skipped.noRecipe++;
      continue;
    }
    planned.push(mapBatch(b, target.external_id, target, { snap: snap ?? (base ? recipes.find((r) => r._id === b.recipe?._id) : null), stub: !snap, lang }));
  }
  const strip = ({ key, ...r }) => r;
  return {
    userName,
    recipes: [...current.values(), ...archives.values()].map(strip),
    batches: planned,
    skipped,
  };
}
