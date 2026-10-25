"use client";

import { useState } from "react";
import SimpleCombobox from "./SimpleCombobox";
import { inp, btnP, btnS, COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";

export default function LinkToStockModal({ ingredientName, stock, onSave, onClose }) {
  const [selected, setSelected] = useState("");
  const { t } = useT();

  const stockOptions = stock.map((s) => ({
    value: s.name,
    label: `${s.name} (${s.quantity}${s.unit})`,
  }));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: COLORS.overlay,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.surface,
          borderRadius: 16,
          padding: 24,
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>
          🔗 {t("linkToStock.linkToStock")}
        </div>
        <div style={{ fontSize: 13, color: COLORS.muted }}>
          {t("linkToStock.notFoundBefore")}<strong style={{ color: COLORS.text }}>"{ingredientName}"</strong>{t("linkToStock.notFoundAfter")}
        </div>
        <SimpleCombobox
          value={selected}
          onChange={setSelected}
          options={stockOptions}
          placeholder={t("linkToStock.pickFromStock")}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...btnP, background: COLORS.green, flex: 1, opacity: selected ? 1 : 0.5 }}
            disabled={!selected}
            onClick={() => onSave(selected)}
          >
            {t("linkToStock.saveLink")}
          </button>
          <button style={btnS} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
