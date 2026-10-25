"use client";

// Ajout ou modification d'un ingrédient SUR UN BATCH (pas sur la recette) :
// l'oubli de dernière minute, la quantité corrigée à la volée. La recette n'est
// touchée que si l'utilisateur le demande explicitement ensuite
// (voir SaveRecipeChangesModal).
import { useState } from "react";
import { CATEGORIES, categoryLabel } from "@/lib/ingredientCategories";
import { inp, btnP, btnS, COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";

const UNITS = ["g", "kg", "mg", "ml", "cl", "L", "pièce", "sachet", "càs", "càc"];

const field = { fontSize: 12, fontWeight: 700, color: COLORS.muted, display: "block", marginBottom: 5 };

export default function BatchIngredientModal({ item, phases, defaultPhaseId, onSave, onClose }) {
  const { t, lang } = useT();
  const isEdit = Boolean(item?.id);

  const [name, setName] = useState(item?.name || "");
  const [amount, setAmount] = useState(item?.amount != null ? String(item.amount) : "");
  const [unit, setUnit] = useState(item?.unit || "g");
  const [category, setCategory] = useState(item?.category || "autre");
  const [phaseId, setPhaseId] = useState(item?.phase_id ?? defaultPhaseId ?? "");
  const [isStarter, setIsStarter] = useState(Boolean(item?.is_starter));

  const canSave = name.trim().length > 0 && Number(amount) >= 0 && amount !== "";

  const submit = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      amount: Number(amount),
      unit,
      category,
      phase_id: phaseId || null,
      is_starter: isStarter,
    });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 380, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 14 }}>
          {isEdit ? (t("batchIngredient.editIngredient")) : t("common.addAnIngredient")}
        </div>

        <label htmlFor="bi-name" style={field}>{t("batchIngredient.name")}</label>
        <input id="bi-name" style={{ ...inp, marginBottom: 12 }} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!isEdit} />

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="bi-amount" style={field}>{t("common.amount")}</label>
            <input id="bi-amount" style={inp} type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={isEdit} />
          </div>
          <div style={{ width: 110 }}>
            <label htmlFor="bi-unit" style={field}>{t("common.unit")}</label>
            <select id="bi-unit" style={inp} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="bi-category" style={field}>{t("common.category")}</label>
        <select id="bi-category" style={{ ...inp, marginBottom: 12 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(CATEGORIES).map(([key, c]) => (
            <option key={key} value={key}>
              {c.icon} {categoryLabel(key, lang)}
            </option>
          ))}
        </select>

        {phases.length > 0 && (
          <>
            <label htmlFor="bi-phase" style={field}>{t("common.phase")}</label>
            <select id="bi-phase" style={{ ...inp, marginBottom: 12 }} value={phaseId || ""} onChange={(e) => setPhaseId(e.target.value)}>
              <option value="">{t("common.noPhase")}</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}

        {/* Un starter (grains de kéfir, SCOBY) se réutilise : jamais déstocké. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.muted, marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={isStarter} onChange={(e) => setIsStarter(e.target.checked)} />
          {t("batchIngredient.reusableStarterNeverDeducted")}
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...btnP, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave} onClick={submit}>
            {t("common.save")}
          </button>
          <button style={btnS} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
