// Styles inline partagés, dupliqués auparavant dans ~10 fichiers.

// Design tokens — identité FermPal (vert forêt / crème / ambre), niveau de
// finition aligné sur MyFrigo : cartes à bordure subtile, badges, surfaces
// douces. Toujours passer par ces tokens plutôt que des hex en dur.
//
// Chaque token est une variable CSS AVEC sa valeur claire en repli : sur le
// site, aucune variable n'est définie et le rendu est identique à avant ; dans
// l'app embarquée (mobile/src/theme.css), les variables prennent les valeurs
// du mode clair ou sombre selon le réglage de l'appareil ou de l'app.
const token = (name, light) => `var(--fp-${name}, ${light})`;

export const COLORS = {
  green: token("green", "#166534"),
  greenDark: token("green-dark", "#14532d"),
  amber: token("amber", "#e8a030"),
  bg: token("bg", "#f5f2ea"),          // fond crème de l'app
  surface: token("surface", "#fff"),
  border: token("border", "#eee9df"),      // bordure de carte, à peine visible
  text: token("text", "#1c1917"),
  muted: token("muted", "#78716c"),
  faint: token("faint", "#a8a29e"),
  danger: token("danger", "#dc2626"),
  successBg: token("success-bg", "#ecfdf5"),
  successBorder: token("success-border", "#a7f3d0"),
  // Ajoutés avec l'app embarquée (L2) : tons qui vivaient en dur dans les écrans.
  line: token("line", "#e7e5e4"),         // bordure des champs et boutons secondaires
  soft: token("soft", "#f5f0eb"),         // fond des boutons secondaires, chips
  row: token("row", "#f9f7f4"),           // fond d'une ligne dans une carte
  greenSoft: token("green-soft", "#f0fdf4"),
  greenSoftBorder: token("green-soft-border", "#bbf7d0"),
  greenChip: token("green-chip", "#dcfce7"),
  amberSoft: token("amber-soft", "#fffbeb"),
  amberSoftBorder: token("amber-soft-border", "#fde68a"),
  amberText: token("amber-text", "#78350f"),
  dangerSoft: token("danger-soft", "#fef2f2"),
  onGreen: token("on-green", "#fff"),     // texte sur fond vert
  overlay: token("overlay", "rgba(0,0,0,0.5)"),
  warn: token("warn", "#f59e0b"),         // correspondance approximative, D-15
};

// Carte standard : surface blanche, bordure subtile, coins arrondis cohérents.
export const card = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 14,
  padding: 16,
};

// Petite pastille d'état (statut de batch, stock, phase…).
export const badge = (color = COLORS.green, bg = COLORS.successBg) => ({
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  color,
  background: bg,
});

export const inp = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 9,
  border: `1.5px solid ${COLORS.line}`,
  fontSize: 13,
  outline: "none",
  background: COLORS.surface,
  boxSizing: "border-box",
  color: COLORS.text,
  // Même plancher tactile que les boutons (voir TOUCH plus bas) : un champ à
  // 37 px se rate au pouce autant qu'un bouton, et surtout un champ et un
  // bouton côte à côte doivent s'aligner. Sur <textarea>, c'est un plancher
  // sans effet — ils sont déjà plus hauts.
  minHeight: 44,
};

// Hauteur minimale des boutons. 44 px = la cible tactile recommandée (iOS HIG
// et WCAG 2.5.8) : à 9px de padding et 13px de texte, les boutons faisaient
// 35-37 px, ce qui se rate au pouce — or l'app s'utilise debout à côté d'un
// bocal, pas assis au bureau. `box-sizing: border-box` est global
// (app/globals.css), donc cette valeur inclut padding et bordure.
// inline-flex + centrage : sans ça, minHeight agrandit la boîte mais laisse le
// texte collé en haut.
const TOUCH = {
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

export const btnP = {
  background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.greenDark})`,
  color: COLORS.onGreen,
  border: "none",
  borderRadius: 9,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  ...TOUCH,
};

export const btnS = {
  background: COLORS.soft,
  color: COLORS.muted,
  border: `1.5px solid ${COLORS.line}`,
  borderRadius: 9,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  ...TOUCH,
};

// Note : aucune échappatoire « dense » n'est exportée. J'en avais prévu une
// pour les 7 endroits qui réduisent déjà `padding`/`fontSize` (chips de filtre,
// boutons d'une ligne de version, éditeur inline du journal) — vérification
// faite au navigateur en 375 px, aucun d'eux ne casse à 44 px et rien ne
// déborde. Ne pas en réintroduire une sans avoir constaté une vraie casse.

// Variante utilisée quand btnS/btnP habille un <Link> plutôt qu'un <button>.
export const btnSLink = {
  ...btnS,
  textDecoration: "none",
};

export const btnPLink = {
  ...btnP,
  textDecoration: "none",
};
