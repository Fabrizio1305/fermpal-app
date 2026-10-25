"use client";

import { COLORS } from "@/lib/uiStyles";
export default function StarRating({ value, onChange, size = 20 }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={onChange ? () => onChange(n === value ? null : n) : undefined}
          style={{ fontSize: size, color: value >= n ? COLORS.warn : COLORS.line, cursor: onChange ? "pointer" : "default", lineHeight: 1 }}
        >
          ★
        </span>
      ))}
    </div>
  );
}
