// Remplaçant de `next/navigation` (useRouter, useParams, usePathname) pour
// l'app embarquée, au-dessus du routeur à ancre.
import { useMemo } from "react";
import { navigate, useRoute } from "../router.jsx";

export function useRouter() {
  return useMemo(
    () => ({
      push: (path) => navigate(path),
      replace: (path) => navigate(path, { replace: true }),
      back: () => window.history.back(),
      refresh: () => {},
      prefetch: () => {},
    }),
    [],
  );
}

export function useParams() {
  return useRoute().params;
}

export function usePathname() {
  return useRoute().pathname;
}

export function useSearchParams() {
  const { pathname } = useRoute();
  return useMemo(() => new URLSearchParams(pathname.split("?")[1] || ""), [pathname]);
}
