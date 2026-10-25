// Troncature sûre en UTF-16.
//
// `"…🌳".slice(0, n)` peut couper une paire de substitution en deux et laisser
// un demi-caractère (\ud83d seul). Ce n'est plus du texte valide : Postgres
// rejette le corps de la requête en `22P02 invalid input syntax for type json`.
// Constaté le 04/08 sur un import HortusPal réel — les notes du catalogue de
// plantes commencent par 📝 et en contiennent plusieurs.
//
// L'itération d'une chaîne en JS se fait par POINT DE CODE : [...str] garde les
// emoji entiers. La limite s'entend donc en caractères visibles, ce qui est de
// toute façon ce qu'on veut dire par « 500 caractères ».
export function cutText(value, max) {
  const str = String(value ?? "");
  const points = [...str];
  return points.length <= max ? str : points.slice(0, max).join("");
}
