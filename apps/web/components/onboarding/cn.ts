/** Join class names, skipping falsy parts (apps/web has no class merger; these never conflict). */
export function cn(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
