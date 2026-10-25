"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, categoryLabel } from "@/lib/ingredientCategories";
import { inp, COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";

function groupByCategory(items) {
  const byCat = {};
  items.forEach((item) => {
    const cat = item.category || "autre";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(item);
  });
  return Object.entries(byCat);
}

// Sélecteur d'ingrédient groupé par catégorie (avec icône), et éventuellement
// par groupe de niveau supérieur (ex: "Mon stock" / "Catalogue générique").
// `groups` : [{ label, items: [{ id, name, category, unit|default_unit, quantity? }] }]
export default function IngredientCombobox({ value, onPick, groups, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const wrapRef = useRef(null);
  const { t, lang } = useT();

  useEffect(() => setQuery(value || ""), [value]);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filteredGroups = groups
    .map((g) => {
      const seen = new Set();
      const deduped = g.items.filter((i) => {
        const key = i.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...g, items: q ? deduped.filter((i) => i.name.toLowerCase().includes(q)) : deduped };
    })
    .filter((g) => g.items.length > 0);

  const pick = (item) => {
    const unit = item.unit ?? item.default_unit;
    onPick({ name: item.name, unit, category: item.category, supplier: item.supplier });
    setQuery(item.name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <input
        style={inp}
        placeholder={t("ingredientCombobox.ingredient")}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onPick({ name: e.target.value });
        }}
      />
      {open && filteredGroups.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: COLORS.surface,
            border: `1.5px solid ${COLORS.line}`,
            borderRadius: 9,
            marginTop: 4,
            maxHeight: 260,
            overflowY: "auto",
            zIndex: 20,
            boxShadow: "0 6px 20px rgba(0,0,0,0.1)",
          }}
        >
          {filteredGroups.map((g) => (
            <div key={g.label}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.green, padding: "6px 10px", background: COLORS.bg }}>{g.label}</div>
              {groupByCategory(g.items).map(([cat, items]) => (
                <div key={cat}>
                  <div style={{ fontSize: 11, color: COLORS.faint, padding: "4px 10px 2px" }}>
                    {CATEGORIES[cat]?.icon} {categoryLabel(cat, lang)}
                  </div>
                  {items.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => pick(item)}
                      onMouseDown={(e) => e.preventDefault()}
                      style={{ padding: "7px 10px", fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                    >
                      <span>{item.name}</span>
                      {item.quantity != null && (
                        <span style={{ color: COLORS.faint, fontSize: 12 }}>
                          {item.quantity} {item.unit}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
