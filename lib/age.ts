/**
 * Shared age utility — no module-specific dependencies.
 * Used by both the Health page (age input) and Finance page (projections + JISAs).
 */

/** Compute age from a birth_date string. Returns null if input is null/empty. */
export function computeAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const mDiff = today.getMonth() - birth.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
