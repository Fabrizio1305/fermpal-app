// Coquille d'écran de l'app embarquée : même gabarit que AppShell du site
// (fond crème, colonne 640 px, titre vert, actions à droite), avec le menu
// du carnet local. Pas de compte, pas de déconnexion.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";

const itemStyle = {
  display: "block",
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 600,
  color: COLORS.text,
  textDecoration: "none",
  background: "none",
  border: "none",
  textAlign: "left",
  width: "100%",
  cursor: "pointer",
};

const Icon = ({ children }) => <span style={{ display: "inline-block", width: 24 }}>{children}</span>;

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const entries = [
    ["/app", "🏠", t("common.dashboard")],
    ["/app/stock", "📦", t("common.stock")],
    ["/app/recipes", "📖", t("common.recipes")],
    ["/app/batches", "🧪", t("common.batches")],
    ["/app/shopping", "🛒", t("nav.shopping")],
    ["/app/settings", "⚙️", t("common.settings")],
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        style={{ background: COLORS.soft, border: `1.5px solid ${COLORS.line}`, borderRadius: 9, width: 44, height: 44, fontSize: 16, cursor: "pointer", color: COLORS.text }}
      >
        ☰
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.25)", minWidth: 230, overflow: "hidden", zIndex: 200 }}>
          {entries.map(([href, icon, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} style={itemStyle}>
              <Icon>{icon}</Icon>
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MobileShell({ title, back, backLabel, actions, children, bottomPadding = 40 }) {
  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: `24px 20px ${bottomPadding}px` }}>
        {back && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Link href={back} style={{ fontSize: 13, color: COLORS.muted, textDecoration: "none" }}>
              ← {backLabel}
            </Link>
            <MobileMenu />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: COLORS.green, letterSpacing: -0.3 }}>{title}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {actions}
            {!back && <MobileMenu />}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
