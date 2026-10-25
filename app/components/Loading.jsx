"use client";

import { COLORS } from "@/lib/uiStyles";
export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `3px solid ${COLORS.line}`,
          borderTopColor: COLORS.green,
          animation: "fermpal-spin 0.7s linear infinite",
        }}
      />
      <style>{`@keyframes fermpal-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
