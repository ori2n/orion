/**
 * Centralized tag color palette.
 *
 * Stores only the semantic hue names — Tailwind class strings are derived
 * from them to keep the palette DRY and easy to customize.
 *
 * @example
 *   getTagColor(0) // => "bg-emerald-100 text-emerald-700 border-emerald-200"
 *   getTagColor(8) // => "bg-emerald-100 ..." (cycles)
 */
export const TAG_COLOR_NAMES = [
  'emerald',
  'sky',
  'violet',
  'amber',
  'rose',
  'cyan',
  'orange',
  'teal',
] as const;

export type TagColorName = (typeof TAG_COLOR_NAMES)[number];

/** Total number of colors in the palette. */
export const TAG_COLOR_COUNT = TAG_COLOR_NAMES.length;

/**
 * Derive the full Tailwind badge class string for a given palette index.
 * The result is compatible with the `tags.color` column stored in Supabase.
 */
export function getTagColor(index: number): string {
  const hue = TAG_COLOR_NAMES[Math.abs(index) % TAG_COLOR_COUNT];
  return `bg-${hue}-100 text-${hue}-700 border-${hue}-200`;
}
