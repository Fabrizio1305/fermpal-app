import assert from "node:assert/strict";
import { test } from "node:test";
import { planReminders, reminderIdFor } from "../mobile/src/platform/reminders.js";

const NOW = new Date("2026-09-11T10:00:00Z");
const batch = (over) => ({
  id: "b1", title: "Kombucha #1", status: "en_cours", phase_started_at: "2026-09-10T10:00:00Z",
  recipe_phases: { name: "Fermentation primaire (F1)", duration_value: 7, duration_unit: "jours" }, ...over,
});

test("un brassin en cours avec une durée → une notification à l'échéance, identifiant stable", () => {
  const plan = planReminders([batch()], NOW, "fr");
  assert.equal(plan.length, 1);
  assert.equal(plan[0].at.toISOString(), "2026-09-17T10:00:00.000Z");
  assert.equal(plan[0].title, "Kombucha #1");
  assert.match(plan[0].body, /Fermentation primaire \(F1\) : c'est le moment/);
  assert.equal(plan[0].id, reminderIdFor("b1"));
  assert.ok(Number.isInteger(plan[0].id) && plan[0].id > 0 && plan[0].id <= 0x7fffffff);
  assert.equal(reminderIdFor("b1"), reminderIdFor("b1"));
  assert.notEqual(reminderIdFor("b1"), reminderIdFor("b2"));
});

test("pas de notification : planifié, archivé, sans durée, ou échéance déjà passée", () => {
  const plan = planReminders([
    batch({ id: "p", status: "planifie" }),
    batch({ id: "a", status: "archive" }),
    batch({ id: "n", recipe_phases: { name: "F1", duration_value: null, duration_unit: "jours" } }),
    batch({ id: "o", phase_started_at: "2026-08-01T10:00:00Z" }),
    batch({ id: "s", phase_started_at: null }),
    batch({ id: "x", recipe_phases: null }),
  ], NOW);
  assert.deepEqual(plan, []);
});

test("plusieurs brassins : triés par échéance, textes en anglais si demandé", () => {
  const plan = planReminders([
    batch({ id: "late", recipe_phases: { name: "F2", duration_value: 3, duration_unit: "jours" } }),
    batch({ id: "soon", recipe_phases: { name: "Thé", duration_value: 90, duration_unit: "minutes" }, phase_started_at: "2026-09-11T09:00:00Z" }),
  ], NOW, "en");
  assert.deepEqual(plan.map((p) => p.batchId), ["soon", "late"]);
  assert.equal(plan[0].at.toISOString(), "2026-09-11T10:30:00.000Z");
  assert.match(plan[0].body, /Thé: time to move on/);
});
