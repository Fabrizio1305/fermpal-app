"use client";

import { useEffect, useRef, useState } from "react";
import { inp, COLORS } from "@/lib/uiStyles";

// options : string[] | { value: string, label: string }[]
// Quand options est { value, label }, value est la clé stockée, label est affiché.
function normalizeOptions(options) {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

// `freeText` : la valeur n'est PAS limitée à la liste (fournisseur, unité,
// style). Sans ce mode, la saisie ne vivait que dans l'état local `query` et
// n'était jamais remontée : taper un fournisseur qui n'existait pas encore ne
// sauvegardait rien et le champ se vidait au clic ailleurs (retour d'usage
// 04/08). Les listes fermées (catégorie, type, phase) gardent l'ancien
// comportement : seule une option choisie est une valeur valide.
export default function SimpleCombobox({ value, onChange, options = [], placeholder, style: styleProp, freeText = false }) {
  const normalized = normalizeOptions(options);
  const labelFor = (v) => normalized.find((o) => o.value === v)?.label ?? v ?? "";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef(null);

  // quand la valeur externe change et qu'on ne saisit pas, on n'a rien à faire
  // la valeur affichée dans l'input est calculée à partir de value quand !searching
  const displayedQuery = searching ? query : labelFor(value);

  useEffect(() => {
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setSearching(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = query.trim().toLowerCase();
  // quand on recherche, filtrer ; sinon montrer tout
  const filtered = searching && q
    ? normalized.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : normalized;

  const pick = (opt) => {
    onChange(opt.value);
    setQuery("");
    setSearching(false);
    setOpen(false);
  };

  const onFocus = () => {
    setQuery("");
    setSearching(false);
    setOpen(true);
  };

  const handleChange = (e) => {
    setQuery(e.target.value);
    setSearching(true);
    setOpen(true);
    if (freeText) onChange(e.target.value);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", ...styleProp }}>
      <input
        style={inp}
        placeholder={placeholder}
        value={displayedQuery}
        onFocus={onFocus}
        onChange={handleChange}
      />
      {open && filtered.length > 0 && (
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
            maxHeight: 220,
            overflowY: "auto",
            zIndex: 20,
            boxShadow: "0 6px 20px rgba(0,0,0,0.1)",
          }}
        >
          {filtered.map((opt) => (
            <div
              key={opt.value}
              onClick={() => pick(opt)}
              onMouseDown={(e) => e.preventDefault()}
              style={{
                padding: "9px 12px",
                fontSize: 13,
                cursor: "pointer",
                color: COLORS.text,
                borderBottom: `1px solid ${COLORS.bg}`,
                background: opt.value === value ? COLORS.greenSoft : "",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.bg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = opt.value === value ? COLORS.greenSoft : "")}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
