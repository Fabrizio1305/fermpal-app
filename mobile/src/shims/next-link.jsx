// Remplaçant de `next/link` pour l'app embarquée : un lien vers l'ancre du
// routeur. Les props propres à Next (prefetch, replace, scroll) sont ignorées.
export default function Link({ href, children, prefetch, replace, scroll, ...rest }) {
  const target = typeof href === "string" ? href : href?.pathname || "/";
  return (
    <a href={target.startsWith("#") ? target : `#${target}`} {...rest}>
      {children}
    </a>
  );
}
