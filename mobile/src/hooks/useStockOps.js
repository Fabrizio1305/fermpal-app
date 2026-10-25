// Exécution d'une opération de stock depuis un écran : un seul chemin
// d'erreur (toast), un verrou pendant l'exécution, et le résultat ou null.
// Pas de « demande en attente » à rejouer comme sur le site : la base est
// locale, la réponse ne se perd pas.
import { useCallback, useRef, useState } from "react";
import { useToast } from "@/lib/UiContext";
import { runStockOperation, stockOperationMessage } from "../data/stockOperations.js";
import { useT } from "@/lib/i18n/useT";

export function useStockOps(db) {
  const { t, lang } = useT();
  const toast = useToast();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (kind, payload) => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    try {
      const result = await runStockOperation(db, { kind, payload });
      for (const movement of result.movements || []) {
        if (movement.reason === "no_stock") toast(t("common.ingredientNotFoundInStock"));
        if (movement.reason === "incompatible_unit") toast(t("common.incompatibleUnitsStockUnchanged"));
        if (Number(movement.delta) < 0 && Number(movement.quantity_after) < 0) {
          toast(t("stock.insufficientStockTheBalanceIs"), "error");
        }
      }
      return result;
    } catch (err) {
      toast(err?.code ? stockOperationMessage(err, lang) : (t("common.error")) + (err?.message || String(err)), "error");
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [db, lang, t, toast]);

  // Action locale quelconque (création, journal…) sous le même verrou.
  const act = useCallback(async (fn) => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      toast((t("common.error")) + (err?.message || String(err)), "error");
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [t, toast]);

  return { run, act, busy };
}
