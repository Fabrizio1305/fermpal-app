// Import BeerXML minimal : extrait le nom, le volume, les phases et les
// ingrédients, et les mappe vers le schéma FermPal (recipes/recipe_phases/
// recipe_ingredients). Pas de calcul OG/FG/IBU, pas de sous-paliers structurés
// (température/temps par étape de macération) — volontairement laissé en
// texte libre dans les notes de phase pour ne pas recréer un logiciel de
// brassage complet. Rien n'est perdu, juste pas finement structuré.

function textOf(tag, root) {
  if (!root) return "";
  return root.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? "";
}

function numOf(tag, root) {
  const v = textOf(tag, root);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function phaseKeyForUse(use, phases) {
  const u = (use || "").toLowerCase();
  const has = (key) => phases.some((p) => p.key === key);
  if (u.includes("mash") || u.includes("sparge")) {
    return has("mash") ? "mash" : has("boil") ? "boil" : has("primary") ? "primary" : phases[0]?.key ?? null;
  }
  if (u.includes("boil") || u.includes("wort")) {
    return has("boil") ? "boil" : has("mash") ? "mash" : has("primary") ? "primary" : phases[0]?.key ?? null;
  }
  if (u.includes("second") || u.includes("bottl") || u.includes("keg")) {
    return has("secondary") ? "secondary" : has("primary") ? "primary" : phases[0]?.key ?? null;
  }
  return has("primary") ? "primary" : phases[0]?.key ?? null;
}

export function parseBeerXML(rawXmlText) {
  // Strip BOM and leading whitespace that some tools (BeerSmith…) prepend
  const xmlText = rawXmlText.replace(/^\uFEFF/, "").trimStart();
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) {
    const msg = doc.querySelector("parsererror")?.textContent?.split("\n")[0] || "";
    throw new Error(`Fichier XML invalide.${msg ? " " + msg : ""}`);
  }
  const recipeEl = doc.querySelector("RECIPE");
  if (!recipeEl) throw new Error("Balise RECIPE introuvable — ce n'est pas un fichier BeerXML valide.");

  const name = textOf("NAME", recipeEl) || "Recette importée";
  const batchSizeRef = numOf("BATCH_SIZE", recipeEl);
  const boilTime = numOf("BOIL_TIME", recipeEl);
  const notes = textOf("NOTES", recipeEl);
  const primaryAge = numOf("PRIMARY_AGE", recipeEl);
  const primaryTemp = numOf("PRIMARY_TEMP", recipeEl);
  const secondaryAge = numOf("SECONDARY_AGE", recipeEl);
  const secondaryTemp = numOf("SECONDARY_TEMP", recipeEl);
  const styleEl = recipeEl.querySelector(":scope > STYLE");
  const styleName = textOf("NAME", styleEl);
  const styleCategory = textOf("CATEGORY", styleEl);
  const mashEl = recipeEl.querySelector(":scope > MASH");
  const mashName = textOf("NAME", mashEl);
  const mashSteps = Array.from(recipeEl.querySelectorAll(":scope > MASH > MASH_STEPS > MASH_STEP")).map((s) => ({
    name: textOf("NAME", s),
    tempC: numOf("STEP_TEMP", s),
    timeMin: numOf("STEP_TIME", s),
  }));

  const hay = `${styleName} ${styleCategory} ${mashName} ${name}`.toLowerCase();
  const hasRealMash = mashSteps.some((s) => s.timeMin > 0) && !mashName.toLowerCase().includes("no mash");
  const hasBoil = boilTime && boilTime > 0;
  const isBrewProcess = hasRealMash || hasBoil;

  let type = "biere";
  if (hay.includes("mead") || hay.includes("hydromel") || hay.includes("melomel") || hay.includes("metheglin")) type = "hydromel";
  else if (hay.includes("braggot")) type = "braggot";
  else if (hay.includes("cider") || hay.includes("cidre")) type = "cidre";
  else if (hay.includes("kvas")) type = "kvas";
  else if (hay.includes("amazake")) type = "amazake";
  else if (hay.includes("jun")) type = "jun";
  else if (hay.includes("kombucha")) type = "kombucha";
  else if (hay.includes("ginger beer")) type = "ginger_beer";
  else if (hay.includes("milk kefir") || hay.includes("kefir de lait") || hay.includes("dairy kefir")) {
    type = isBrewProcess ? "hybride" : "kefir_lait";
  } else if (hay.includes("kefir") || hay.includes("kéfir")) {
    // Un vrai empâtage/ébullition + kéfir en levain = hybride, pas un kéfir d'eau classique.
    type = isBrewProcess ? "hybride" : "kefir_eau";
  }

  const phases = [];
  if (hasRealMash) {
    const totalMashTime = mashSteps.reduce((sum, s) => sum + (s.timeMin || 0), 0);
    const mashNotes = mashSteps.map((s) => `${s.name} : ${s.tempC ?? "?"}°C, ${s.timeMin ?? "?"}min`).join("\n");
    phases.push({ key: "mash", name: "Empâtage", durationValue: totalMashTime || null, durationUnit: "minutes", temperatureTarget: null, notes: mashNotes });
  }
  if (hasBoil) {
    phases.push({ key: "boil", name: "Ébullition", durationValue: boilTime, durationUnit: "minutes", temperatureTarget: 100 });
  }
  if (primaryAge != null) {
    phases.push({ key: "primary", name: "Fermentation primaire (F1)", durationValue: primaryAge, durationUnit: "jours", temperatureTarget: primaryTemp });
  }
  if (secondaryAge != null && secondaryAge > 0) {
    phases.push({ key: "secondary", name: "Fermentation secondaire (F2)", durationValue: secondaryAge, durationUnit: "jours", temperatureTarget: secondaryTemp });
  }
  if (phases.length === 0) {
    phases.push({ key: "primary", name: "Fermentation primaire (F1)", durationValue: null, durationUnit: "jours", temperatureTarget: null });
  }

  const ingredients = [];

  recipeEl.querySelectorAll(":scope > FERMENTABLES > FERMENTABLE").forEach((f) => {
    const amountKg = numOf("AMOUNT", f) ?? 0;
    const ftype = textOf("TYPE", f).toLowerCase();
    const category = ftype.includes("sugar") ? "sucre" : ftype.includes("grain") ? "grain" : "autre";
    ingredients.push({
      phaseKey: phaseKeyForUse("Mash", phases),
      category,
      name: textOf("NAME", f),
      amount: Math.round(amountKg * 1000 * 100) / 100,
      unit: "g",
    });
  });

  recipeEl.querySelectorAll(":scope > HOPS > HOP").forEach((h) => {
    const amountKg = numOf("AMOUNT", h) ?? 0;
    const use = textOf("USE", h);
    const time = textOf("TIME", h);
    ingredients.push({
      phaseKey: phaseKeyForUse(use, phases),
      category: "houblon",
      name: textOf("NAME", h),
      amount: Math.round(amountKg * 1000 * 100) / 100,
      unit: "g",
      alphaAcidPct: numOf("ALPHA", h),
      timing: [use, time ? `${time}min` : null].filter(Boolean).join(" ") || null,
    });
  });

  recipeEl.querySelectorAll(":scope > MISCS > MISC").forEach((m) => {
    const mtype = textOf("TYPE", m).toLowerCase();
    const use = textOf("USE", m);
    const display = textOf("DISPLAY_AMOUNT", m);
    const amountIsWeight = textOf("AMOUNT_IS_WEIGHT", m).toLowerCase() === "true";
    const rawAmount = numOf("AMOUNT", m) ?? 0;

    let amount;
    let unit;
    const dm = display.match(/^([\d.]+)\s*(\S+)/);
    const dmAmount = dm ? Number(dm[1]) : NaN;
    if (dm && Number.isFinite(dmAmount)) {
      amount = dmAmount;
      unit = dm[2];
    } else {
      amount = amountIsWeight ? Math.round(rawAmount * 1000 * 100) / 100 : Math.round(rawAmount * 1000);
      unit = amountIsWeight ? "g" : "ml";
    }

    const category = mtype.includes("spice") || mtype.includes("herb") ? "plante" : mtype.includes("flavor") ? "fruit" : "autre";
    ingredients.push({ phaseKey: phaseKeyForUse(use, phases), category, name: textOf("NAME", m), amount, unit });
  });

  recipeEl.querySelectorAll(":scope > YEASTS > YEAST").forEach((y) => {
    ingredients.push({
      phaseKey: phaseKeyForUse("Primary", phases),
      category: "levure",
      name: textOf("NAME", y),
      amount: numOf("AMOUNT", y) ?? 0,
      unit: "g",
    });
  });

  return {
    title: name,
    type,
    batchSizeRef,
    instructions: notes || null,
    boilTime,
    style: styleName || null,
    phases,
    ingredients,
  };
}
