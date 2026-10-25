"use client";

// Séparer un brassin en plusieurs lots, décidé SUR LE MOMENT.
//
// Le besoin vient de l'usage réel : un kéfir donne, au moment de la F2, plus de
// volume que prévu. On met l'excédent en bouteilles et on met un ingrédient
// DIFFÉRENT dans chacune. Deux conséquences pour cette modale :
//
//   1. Les volumes sont SAISIS À LA MAIN, jamais calculés ni proposés. On ne
//      sait ce qu'on a versé qu'au moment de verser ; proposer « 2,5 L » à
//      partir d'une division mentirait sur une opération qui n'est pas exacte.
//   2. La date de séparation est modifiable. La saisie se fait souvent le
//      lendemain, le brassin d'hier doit pouvoir être enregistré tel qu'il
//      s'est passé — sinon toutes les échéances des lots partent fausses.
//
// Le reste au brassin d'origine est affiché en direct : c'est le seul garde-fou
// visible contre une saisie qui dépasse ce qu'il y avait dans le bocal.
import { useState } from "react";
import { inp, btnP, btnS, COLORS } from "@/lib/uiStyles";

const field = { fontSize: 12, fontWeight: 700, color: COLORS.muted, display: "block", marginBottom: 5 };

import { round2 } from "@/lib/units";
import { useT } from "@/lib/i18n/useT";

function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SplitBatchModal({ batch, busy, onSplit, onClose }) {
  const { t } = useT();

  // Le brassin d'origine est implicitement le lot 1 : le premier lot séparé est
  // donc le 2.
  const [lots, setLots] = useState([{ name: `${batch.title} — lot 2`, volume: "" }]);
  const [splitAt, setSplitAt] = useState(nowLocal());

  const parentVolume = Number(batch.volume);
  const taken = lots.reduce((sum, l) => sum + (Number(l.volume) || 0), 0);
  const remaining = round2(parentVolume - taken);

  const volumesOk = lots.every((l) => l.volume !== "" && Number(l.volume) > 0);
  const namesOk = lots.every((l) => l.name.trim().length > 0);
  const canSplit = !busy && parentVolume > 0 && volumesOk && namesOk && remaining > 0;

  const setLot = (i, patch) => setLots((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLot = () => setLots((prev) => [...prev, { name: `${batch.title} — lot ${prev.length + 2}`, volume: "" }]);
  const removeLot = (i) => setLots((prev) => prev.filter((_, j) => j !== i));

  const submit = () => {
    if (!canSplit) return;
    onSplit({ lots: lots.map((l) => ({ name: l.name.trim(), volume: Number(l.volume) })), splitAt });
  };

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: COLORS.overlay, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: COLORS.text, marginBottom: 4 }}>
          {t("common.splitThisBatch")}
        </div>
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6, marginBottom: 14 }}>
          {t("splitBatch.eachLotBecomesABatch")}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
          {lots.map((lot, i) => (
            <div key={i} style={{ background: COLORS.row, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <label htmlFor={`split-lot-name-${i}`} style={{ ...field, marginBottom: 0 }}>
                  {t("splitBatch.lot", { n: i + 2 })}
                </label>
                {lots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLot(i)}
                    style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 11, padding: 0 }}
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
              <input
                id={`split-lot-name-${i}`}
                style={{ ...inp, marginBottom: 8 }}
                value={lot.name}
                onChange={(e) => setLot(i, { name: e.target.value })}
              />
              <label htmlFor={`split-lot-volume-${i}`} style={field}>
                {t("splitBatch.volumeSetAsideL")}
              </label>
              <input
                id={`split-lot-volume-${i}`}
                style={inp}
                type="number"
                step="any"
                min="0"
                placeholder={t("splitBatch.eG15")}
                value={lot.volume}
                onChange={(e) => setLot(i, { volume: e.target.value })}
                autoFocus={i === 0}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          // `gap` et non une espace dans le libellé : btnS est en inline-flex,
          // ses enfants sont des items et l'espace entre eux est écrasé.
          style={{ ...btnS, marginBottom: 14, fontSize: 12, padding: "7px 12px", gap: 4 }}
          onClick={addLot}
          disabled={busy}
        >
          <span aria-hidden="true">+ </span>
          {t("splitBatch.addALot")}
        </button>

        <label htmlFor="split-at" style={field}>
          {t("splitBatch.splitDate")}
        </label>
        <input id="split-at" style={{ ...inp, marginBottom: 6 }} type="datetime-local" value={splitAt} onChange={(e) => setSplitAt(e.target.value)} />
        <div style={{ fontSize: 11.5, color: COLORS.faint, lineHeight: 1.5, marginBottom: 14 }}>
          {t("splitBatch.moveItBackIfYou")}
        </div>

        {/* Le seul garde-fou visible : ce qui reste dans le bocal d'origine. */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: remaining > 0 ? COLORS.text : COLORS.danger,
            background: COLORS.row,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 14,
          }}
        >
          {t("splitBatch.leftInTheOriginalBatch")}
          {remaining > 0 ? `${remaining} L` : t("splitBatch.nothing")}
          {parentVolume > 0 && (
            <span style={{ fontWeight: 500, color: COLORS.muted }}>{t("splitBatch.outOfL", { parentVolume })}</span>
          )}
          {remaining <= 0 && (
            <div style={{ fontWeight: 500, fontSize: 12, marginTop: 4 }}>
              {t("splitBatch.theOriginalBatchHasTo")}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...btnP, opacity: canSplit ? 1 : 0.5, cursor: canSplit ? "pointer" : "not-allowed" }}
            disabled={!canSplit}
            onClick={submit}
          >
            {busy ? (t("splitBatch.splitting")) : t("splitBatch.split")}
          </button>
          <button style={btnS} disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
