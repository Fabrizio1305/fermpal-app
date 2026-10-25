// Assemblage de l'app embarquée : langue et toasts (partagés avec le site),
// ouverture de la base locale, routeur à ancre, bouton retour Android,
// rappels locaux (recalcul à l'ouverture, ouverture du brassin au toucher).
import { createContext, useContext, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import Loading from "@/app/components/Loading";
import { LangProvider, useLang } from "@/lib/LangContext";
import { detectLang } from "@/lib/i18n";
import { UiProvider } from "@/lib/UiContext";
import { DEFAULT_PATH, RouteContext, matchPath, navigate, useHashPath } from "./router.jsx";
import { openMainDatabase } from "./db/openDatabase.js";
import { installTestHooks } from "./testHooks.js";
import { onReminderTap, reconcileReminders } from "./platform/reminders.js";
import Dashboard from "./screens/Dashboard.jsx";
import RecipesList from "./screens/RecipesList.jsx";
import RecipeEdit from "./screens/RecipeEdit.jsx";
import SettingsScreen from "./screens/SettingsScreen.jsx";
import RecoveryScreen from "./screens/RecoveryScreen.jsx";
import StockScreen from "./screens/StockScreen.jsx";
import ShoppingScreen from "./screens/ShoppingScreen.jsx";
import BatchesList from "./screens/BatchesList.jsx";
import BatchDetail from "./screens/BatchDetail.jsx";
import ImportBeerXml from "./screens/ImportBeerXml.jsx";
import AiRecipe from "./screens/AiRecipe.jsx";
import { platformName } from "./db/openDatabase.js";
import { autoBackupIfDue } from "./data/cloudBackups.js";

const DbContext = createContext(null);

export function useDb() {
  return useContext(DbContext);
}

function DbProvider({ children }) {
  const [state, setState] = useState({ status: "opening" });
  const { lang } = useLang();

  useEffect(() => {
    let cancelled = false;
    openMainDatabase()
      .then((res) => {
        if (cancelled) return;
        installTestHooks(res.db);
        setState({ status: res.error ? "error" : "ready", ...res });
        if (!res.error) reconcileReminders(res.db, lang);
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", db: null, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === "opening") return <Loading />;
  if (state.status === "error") return <RecoveryScreen db={state.db} error={state.error} />;
  return <DbContext.Provider value={{ db: state.db, migration: state.migration }}>{children}</DbContext.Provider>;
}

const ROUTES = [
  ["/app", Dashboard],
  ["/app/recipes", RecipesList],
  ["/app/recipes/import", ImportBeerXml],
  ["/app/recipes/ai", AiRecipe],
  ["/app/recipes/:id", RecipeEdit],
  ["/app/stock", StockScreen],
  ["/app/shopping", ShoppingScreen],
  ["/app/batches", BatchesList],
  ["/app/batches/:id", BatchDetail],
  ["/app/settings", SettingsScreen],
  ["/app/backup", SettingsScreen],
];

function Screen() {
  const pathname = useHashPath();
  let match = null;
  for (const [pattern, Component] of ROUTES) {
    const params = matchPath(pattern, pathname);
    if (params) {
      match = { Component, params };
      break;
    }
  }
  useEffect(() => {
    if (!match) navigate(DEFAULT_PATH, { replace: true });
  }, [match]);
  if (!match) return null;
  const { Component, params } = match;
  return (
    <RouteContext.Provider value={{ pathname, params }}>
      <Component key={pathname} />
    </RouteContext.Provider>
  );
}

// Copie automatique dans le kDrive (23/10, remplace la sauvegarde en ligne du
// lot L4) : tentée peu après l'ouverture et à chaque retour au premier plan ;
// autoBackupIfDue décide (activée, kDrive relié, en ligne, carnet modifié, pas
// plus d'une fois toutes les 10 min) et ne lève jamais. Le résultat est exposé aux tests (window.__fermpal).
function CloudAutoBackup() {
  const { db } = useDb();
  useEffect(() => {
    if (!db) return undefined;
    const attempt = async () => {
      const result = await autoBackupIfDue(db, { platform: platformName() });
      if (window.__fermpal) window.__fermpal.lastAutoBackup = result;
    };
    const timer = setTimeout(attempt, 3000);
    let handle;
    if (Capacitor.isNativePlatform()) {
      import("@capacitor/app").then(({ App }) => {
        handle = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) attempt();
        });
      });
    } else {
      const onVisible = () => {
        if (document.visibilityState === "visible") attempt();
      };
      document.addEventListener("visibilitychange", onVisible);
      handle = Promise.resolve({ remove: () => document.removeEventListener("visibilitychange", onVisible) });
    }
    return () => {
      clearTimeout(timer);
      handle?.then?.((h) => h.remove());
    };
  }, [db]);
  return null;
}

function useAndroidBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle;
    import("@capacitor/app").then(({ App }) => {
      handle = App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else App.minimizeApp();
      });
    });
    return () => {
      handle?.then?.((h) => h.remove());
    };
  }, []);
}

function useReminderTaps() {
  useEffect(() => {
    const handle = onReminderTap((batchId) => navigate(`/app/batches/${batchId}`));
    return () => {
      handle?.then?.((h) => h?.remove?.());
    };
  }, []);
}

export default function App() {
  useAndroidBackButton();
  useReminderTaps();
  return (
    <LangProvider initialLang={detectLang()}>
      <UiProvider>
        <DbProvider>
          <CloudAutoBackup />
          <Screen />
        </DbProvider>
      </UiProvider>
    </LangProvider>
  );
}
