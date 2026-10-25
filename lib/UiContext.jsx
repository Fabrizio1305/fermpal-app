"use client";

// Toasts + confirmations bottom-sheet — remplace les alert()/confirm()
// navigateur (pattern porté de MyFrigo, habillé aux couleurs FermPal).
//
// Usage dans un composant client :
//   const toast = useToast();
//   toast("Recette importée ✓");                       // info, disparaît seul
//   toast("Erreur : " + error.message, "error");        // rouge, reste plus longtemps
//
//   const confirm = useConfirm();
//   if (!(await confirm(t("batch.deleteThisEntry")))) return;

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { COLORS } from "@/lib/uiStyles";
import { useT } from "@/lib/i18n/useT";

const UiContext = createContext(null);

export function UiProvider({ children }) {
  const { t } = useT();
  const [toast, setToast] = useState(null); // { msg, kind }
  const [confirmState, setConfirmState] = useState(null); // { msg, resolve }
  const timerRef = useRef(null);

  const showToast = useCallback((msg, kind = "info") => {
    clearTimeout(timerRef.current);
    setToast({ msg, kind });
    timerRef.current = setTimeout(() => setToast(null), kind === "error" ? 5000 : 2600);
  }, []);

  const askConfirm = useCallback((msg) => {
    return new Promise((resolve) => setConfirmState({ msg, resolve }));
  }, []);

  const answer = (ok) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  return (
    <UiContext.Provider value={{ showToast, askConfirm }}>
      {children}

      {toast && (
        <div
          // Région live (annoncée par les lecteurs d'écran) mais SANS role="status" :
          // le site en a déjà (bandeaux de chargement) et sa suite E2E les cible par
          // rôle ; un second élément les rendait ambigus (gate rouge du 12/09, #20).
          aria-live="polite"
          aria-atomic="true"
          data-testid="toast"
          onClick={() => setToast(null)}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            maxWidth: "min(92vw, 480px)",
            padding: "11px 18px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "'Inter', system-ui, sans-serif",
            // Les messages de quota (lib/quota.js) tiennent sur deux lignes
            // séparées par un \n : sans ceci, la 2e ligne ("Passe en Pro…")
            // était aplatie derrière la 1re et tronquée par le maxWidth.
            whiteSpace: "pre-line",
            color: COLORS.surface,
            background: toast.kind === "error" ? COLORS.danger : COLORS.greenDark,
            boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
            cursor: "pointer",
          }}
        >
          {toast.msg}
        </div>
      )}

      {confirmState && (
        <div
          onClick={() => answer(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "rgba(28,25,23,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COLORS.surface,
              borderRadius: "20px 20px 0 0",
              padding: "20px 20px 32px",
              width: "100%",
              maxWidth: 500,
              boxSizing: "border-box",
              boxShadow: "0 -4px 30px rgba(0,0,0,0.15)",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, lineHeight: 1.5, whiteSpace: "pre-line" }}>
              {confirmState.msg}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => answer(false)}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: 10,
                  border: `1.5px solid ${COLORS.border}`,
                  background: COLORS.soft,
                  color: COLORS.muted,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => answer(true)}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: 10,
                  border: "none",
                  background: COLORS.danger,
                  color: COLORS.surface,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(UiContext);
  return ctx ? ctx.showToast : (msg) => window.alert(msg);
}

export function useConfirm() {
  const ctx = useContext(UiContext);
  return ctx ? ctx.askConfirm : async (msg) => window.confirm(msg);
}
