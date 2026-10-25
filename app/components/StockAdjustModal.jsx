"use client";

import { useState } from "react";
import { inp, btnP, btnS, COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";

export default function StockAdjustModal({ name, unit, currentQuantity, onSave, onClose }) {
  const [value, setValue] = useState(currentQuantity != null ? String(currentQuantity) : "0");
  const { t } = useT();

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 340 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>{t("stockAdjust.adjustStock", { name })}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={{ ...inp, flex: 1 }} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          <span style={{ fontSize: 13, color: COLORS.muted, alignSelf: "center" }}>{unit}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnP} onClick={() => onSave(Number(value) || 0)}>
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
