// Rappels de phase par notifications LOCALES Android (cadrage §4) : la
// promesse « FermPal te dit quand passer à la phase suivante », sans serveur,
// sans cron, sans Web Push. Une notification est programmée à l'échéance de la
// phase courante de chaque brassin en cours ; on recalcule tout après chaque
// geste qui change une phase (démarrer, suivante, précédente, archiver,
// supprimer, séparer, corriger une date) et à chaque ouverture de l'app.
//
// Ce que ça ne promet pas : la seconde exacte (alarme inexacte acceptée quand
// Android l'impose), ni une sécurité alimentaire. Contenu masqué sur l'écran
// verrouillé (canal en visibilité privée).
//
// `planReminders` est pur et testé ; le reste parle au plugin natif et ne fait
// rien sur le web.

import { Capacitor } from "@capacitor/core";
import { computePhaseTiming } from "../../../lib/phaseTiming.js";
import { listBatches } from "../data/batches.js";
import { t } from "@/lib/i18n";

const KEY = "fermpal_reminders";
const CHANNEL_ID = "fermpal-phases";
// Plage réservée aux rappels de phase : les identifiants sont dérivés du
// brassin (hachage 31 bits), stables d'une reconciliation à l'autre.
const ID_PREFIX_MASK = 0x7fffffff;

export function reminderIdFor(batchId) {
  let h = 2166136261;
  for (let i = 0; i < batchId.length; i++) {
    h ^= batchId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) & ID_PREFIX_MASK || 1;
}

export function remindersEnabled() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function setEnabledFlag(on) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* préférence non mémorisée : vaut pour la session */
  }
}

// Brassins en cours avec une échéance connue et future → notifications.
// `batches` : sortie de listBatches (phase courante jointe).
export function planReminders(batches, now, lang = "fr") {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const out = [];
  for (const b of batches || []) {
    if (b.status !== "en_cours" || !b.recipe_phases) continue;
    const timing = computePhaseTiming(b.phase_started_at, b.recipe_phases.duration_value, b.recipe_phases.duration_unit, nowMs);
    if (timing.status === "unknown" || !timing.dueAt || timing.dueAt.getTime() <= nowMs) continue;
    const phase = b.recipe_phases.name || (t("reminders.currentPhase", null, lang));
    out.push({
      id: reminderIdFor(b.id),
      batchId: b.id,
      at: timing.dueAt,
      title: b.title,
      body: t("reminders.timeToMoveOnTo", { phase }, lang),
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

// Le plugin Capacitor est un Proxy : LIRE une propriété = appeler une méthode
// native. Une fonction async qui le renvoie fait résoudre une Promise avec lui,
// et la résolution lit `.then` → « LocalNotifications.then() is not implemented
// on android » (vu sur le Pixel le 12/09 : c'était le point 7 de L2). On renvoie
// donc le MODULE, jamais le plugin ; l'appelant lit `.LocalNotifications` après.
let notificationsModule = null;
async function plugin() {
  if (!Capacitor.isNativePlatform()) return null;
  notificationsModule ??= await import("@capacitor/local-notifications");
  return notificationsModule;
}

export async function reminderPermission() {
  const ln = (await plugin())?.LocalNotifications;
  if (!ln) return "unavailable";
  const { display } = await ln.checkPermissions();
  return display; // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
}

export async function enableReminders(db, lang) {
  const ln = (await plugin())?.LocalNotifications;
  if (!ln) return "unavailable";
  const { display } = await ln.requestPermissions();
  if (display !== "granted") return display;
  await ln.createChannel({
    id: CHANNEL_ID,
    name: t("common.phaseReminders", null, lang),
    description: t("reminders.whenAFermentationPhaseReaches", null, lang),
    importance: 3,
    visibility: 0, // privé : le contenu est masqué sur l'écran verrouillé
    vibration: true,
  });
  setEnabledFlag(true);
  await reconcileReminders(db, lang);
  return "granted";
}

export async function disableReminders() {
  setEnabledFlag(false);
  const ln = (await plugin())?.LocalNotifications;
  if (!ln) return;
  const { notifications } = await ln.getPending();
  if (notifications.length) await ln.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
}

// Aligne les notifications programmées sur l'état réel du carnet.
export async function reconcileReminders(db, lang = "fr", now = new Date()) {
  const ln = (await plugin())?.LocalNotifications;
  if (!ln) return { scheduled: 0, cancelled: 0 };
  if (!remindersEnabled()) return { scheduled: 0, cancelled: 0 };
  try {
    const planned = planReminders(await listBatches(db, { includeArchived: false }), now, lang);
    const { notifications: pending } = await ln.getPending();
    const plannedById = new Map(planned.map((p) => [p.id, p]));
    const keep = new Set();
    const toCancel = [];
    for (const n of pending) {
      const p = plannedById.get(n.id);
      const at = n.schedule?.at ? new Date(n.schedule.at).getTime() : null;
      if (p && at === p.at.getTime()) keep.add(n.id);
      else toCancel.push({ id: n.id });
    }
    if (toCancel.length) await ln.cancel({ notifications: toCancel });
    const toSchedule = planned.filter((p) => !keep.has(p.id));
    if (toSchedule.length) {
      await ln.schedule({
        notifications: toSchedule.map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          channelId: CHANNEL_ID,
          schedule: { at: p.at, allowWhileIdle: true },
          extra: { batchId: p.batchId },
        })),
      });
    }
    return { scheduled: toSchedule.length, cancelled: toCancel.length };
  } catch (err) {
    // Un rappel qui échoue ne doit jamais casser le geste métier qui l'a déclenché.
    console.warn("[reminders] reconciliation impossible", err);
    return { scheduled: 0, cancelled: 0, error: err?.message };
  }
}

// État lisible pour l'écran de réglages : permission, activation, rappels programmés.
export async function remindersStatus(db, lang = "fr") {
  const ln = (await plugin())?.LocalNotifications;
  if (!ln) return { available: false, enabled: false, permission: "unavailable", pending: [], planned: [] };
  let permission = "unknown";
  let pending = [];
  let error = null;
  try {
    permission = (await ln.checkPermissions()).display;
    pending = (await ln.getPending()).notifications.map((n) => ({ id: n.id, at: n.schedule?.at ?? null, title: n.title }));
  } catch (err) {
    error = err?.message || String(err);
  }
  const planned = planReminders(await listBatches(db, { includeArchived: false }), new Date(), lang);
  return { available: true, enabled: remindersEnabled(), permission, pending, planned, error };
}

// Toucher une notification ouvre le brassin concerné.
export async function onReminderTap(handler) {
  const ln = (await plugin())?.LocalNotifications;
  if (!ln) return null;
  return ln.addListener("localNotificationActionPerformed", (action) => {
    const batchId = action?.notification?.extra?.batchId;
    if (batchId) handler(batchId);
  });
}
