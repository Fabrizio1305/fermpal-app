// Carte d'activation des rappels locaux, sur le tableau de bord. Se tait sur
// le web (pas de plugin), une fois activée, ou après « Plus tard » (pour la
// session). Aucune collecte : tout se passe sur l'appareil.
//
// Si la vérification de permission échoue (plugin absent, erreur native), la
// carte s'affiche quand même : l'échec remonte au toucher de « Activer », au
// lieu de disparaître en silence (constaté le 11/09 sur le Pixel : point 7 de
// la checklist L2, carte invisible).
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useToast } from "@/lib/UiContext";
import { btnP, btnS, card, COLORS } from "@/lib/uiStyles";
import { useDb } from "../App.jsx";
import { enableReminders, remindersEnabled, reminderPermission } from "../platform/reminders.js";
import { useT } from "@/lib/i18n/useT";

let dismissedThisSession = false;

export default function RemindersCard() {
  const { db } = useDb();
  const { t, lang } = useT();
  const toast = useToast();
  const [state, setState] = useState("loading"); // loading | hidden | offer | denied
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!Capacitor.isNativePlatform() || remindersEnabled() || dismissedThisSession) {
        if (active) setState("hidden");
        return;
      }
      let perm = "unknown";
      try {
        perm = await reminderPermission();
      } catch (err) {
        if (active) setDetail(err?.message || String(err));
      }
      if (!active) return;
      setState(perm === "denied" ? "denied" : "offer");
    })();
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading" || state === "hidden") return null;

  const enable = async () => {
    try {
      const res = await enableReminders(db, lang);
      if (res === "granted") {
        toast(t("reminders.remindersOnYouLlBe"));
        setState("hidden");
      } else {
        setDetail(res);
        setState("denied");
      }
    } catch (err) {
      toast((t("reminders.cannotEnableReminders")) + (err?.message || String(err)), "error");
    }
  };

  return (
    <div style={{ ...card, marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }} data-testid="reminders-card">
      <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>🔔 {t("common.phaseReminders")}</div>
      <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
        {state === "denied"
          ? (t("reminders.notificationsAreDeniedForFermpal"))
          : (t("reminders.aNotificationWhenAPhase"))}
        {detail && <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 4, fontFamily: "monospace" }}>{detail}</div>}
      </div>
      {state === "offer" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnP} onClick={enable}>{t("common.enableReminders")}</button>
          <button style={btnS} onClick={() => { dismissedThisSession = true; setState("hidden"); }}>{t("common.later")}</button>
        </div>
      )}
    </div>
  );
}
