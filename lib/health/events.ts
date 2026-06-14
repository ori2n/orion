/**
 * Lightweight event bus for notifying the dashboard that raw data has changed.
 * The Energy Score component listens for this to recompute.
 */
export const HEALTH_DATA_SAVED = 'health-data-saved';

export function notifyHealthDataSaved(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HEALTH_DATA_SAVED));
  }
}
