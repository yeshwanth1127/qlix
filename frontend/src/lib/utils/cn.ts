/**
 * Joins class names; omit falsy values. Replace with `clsx` + `tailwind-merge` when added.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
